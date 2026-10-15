//! `builtinSymbolLikes.ts`

use super::{Names, has_room_on_the_stack, is_symbol_from_default_library};
use crate::types::{IdMap, SymbolFlags, Type, TypeFlags};
use smallvec::SmallVec;

/// `isPromiseLike(program, type)`: `Promise`, or a class that extends it.
pub fn is_promise_like(ty: Type) -> bool {
    is_builtin_symbol_like(ty, "Promise")
}

/// `isPromiseConstructorLike(program, type)`: the type of the value `Promise`.
pub fn is_promise_constructor_like(ty: Type) -> bool {
    is_builtin_symbol_like(ty, "PromiseConstructor")
}

/// tsgolint's `t == checker.globalRegExpType`: the declared type of the `RegExp` of the default library.
pub fn is_global_reg_exp_type(ty: Type) -> bool {
    ty.get_symbol().is_some_and(|symbol| {
        symbol.name() == b"RegExp"
            && is_symbol_from_default_library(symbol)
            && symbol.get_declared_type() == ty
    })
}

/// `isErrorLike(program, type)`: `Error`, or a class that extends it.
pub fn is_error_like(ty: Type) -> bool {
    is_builtin_symbol_like(ty, "Error")
}

/// `isReadonlyErrorLike(program, type)`: `Readonly<Error>`, `Readonly<Readonly<Error>>`
pub fn is_readonly_error_like(ty: Type) -> bool {
    has_room_on_the_stack()
        && is_readonly_type_like(ty, |subtype| {
            let type_argument = subtype.alias_type_arguments().first();
            type_argument.is_some_and(|it| is_error_like(it) || is_readonly_error_like(it))
        })
}

/// `isReadonlyTypeLike(program, type, predicate)`: it is written as `Readonly<..>`, and `predicate`
/// holds for it. Upstream's call without a predicate is always false.
pub fn is_readonly_type_like<'a>(
    ty: Type<'a>,
    mut predicate: impl FnMut(Type<'a>) -> bool,
) -> bool {
    is_builtin_type_alias_like(ty, |subtype| {
        subtype
            .alias_symbol()
            .is_some_and(|it| it.name() == b"Readonly")
            && predicate(subtype)
    })
}

/// `isBuiltinTypeAliasLike(program, type, predicate)`: it is written as a generic type alias of the
/// default library, and `predicate` holds for it. What `predicate` is given has an
/// [`alias_symbol`](Type::alias_symbol) and [`alias_type_arguments`](Type::alias_type_arguments).
pub fn is_builtin_type_alias_like<'a>(
    ty: Type<'a>,
    mut predicate: impl FnMut(Type<'a>) -> bool,
) -> bool {
    is_builtin_symbol_like_recurser(ty, |subtype| {
        let Some(alias_symbol) = subtype.alias_symbol() else {
            return Some(false);
        };
        if subtype.alias_type_arguments().is_empty() {
            return Some(false);
        }
        (is_symbol_from_default_library(alias_symbol) && predicate(subtype)).then_some(true)
    })
}

/// `isBuiltinSymbolLike(program, type, symbolName)`: it is the class or the interface of that name
/// in the default library, or one of those names, or it extends that.
pub fn is_builtin_symbol_like(ty: Type, symbol_name: impl Names) -> bool {
    is_builtin_symbol_like_recurser(ty, |sub_type| {
        let Some(symbol) = sub_type.get_symbol() else {
            return Some(false);
        };
        (symbol_name.includes(symbol.name()) && is_symbol_from_default_library(symbol))
            .then_some(true)
    })
}

/// `isBuiltinSymbolLikeRecurser(program, type, predicate)`: whether `predicate` holds for some
/// constituent of an intersection, every constituent of a union, the constraint of a type
/// parameter. Where it answers `None`, upstream's `null`, the base types are asked.
pub fn is_builtin_symbol_like_recurser<'a>(
    ty: Type<'a>,
    mut predicate: impl FnMut(Type<'a>) -> Option<bool>,
) -> bool {
    recurse(ty, &mut predicate, &mut BaseTypeAnswers::default())
}

/// The answers to one question about the types that extend several, where the answer for a type is made of those for its base
/// types. Where interfaces extend each other in the shape of diamonds, the paths to a base type are two to the power of their
/// number.
#[derive(Default)]
pub(crate) struct BaseTypeAnswers<'a> {
    known: IdMap<Type<'a>, bool>,
    /// The types that are being asked about, from the outermost.
    open: SmallVec<[Type<'a>; 4]>,
    /// The first of `open` that has been come across again since the last of them was begun with.
    first_reopened: Option<usize>,
}

impl<'a> BaseTypeAnswers<'a> {
    /// The answer for `ty`. `ask` finds it out if it is not known.
    pub(crate) fn get_or_ask(&mut self, ty: Type<'a>, ask: impl FnOnce(&mut Self) -> bool) -> bool {
        if let Some(&answer) = self.known.get(ty) {
            return answer;
        }
        // It extends itself. What it extends besides is still to come where it was begun with.
        if let Some(reopened) = self.open.iter().position(|it| *it == ty) {
            self.first_reopened = Some(
                self.first_reopened
                    .map_or(reopened, |first| first.min(reopened)),
            );
            return false;
        }
        let reopened_before = self.first_reopened.take();
        let index = self.open.len();
        self.open.push(ty);
        let answer = ask(self);
        self.open.pop();
        let reopened_around = self.first_reopened.filter(|&first| first < index);
        // A "no" for want of the answer for a type that is still open is not the answer elsewhere.
        if answer || reopened_around.is_none() {
            self.known.insert(ty, answer);
        }
        self.first_reopened = match (reopened_before, reopened_around) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
        answer
    }
}

fn recurse<'a>(
    ty: Type<'a>,
    predicate: &mut dyn FnMut(Type<'a>) -> Option<bool>,
    known: &mut BaseTypeAnswers<'a>,
) -> bool {
    if !has_room_on_the_stack() {
        return false;
    }
    let flags = ty.flags();
    if flags.contains(TypeFlags::INTERSECTION) {
        return ty.types().iter().any(|t| recurse(t, predicate, known));
    }
    if flags.contains(TypeFlags::UNION) {
        return ty.types().iter().all(|t| recurse(t, predicate, known));
    }
    if flags.contains(TypeFlags::TYPE_PARAMETER) {
        // `type.getConstraint()`
        let constraint = ty.get_base_constraint_of_type();
        return constraint.is_some_and(|t| recurse(t, predicate, known));
    }
    if let Some(predicate_result) = predicate(ty) {
        return predicate_result;
    }
    let Some(symbol) = ty.get_symbol() else {
        return false;
    };
    if !symbol.has_flags(SymbolFlags::CLASS | SymbolFlags::INTERFACE) {
        return false;
    }
    let base_types = symbol.get_declared_type().get_base_types();
    let mut ask = |known: &mut BaseTypeAnswers<'a>| {
        base_types
            .iter()
            .any(|base_type| recurse(base_type, predicate, known))
    };
    match base_types.len() > 1 {
        true => known.get_or_ask(ty, ask),
        false => ask(known),
    }
}
