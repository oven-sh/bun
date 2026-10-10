use crate::util_props::is_default_props_declaration;
use crate::util_variable::{Found, find_variable_by_name};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::borrow::Cow;
use std::cmp::Ordering;

/// Enforce defaultProps declarations alphabetical sorting
pub struct SortDefaultProps {
    ignore_case: bool,
}

pub(super) const PROPS_NOT_SORTED: Message =
    Message::new("propsNotSorted", "Default prop types declarations should be sorted alphabetically");

/// `"right" in node.parent && node.parent.right`
fn right_of_parent(e: Expr<'_>) -> Option<Expr<'_>> {
    // The parent of the whole of an optional chain is the `ChainExpression`.
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

/// `checkNode`: the `ObjectExpression` whose properties `checkSorted` is called with.
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

/// The listener for `MemberExpression`: as [`check_node`].
pub(super) fn member_expression(e: Expr<'_>) -> Option<Expr<'_>> {
    if is_default_props_declaration(e.into()) { check_node(right_of_parent(e)?) } else { None }
}

/// The listener for `PropertyDefinition`: as [`check_node`].
pub(super) fn property_definition(member: Member<'_>) -> Option<Expr<'_>> {
    let is_declaration = ast_utils::is_property_definition(member) && is_default_props_declaration(member.into());
    if is_declaration { check_node(member.init()?) } else { None }
}

impl Rule for SortDefaultProps {
    const META: Meta = Meta::plugin(Plugin::React, "sort-default-props", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Dot, ExprTag::Index]).members().finish();
    /// What `checkSorted` is called with, once for each call.
    type State<'a> = Vec<Expr<'a>>;

    fn new(options: &Options) -> Self {
        SortDefaultProps { ignore_case: options.object(0).bool_or("ignoreCase", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Vec<Expr<'a>>> {
        // upstream takes a private name for its text.
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

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut objects = std::mem::take(&mut cx.state);
        self.check_sorted(&mut objects, &mut |unsorted| {
            cx.report(unsorted, PROPS_NOT_SORTED);
        });
    }
}

impl SortDefaultProps {
    /// `checkSorted`, for each of `objects`. One that many variables lead to is looked at once, and reported as often.
    pub(super) fn check_sorted<'a>(&self, objects: &mut [Expr<'a>], report: &mut dyn FnMut(Prop<'a>)) {
        objects.sort_unstable_by_key(|it| it.span().start);
        for same in objects.chunk_by(|a, b| a == b) {
            let unsorted = same.first().map_or_else(Vec::new, |&object| self.unsorted(object));
            for _ in same {
                for &property in &unsorted {
                    report(property);
                }
            }
        }
    }

    /// What `checkSorted` reports of the properties of `object`.
    fn unsorted<'a>(&self, object: Expr<'a>) -> Vec<Prop<'a>> {
        let ExprKind::Object(declarations) = object.kind() else {
            return Vec::new();
        };
        let file = object.file();
        let mut unsorted = Vec::new();
        // `getKey` of the last property that is in its place. None at the start and after a spread.
        let mut prev: Option<Cow<'a, [u8]>> = None;
        for curr in declarations {
            let Some(key) = curr.key() else {
                prev = None;
                continue;
            };
            let written = file.slice(key.inner_span(file));
            let name = if self.ignore_case { text::to_lower_case(written) } else { Cow::Borrowed(written) };
            if prev.as_ref().is_some_and(|prev| strings::order_utf16(&name, prev) == Ordering::Less) {
                unsorted.push(curr);
            } else {
                prev = Some(name);
            }
        }
        unsorted
    }
}
