//! `lib/util/makeNoMethodSetStateRule.js` of eslint-plugin-react.

use crate::util_ast::name_of_key;
use crate::util_is_create_element::is_member_called;
use crate::util_version::{ULTIMATE_LATEST_SEMVER, Version, get_react_version_from_context};
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::estree_compat::{estree_parent, estree_type_name};

/// `context.options[0]`
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Mode {
    AllowInFunc,
    DisallowInFunc,
}

/// `methodNoopsAsOf`. Each version means `>=`.
const METHOD_NOOPS_AS_OF: [(&str, Version); 2] = [
    ("componentDidMount", (16, 3, 0)),
    ("componentDidUpdate", (16, 3, 0)),
];

pub(crate) fn should_be_noop<'a>(file: &'a File<'a>, method_name: &str) -> bool {
    let as_of = METHOD_NOOPS_AS_OF.iter().find(|it| it.0 == method_name);
    as_of.is_some_and(|&(_, as_of)| {
        let version = get_react_version_from_context(file);
        version >= as_of && version != ULTIMATE_LATEST_SEMVER
    })
}

/// Caches the ancestor walks from a file's calls, for one `name_matches`.
#[derive(Default)]
pub(crate) struct Walks<'a> {
    /// Nearest ancestor with a matching name: its range and its `key.name`.
    methods: AncestorMemo<'a, (Span, &'a [u8])>,
    /// Nearest ancestor that's a function.
    functions: AncestorMemo<'a, Node<'a>>,
}

/// `/Function(Expression|Declaration)$/.test(ancestor.type)`
fn is_function(ancestor: Node<'_>) -> bool {
    matches!(ancestor, Node::Func(_)) && {
        let type_name = estree_type_name(ancestor);
        type_name.ends_with("FunctionExpression") || type_name.ends_with("FunctionDeclaration")
    }
}

/// `ancestor.key.name` of a `Property`, a `MethodDefinition` or a `PropertyDefinition`.
fn name_of_method(ancestor: Node<'_>) -> Option<&[u8]> {
    let key = match ancestor {
        Node::Prop(property) => property.key(),
        Node::PatProp(property) => property.key(),
        Node::Member(member) => member.key(),
        _ => None,
    }?;
    match estree_type_name(ancestor) {
        "Property" | "MethodDefinition" | "PropertyDefinition" => name_of_key(key),
        _ => None,
    }
}

/// The `CallExpression` listener. On `Some`, report `call.callee()` with this `data.name`.
pub(crate) fn method_enclosing_set_state<'a>(
    call: Expr<'a>,
    name_matches: &dyn Fn(&[u8]) -> bool,
    mode: Mode,
    walks: &mut Walks<'a>,
) -> Option<&'a [u8]> {
    let callee = call.as_call()?.callee();
    let is_this = |object: Expr| object.tag() == ExprTag::This;
    if !is_member_called(callee, "setState") || !callee.object().is_some_and(is_this) {
        return None;
    }
    // `depth` only grows on the way up, so if the nearest ancestor with a matching name isn't
    // reported, none is.
    let call = Node::Expr(call);
    let (method, name) = (walks.methods).find_with(call, estree_parent, |_, ancestor| {
        let name = name_of_method(ancestor).filter(|name| name_matches(name))?;
        Some((ancestor.span(), name))
    })?;
    if mode == Mode::DisallowInFunc {
        return Some(name);
    }
    // `depth > 1`: the call is inside two functions that are inside the method.
    let mut enclosing_function = |node| {
        (walks.functions).find_with(node, estree_parent, |_, ancestor| {
            is_function(ancestor).then_some(ancestor)
        })
    };
    let second = enclosing_function(call).and_then(&mut enclosing_function);
    let is_deep = second.is_some_and(|function| method.contains(function.span()));
    (!is_deep).then_some(name)
}
