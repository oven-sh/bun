//! `getStaticMemberAccessValue` and `isStaticMemberAccessOfValue` of `misc.ts`, and what is built
//! on them: `hasOverloadSignatures.ts`, and the syntactic halves of
//! `isArrayMethodCallWithPredicate.ts` and `isPromiseAggregatorMethod.ts`.

use super::estree::{is_chain_expression, sibling_statements};
use super::misc::NodeWithKey;
use super::predicates::{is_function_type, is_variable_declarator};
use crate::ast::{Expr, ExprKind, Flags, Func, KeyKind, Member, Node, Stmt, StmtKind, VarKind};
use crate::semantic::Declaration;
use crate::utils::ast_utils::get_static_string_value;
use std::borrow::Cow;

/// What [`get_static_member_access_value`] returns: upstream's `string | symbol`.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum MemberAccessValue<'a> {
    String(Cow<'a, [u8]>),
    /// `Symbol.iterator` is `WellKnownSymbol(b"iterator")`.
    WellKnownSymbol(&'a [u8]),
    /// `Symbol.for("a")` is `RegisteredSymbol(b"a")`.
    RegisteredSymbol(Cow<'a, [u8]>),
}

impl MemberAccessValue<'_> {
    /// The value if `typeof value === 'string'`.
    #[inline]
    pub fn as_string(&self) -> Option<&[u8]> {
        match self {
            MemberAccessValue::String(value) => Some(value),
            _ => None,
        }
    }
}

const WELL_KNOWN_SYMBOLS: [&str; 15] = [
    "asyncDispose",
    "asyncIterator",
    "dispose",
    "hasInstance",
    "isConcatSpreadable",
    "iterator",
    "match",
    "matchAll",
    "metadata",
    "replace",
    "search",
    "species",
    "split",
    "toPrimitive",
    "toStringTag",
];

/// How many constants and nested expressions the value of a computed key is followed through.
const MAX_DEPTH: u32 = 16;

/// Whether `e` is the global `Symbol`.
fn is_global_symbol(e: Expr<'_>) -> bool {
    e.is_ident("Symbol") && e.symbol().is_none()
}

/// The initializer of the variable that the identifier `e` refers to, if eslint-utils considers it
/// constant: it is declared once, as `name = init`, with `const` or without ever being written to
/// again.
fn initializer_of_constant(e: Expr<'_>) -> Option<Expr<'_>> {
    let symbol = e.symbol()?;
    let mut declarations = symbol.declarations();
    let (Some(Declaration::Var(pat)), None) = (declarations.next(), declarations.next()) else {
        return None;
    };
    let Node::VarDecl(declaration) = pat.parent() else {
        return None;
    };
    if !is_variable_declarator(declaration) {
        return None;
    }
    let is_constant = declaration.var_kind() == VarKind::Const || {
        let (mut inits, mut others) = (0, 0);
        for reference in symbol.references() {
            match reference.is_init() {
                true => inits += 1,
                false if reference.is_read_only() => {}
                false => others += 1,
            }
        }
        inits == 1 && others == 0
    };
    declaration.init().filter(|_| is_constant)
}

/// The property key that `e` evaluates to: `getStaticValue(e, scope)`, with `String()` applied to
/// what is not a symbol. It knows literals, templates, `undefined`, `Symbol.name`, `Symbol.for()`
/// and constants that are initialized with one of these.
fn static_key_value(e: Expr<'_>, depth: u32) -> Option<MemberAccessValue<'_>> {
    use MemberAccessValue::{RegisteredSymbol, String, WellKnownSymbol};
    if depth > MAX_DEPTH {
        return None;
    }
    match e.kind() {
        ExprKind::Ident(name) => match initializer_of_constant(e) {
            Some(init) => static_key_value(init, depth + 1),
            None if e.symbol().is_none() && name.is_any(&["undefined", "NaN", "Infinity"]) => {
                Some(String(Cow::Borrowed(name.bytes())))
            }
            None => None,
        },
        ExprKind::Template(template) if !template.exprs().is_empty() => {
            let mut out = Vec::new();
            for (i, substitution) in template.exprs().iter().enumerate() {
                out.extend_from_slice(template.cooked(i)?.bytes());
                match static_key_value(substitution, depth + 1)? {
                    String(value) => out.extend_from_slice(&value),
                    // A `TypeError`.
                    WellKnownSymbol(_) | RegisteredSymbol(_) => return None,
                }
            }
            out.extend_from_slice(template.cooked(template.exprs().len())?.bytes());
            Some(String(Cow::Owned(out)))
        }
        ExprKind::Dot { obj, name, .. }
            if is_global_symbol(obj) && name.name().is_any(&WELL_KNOWN_SYMBOLS) =>
        {
            Some(WellKnownSymbol(name.bytes()))
        }
        ExprKind::Call(call) => match (call.callee().kind(), call.args().first()) {
            (ExprKind::Dot { obj, name, .. }, Some(key))
                if is_global_symbol(obj) && name.name().is("for") =>
            {
                match static_key_value(key, depth + 1)? {
                    String(key) => Some(RegisteredSymbol(key)),
                    WellKnownSymbol(_) | RegisteredSymbol(_) => None,
                }
            }
            _ => None,
        },
        ExprKind::As { expr, .. }
        | ExprKind::Satisfies { expr, .. }
        | ExprKind::Instantiation { expr, .. }
        | ExprKind::AsConst(expr)
        | ExprKind::NonNull(expr) => static_key_value(expr, depth + 1),
        _ => get_static_string_value(e).map(String),
    }
}

/// typescript-eslint's `getStaticMemberAccessValue`: the key that a member access (an `Expr`)
/// reads, or that a `Member` or a `Prop` declares, if it can be told without running the program.
/// A number is a string: `a[0]` is `"0"`. As upstream, `a.#b` is `"b"`, without the `#`.
pub fn get_static_member_access_value<'a>(
    node: impl Into<NodeWithKey<'a>>,
) -> Option<MemberAccessValue<'a>> {
    let node = node.into();
    let string = |value: &'a [u8]| Some(MemberAccessValue::String(Cow::Borrowed(value)));
    match node.key() {
        None if node.is_constructor() => string(b"constructor"),
        None => None,
        Some(KeyKind::Private(name)) => string(name.bytes().strip_prefix(b"#").unwrap_or_default()),
        Some(
            KeyKind::Ident(name)
            | KeyKind::String(name)
            | KeyKind::Number(name)
            | KeyKind::ComputedString(name)
            | KeyKind::ComputedNumber(name),
        ) => string(name.bytes()),
        Some(KeyKind::Computed(e)) => static_key_value(e, 0),
    }
}

/// typescript-eslint's `isStaticMemberAccessOfValue`, for values that are strings: whether the node
/// looks like `x.value`, `x['value']`, or `const v = 'value'; x[v]`, for one of `values`.
///
/// To compare with a value that [`get_static_member_access_value`] returned, which can be a symbol,
/// compare two results of that.
pub fn is_static_member_access_of_value<'a>(
    node: impl Into<NodeWithKey<'a>>,
    values: &[impl AsRef<[u8]>],
) -> bool {
    get_static_member_access_value(node)
        .as_ref()
        .and_then(MemberAccessValue::as_string)
        .is_some_and(|value| values.iter().any(|it| it.as_ref() == value))
}

