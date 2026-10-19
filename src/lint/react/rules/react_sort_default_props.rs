use crate::util_props::is_default_props_declaration;
use crate::util_variable::{Found, find_variable_by_name};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::borrow::Cow;
use std::cmp::Ordering;

/// Enforce defaultProps declarations alphabetical sorting. `OLD_NAME` registers it as `jsx-sort-default-props`.
pub struct SortDefaultProps<const OLD_NAME: bool = false> {
    ignore_case: bool,
}

const PROPS_NOT_SORTED: Message =
    Message::new("propsNotSorted", "Default prop types declarations should be sorted alphabetically");

/// `"right" in node.parent && node.parent.right`
fn right_of_parent(e: Expr<'_>) -> Option<Expr<'_>> {
    // A whole optional chain's parent is the `ChainExpression`.
    if e.is_chain_root() {
        return None;
    }
    match e.parent() {
        // A `SequenceExpression` has no `right`.
        Node::Expr(parent) if parent.binary_op() != Some(BinOp::Comma) => parent.right(),
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::ForIn { expr, .. } | StmtKind::ForOf { expr, .. } => Some(expr),
            _ => None,
        },
        _ => None,
    }
}

/// `checkNode`. Returns the `ObjectExpression` whose properties `checkSorted` is called with.
fn check_node(node: Expr<'_>) -> Option<Expr<'_>> {
    let object = match node.as_ident() {
        Some(name) => match find_variable_by_name(node.into(), name)? {
            Found::Init(init) => init,
            Found::Import(_) => return None,
        },
        None => node,
    };
    (object.tag() == ExprTag::Object).then_some(object)
}

/// The `MemberExpression` listener. Returns the same as [`check_node`].
fn member_expression(e: Expr<'_>) -> Option<Expr<'_>> {
    if is_default_props_declaration(e.into()) { check_node(right_of_parent(e)?) } else { None }
}

/// The `PropertyDefinition` listener. Returns the same as [`check_node`].
fn property_definition(member: Member<'_>) -> Option<Expr<'_>> {
    let is_declaration = ast_utils::is_property_definition(member) && is_default_props_declaration(member.into());
    if is_declaration { check_node(member.init()?) } else { None }
}

impl<const OLD_NAME: bool> Rule for SortDefaultProps<OLD_NAME> {
    const META: Meta = match OLD_NAME {
        true => Meta::plugin(Plugin::React, "jsx-sort-default-props", Kind::None).deprecated(),
        false => Meta::plugin(Plugin::React, "sort-default-props", Kind::None),
    };
    const ON: On = On::new().exprs(&[ExprTag::Dot, ExprTag::Index]).members().finish();
    /// The objects `checkSorted` is called with, one entry per call.
    type State<'a> = Vec<Expr<'a>>;

    fn new(options: &Options) -> Self {
        SortDefaultProps { ignore_case: options.object(0).bool_or("ignoreCase", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Vec<Expr<'a>>> {
        // Upstream treats a private name like the same name without the `#`.
        let is_candidate = file.mentions("defaultProps")
            || file.mentions("getDefaultProps")
            || file.mentions("#defaultProps")
            || file.mentions("#getDefaultProps");
        is_candidate.then(Vec::new)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        cx.state.extend(member_expression(e));
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        cx.state.extend(property_definition(member));
    }

    /// `checkSorted`, for each object. An object that's listed several times is checked once and reported each time.
    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut objects = std::mem::take(&mut cx.state);
        utils::sort::sort_unstable_by_key(&mut objects, |it| it.span().start);
        for same in objects.chunk_by(|a, b| a == b) {
            let unsorted = same.first().map_or_else(Vec::new, |&object| self.unsorted(object));
            for _ in same {
                for &property in &unsorted {
                    cx.report(property, PROPS_NOT_SORTED);
                }
            }
        }
    }
}

impl<const OLD_NAME: bool> SortDefaultProps<OLD_NAME> {
    /// The properties of `object` that `checkSorted` reports.
    fn unsorted<'a>(&self, object: Expr<'a>) -> Vec<Prop<'a>> {
        let ExprKind::Object(declarations) = object.kind() else {
            return Vec::new();
        };
        let file = object.file();
        let mut unsorted = Vec::new();
        // `getKey` of the last property that's in order. `None` at the start and after a spread.
        let mut prev: Option<Cow<'a, [u8]>> = None;
        for curr in declarations {
            let Some(key) = curr.key() else {
                prev = None;
                continue;
            };
            let key_text = file.slice(key.inner_span(file));
            let name = if self.ignore_case { text::to_lower_case(key_text) } else { Cow::Borrowed(key_text) };
            if prev.as_ref().is_some_and(|prev| strings::order_utf16(&name, prev) == Ordering::Less) {
                unsorted.push(curr);
            } else {
                prev = Some(name);
            }
        }
        unsorted
    }
}
