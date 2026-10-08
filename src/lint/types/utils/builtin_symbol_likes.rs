//! `builtinSymbolLikes.ts`

use super::{MAX_DEPTH, Names, is_symbol_from_default_library};
use crate::types::{SymbolFlags, Type, TypeFlags};

/// `isPromiseLike(program, type)`: `Promise`, or a class that extends it.
pub fn is_promise_like(ty: Type) -> bool {
    is_builtin_symbol_like(ty, "Promise")
}

/// `isPromiseConstructorLike(program, type)`: the type of the value `Promise`.
pub fn is_promise_constructor_like(ty: Type) -> bool {
    is_builtin_symbol_like(ty, "PromiseConstructor")
}

/// `isErrorLike(program, type)`: `Error`, or a class that extends it.
pub fn is_error_like(ty: Type) -> bool {
    is_builtin_symbol_like(ty, "Error")
}

/// `isReadonlyErrorLike(program, type)`: `Readonly<Error>`, `Readonly<Readonly<Error>>`
pub fn is_readonly_error_like(ty: Type) -> bool {
    is_readonly_error_like_at(ty, 0)
}

fn is_readonly_error_like_at(ty: Type, depth: u32) -> bool {
    depth <= MAX_DEPTH
        && is_readonly_type_like(ty, |subtype| {
            let type_argument = subtype.alias_type_arguments().first();
            type_argument
                .is_some_and(|it| is_error_like(it) || is_readonly_error_like_at(it, depth + 1))
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
    recurse(ty, &mut predicate, 0)
}

fn recurse<'a>(
    ty: Type<'a>,
    predicate: &mut dyn FnMut(Type<'a>) -> Option<bool>,
    depth: u32,
) -> bool {
    if depth > MAX_DEPTH {
        return false;
    }
    let flags = ty.flags();
    if flags.contains(TypeFlags::INTERSECTION) {
        return ty.types().iter().any(|t| recurse(t, predicate, depth + 1));
    }
    if flags.contains(TypeFlags::UNION) {
        return ty.types().iter().all(|t| recurse(t, predicate, depth + 1));
    }
    if flags.contains(TypeFlags::TYPE_PARAMETER) {
        // `type.getConstraint()`
        let constraint = ty.get_base_constraint_of_type();
        return constraint.is_some_and(|t| recurse(t, predicate, depth + 1));
    }
    if let Some(predicate_result) = predicate(ty) {
        return predicate_result;
    }
    let Some(symbol) = ty.get_symbol() else {
        return false;
    };
    symbol.has_flags(SymbolFlags::CLASS | SymbolFlags::INTERFACE)
        && symbol
            .get_declared_type()
            .get_base_types()
            .iter()
            .any(|base_type| recurse(base_type, predicate, depth + 1))
}