/// The object of the member access that `call`, a `Call`, calls, if the member is one of `names`.
fn object_of_called_method<'a>(call: Expr<'a>, names: &[&str]) -> Option<Expr<'a>> {
    let callee = call.as_call()?.callee();
    // `(a?.b)()` calls a `ChainExpression`.
    if is_chain_expression(callee) {
        return None;
    }
    let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = callee.kind() else {
        return None;
    };
    is_static_member_access_of_value(callee, names).then_some(obj)
}

/// typescript-eslint's `isArrayMethodCallWithPredicate`: whether `call` calls `every`, `filter`,
/// `find`, `findIndex`, `findLast`, `findLastIndex` or `some` of an array.
///
/// `is_array_or_tuple` is given the object, and does upstream's test of its type: whether a
/// constituent of the constrained type at that location is an array or a tuple type.
pub fn is_array_method_call_with_predicate<'a>(
    call: Expr<'a>,
    is_array_or_tuple: impl FnOnce(Expr<'a>) -> bool,
) -> bool {
    const ARRAY_PREDICATE_FUNCTIONS: [&str; 7] =
        ["every", "filter", "find", "findIndex", "findLast", "findLastIndex", "some"];
    object_of_called_method(call, &ARRAY_PREDICATE_FUNCTIONS).is_some_and(is_array_or_tuple)
}

