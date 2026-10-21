//! `getStaticMemberAccessValue` and `isStaticMemberAccessOfValue` of `misc.ts`, and the helpers built on them:
//! `hasOverloadSignatures.ts`, and the syntactic halves of `isArrayMethodCallWithPredicate.ts` and
//! `isPromiseAggregatorMethod.ts`.

use super::estree::sibling_statements;
use super::misc::NodeWithKey;
use super::predicates::is_function_type;
use crate::ast::{Expr, Flags, Func, KeyKind, Member, Node, Stmt};
use crate::utils::eslint_utils::{StaticSymbol, StaticValue, get_static_value};
use std::borrow::Cow;

/// The result of [`get_static_member_access_value`]: upstream's `string | symbol`.
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

/// `getStaticValue(e, scope)`, with `String()` applied to anything that isn't a symbol.
fn static_key_value(e: Expr<'_>) -> Option<MemberAccessValue<'_>> {
    Some(match get_static_value(e, Some(e.file().scope()))? {
        StaticValue::Symbol(StaticSymbol::WellKnown(name)) => {
            MemberAccessValue::WellKnownSymbol(name.as_bytes())
        }
        StaticValue::Symbol(StaticSymbol::Registered(key)) => {
            MemberAccessValue::RegisteredSymbol(key)
        }
        value => MemberAccessValue::String(value.to_js_string()?),
    })
}

/// typescript-eslint's `getStaticMemberAccessValue`: the key that a member access (an `Expr`) reads, or that a `Member`
/// or a `Prop` declares, if it's known without running the program. A number becomes a string: `a[0]` is `"0"`. As
/// upstream, `a.#b` is `"b"`, without the `#`.
#[inline]
pub fn get_static_member_access_value<'a>(
    node: impl Into<NodeWithKey<'a>>,
) -> Option<MemberAccessValue<'a>> {
    static_member_access_value_of(node.into())
}

fn static_member_access_value_of<'a>(node: NodeWithKey<'a>) -> Option<MemberAccessValue<'a>> {
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
        Some(KeyKind::Computed(e)) => static_key_value(e),
    }
}

/// typescript-eslint's `isStaticMemberAccessOfValue`, for string values: true if the node looks like `x.value`,
/// `x['value']`, or `const v = 'value'; x[v]`, for one of `values`.
///
/// To compare with a value returned by [`get_static_member_access_value`], which can be a symbol, compare two of its
/// results.
pub fn is_static_member_access_of_value<'a>(
    node: impl Into<NodeWithKey<'a>>,
    values: &[impl AsRef<[u8]>],
) -> bool {
    get_static_member_access_value(node)
        .as_ref()
        .and_then(MemberAccessValue::as_string)
        .is_some_and(|value| values.iter().any(|it| it.as_ref() == value))
}

/// The object of the member access that the `Call` `call` calls, if the member is one of `names`.
fn object_of_called_method<'a>(call: Expr<'a>, names: &[&str]) -> Option<Expr<'a>> {
    let callee = call.as_call()?.callee();
    // `(a?.b)()` calls a `ChainExpression`.
    if callee.is_chain_root() {
        return None;
    }
    let obj = callee.object()?;
    is_static_member_access_of_value(callee, names).then_some(obj)
}

/// typescript-eslint's `isArrayMethodCallWithPredicate`: true if `call` calls an array's `every`, `filter`, `find`,
/// `findIndex`, `findLast`, `findLastIndex` or `some`.
///
/// `is_array_or_tuple` receives the object and does upstream's type test: whether a constituent of the constrained type
/// at that location is an array or a tuple type.
pub fn is_array_method_call_with_predicate<'a>(
    call: Expr<'a>,
    is_array_or_tuple: impl FnOnce(Expr<'a>) -> bool,
) -> bool {
    const ARRAY_PREDICATE_FUNCTIONS: [&str; 7] = [
        "every",
        "filter",
        "find",
        "findIndex",
        "findLast",
        "findLastIndex",
        "some",
    ];
    object_of_called_method(call, &ARRAY_PREDICATE_FUNCTIONS).is_some_and(is_array_or_tuple)
}

/// typescript-eslint's `isPromiseAggregatorMethod`: true if `call` calls the `Promise` constructor's `all`,
/// `allSettled`, `race` or `any`.
///
/// `is_promise_constructor_like` receives the object and does upstream's type test: `isPromiseConstructorLike` of the
/// constrained type at that location.
pub fn is_promise_aggregator_method<'a>(
    call: Expr<'a>,
    is_promise_constructor_like: impl FnOnce(Expr<'a>) -> bool,
) -> bool {
    const PROMISE_CONSTRUCTOR_ARRAY_METHODS: [&str; 4] = ["all", "allSettled", "race", "any"];
    object_of_called_method(call, &PROMISE_CONSTRUCTOR_ARRAY_METHODS)
        .is_some_and(is_promise_constructor_like)
}

/// A `TSDeclareFunction`, with its statement's flags.
fn as_declare_function(statement: Stmt<'_>) -> Option<(Func<'_>, Flags)> {
    match statement.as_fn() {
        Some(func) if !func.has_body() => Some((func, statement.flags())),
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
    siblings
        .iter()
        .filter_map(as_declare_function)
        .any(|(other, flags)| {
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

/// typescript-eslint's `hasOverloadSignatures`, for a function declaration (its `Func` or its `Stmt`) or a class method
/// (its `Member`): true if it has a sibling declaration without a body and with the same name. For an exported
/// function, the sibling must be exported the same way.
pub fn has_overload_signatures<'a>(node: impl Into<Node<'a>>) -> bool {
    match node.into() {
        Node::Member(member) => method_has_overload_signatures(member),
        Node::Func(func) => match func.owner() {
            Node::Stmt(statement) => function_has_overload_signatures(statement, func),
            Node::Member(member) => method_has_overload_signatures(member),
            _ => false,
        },
        Node::Stmt(statement) => match statement.as_fn() {
            Some(func) => function_has_overload_signatures(statement, func),
            _ => false,
        },
        _ => false,
    }
}
