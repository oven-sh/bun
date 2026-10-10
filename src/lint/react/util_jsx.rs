#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/util/jsx.js` of eslint-plugin-react.
//!
//! | upstream | here |
//! |---|---|
//! | `isJSX(node)` | `e.tag() == ExprTag::Jsx` |
//! | `isWhiteSpaces(value)` | `bun_core::strings::is_all_js_whitespace(text)` |

use crate::jsx::get_jsx_element_name;
use crate::util_ast::{Enter, traverse, traverse_returns};
use crate::util_is_create_element::is_create_element;
use crate::util_variable::{Found, find_variable_by_name};
use bun_lint::prelude::*;
use bun_lint::utils::estree_compat::last_sequence_expression;
use smallvec::{SmallVec, smallvec};
use std::ops::ControlFlow;

/// `strict`: whether one branch of a `?:`, `&&`, `||` or `??` is enough, or it takes both.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Branches {
    Any,
    All,
}

/// `ignoreNull`: whether `null` counts as JSX.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Nulls {
    Count,
    Ignore,
}

/// `isDOMComponent`
pub(crate) fn is_dom_component(jsx: Jsx<'_>) -> bool {
    get_jsx_element_name(jsx)
        .first()
        .is_some_and(u8::is_ascii_lowercase)
}

/// `name.type === "JSXIdentifier" && name.name === expected`
fn is_jsx_identifier(name: Expr<'_>, expected: &[u8]) -> bool {
    match name.kind() {
        ExprKind::Ident(it) => it.bytes() == expected,
        ExprKind::This => expected == b"this",
        _ => false,
    }
}

/// `isFragment`: `<Fragment>` or `<React.Fragment>`. Not `<>`.
pub(crate) fn is_fragment(jsx: Jsx<'_>, react_pragma: &[u8], fragment_pragma: &[u8]) -> bool {
    jsx.tag().is_some_and(|name| match name.kind() {
        ExprKind::Dot {
            obj,
            name: property,
            ..
        } => is_jsx_identifier(obj, react_pragma) && property.bytes() == fragment_pragma,
        _ => is_jsx_identifier(name, fragment_pragma),
    })
}

/// `isJSXAttributeKey`
pub(crate) fn is_jsx_attribute_key(prop: Prop<'_>) -> bool {
    prop.is_jsx_attribute() && prop.key().is_some_and(|it| it.is("key"))
}

/// `isJSXValue` in `isReturningJSX`. Nothing in it has an effect, so the order does not show.
fn is_jsx_value(node: Expr<'_>, pragma: &[u8], branches: Branches, nulls: Nulls) -> bool {
    let mut pending: SmallVec<[Expr<'_>; 8]> = smallvec![node];
    while let Some(e) = pending.pop() {
        let is_jsx = match e.kind() {
            ExprKind::Cond { yes, no, .. } => {
                pending.extend([yes, no]);
                continue;
            }
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => {
                pending.extend([left, right]);
                continue;
            }
            ExprKind::Binary {
                op: BinOp::Comma, ..
            } => {
                pending.push(last_sequence_expression(e));
                continue;
            }
            ExprKind::Jsx(_) => true,
            ExprKind::Call(_) => !e.is_chain_root() && is_create_element(e, pragma),
            ExprKind::Null => nulls == Nulls::Count,
            ExprKind::Ident(name) => matches!(
                find_variable_by_name(Node::Expr(e), name),
                Some(Found::Init(init)) if init.tag() == ExprTag::Jsx
            ),
            _ => false,
        };
        if is_jsx == (branches == Branches::Any) {
            return is_jsx;
        }
    }
    branches == Branches::All
}

/// `isReturningJSX`, for what [`traverse_returns`] takes.
pub(crate) fn is_returning_jsx(
    node: Node<'_>,
    pragma: &[u8],
    branches: Branches,
    nulls: Nulls,
) -> bool {
    let mut found = false;
    traverse_returns(node, &mut |argument| {
        found = argument.is_some_and(|it| is_jsx_value(it, pragma, branches, nulls));
        match found {
            true => ControlFlow::Break(()),
            false => ControlFlow::Continue(()),
        }
    });
    found
}

/// `isReturningOnlyNull`. A `?:` whose branches are not both `null` is looked into, its test too,
/// and a literal that is not `null` counts for nothing.
pub(crate) fn is_returning_only_null(node: Node<'_>) -> bool {
    let (mut found, mut found_something_else) = (false, false);
    traverse_returns(node, &mut |argument| {
        let Some(argument) = argument else {
            return ControlFlow::Continue(());
        };
        traverse(Node::Expr(argument), &mut |child_node| {
            let is_null = |e: Expr| e.tag() == ExprTag::Null;
            match child_node {
                Node::Expr(e) if is_null(e) => found = true,
                Node::Expr(e) if ast_utils::is_literal(e) => {}
                Node::Expr(e) => match e.kind() {
                    ExprKind::Cond { yes, no, .. } if is_null(yes) && is_null(no) => found = true,
                    ExprKind::Cond { .. } => return Enter::Children,
                    _ => found_something_else = true,
                },
                _ => found_something_else = true,
            }
            Enter::Skip
        });
        ControlFlow::Continue(())
    });
    found && !found_something_else
}