/// typescript-eslint's `isPromiseAggregatorMethod`: whether `call` calls `all`, `allSettled`, `race`
/// or `any` of the `Promise` constructor.
///
/// `is_promise_constructor_like` is given the object, and does upstream's test of its type:
/// `isPromiseConstructorLike` of the constrained type at that location.
pub fn is_promise_aggregator_method<'a>(
    call: Expr<'a>,
    is_promise_constructor_like: impl FnOnce(Expr<'a>) -> bool,
) -> bool {
    const PROMISE_CONSTRUCTOR_ARRAY_METHODS: [&str; 4] = ["all", "allSettled", "race", "any"];
    object_of_called_method(call, &PROMISE_CONSTRUCTOR_ARRAY_METHODS)
        .is_some_and(is_promise_constructor_like)
}

/// A `TSDeclareFunction`, with the flags of its statement.
fn as_declare_function(statement: Stmt<'_>) -> Option<(Func<'_>, Flags)> {
    match statement.kind() {
        StmtKind::Fn(func) if !func.has_body() => Some((func, statement.flags())),
        _ => None,
    }
}

fn function_has_overload_signatures<'a>(statement: Stmt<'a>, func: Func<'a>) -> bool {
    const EXPORT_DEFAULT: Flags = Flags::EXPORT.union(Flags::DEFAULT);
    let Some(siblings) = sibling_statements(statement) else {
        return false;
    };
    let export = statement.flags().intersection(EXPORT_DEFAULT);
    let name = func.name().map(|it| it.name());
    siblings.iter().filter_map(as_declare_function).any(|(other, flags)| {
        flags.intersection(EXPORT_DEFAULT) == export
            && (export == EXPORT_DEFAULT || other.name().map(|it| it.name()) == name)
    })
}

fn method_has_overload_signatures(member: Member<'_>) -> bool {
    let Node::Class(class) = member.parent() else {
        return false;
    };
    let key = get_static_member_access_value(member);
    class.members().iter().any(|other| {
        !other.flags().contains(Flags::ABSTRACT)
            && other.func().is_some_and(is_function_type)
            && get_static_member_access_value(other) == key
    })
}

/// typescript-eslint's `hasOverloadSignatures`, for a function declaration (its `Func` or its
/// `Stmt`) or a method of a class (its `Member`): whether there is a declaration without a body of
/// the same name beside it. For an exported function, one that is exported in the same way.
pub fn has_overload_signatures<'a>(node: impl Into<Node<'a>>) -> bool {
    match node.into() {
        Node::Member(member) => method_has_overload_signatures(member),
        Node::Func(func) => match func.owner() {
            Node::Stmt(statement) => function_has_overload_signatures(statement, func),
            Node::Member(member) => method_has_overload_signatures(member),
            _ => false,
        },
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::Fn(func) => function_has_overload_signatures(statement, func),
            _ => false,
        },
        _ => false,
    }
}
