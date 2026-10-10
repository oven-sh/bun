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

impl Rule for SortDefaultProps {
    const META: Meta = Meta::plugin(Plugin::React, "sort-default-props", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Dot, ExprTag::Index]).members();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        SortDefaultProps { ignore_case: options.object(0).bool_or("ignoreCase", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // upstream takes a private name for its text.
        file.mentions_any(&["defaultProps", "getDefaultProps", "#defaultProps", "#getDefaultProps"]).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.member_expression(e, &mut |unsorted| {
            cx.report(unsorted, PROPS_NOT_SORTED);
        });
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        self.property_definition(member, &mut |unsorted| {
            cx.report(unsorted, PROPS_NOT_SORTED);
        });
    }
}

impl SortDefaultProps {
    /// The listener for `MemberExpression`. `report` is called with each property that is to be reported.
    pub(super) fn member_expression<'a>(&self, e: Expr<'a>, report: &mut dyn FnMut(Prop<'a>)) {
        if is_default_props_declaration(e.into())
            && let Some(right) = right_of_parent(e)
        {
            self.check_node(right, report);
        }
    }

    /// The listener for `PropertyDefinition`.
    pub(super) fn property_definition<'a>(&self, member: Member<'a>, report: &mut dyn FnMut(Prop<'a>)) {
        if ast_utils::is_property_definition(member)
            && is_default_props_declaration(member.into())
            && let Some(value) = member.init()
        {
            self.check_node(value, report);
        }
    }

    /// `checkNode`
    fn check_node<'a>(&self, node: Expr<'a>, report: &mut dyn FnMut(Prop<'a>)) {
        let object = match node.as_ident() {
            Some(name) => match find_variable_by_name(node.into(), name) {
                Some(Found::Init(init)) => init,
                _ => return,
            },
            None => node,
        };
        if let ExprKind::Object(declarations) = object.kind() {
            self.check_sorted(declarations, report);
        }
    }

    /// `checkSorted`
    fn check_sorted<'a>(&self, declarations: List<'a, Prop<'a>>, report: &mut dyn FnMut(Prop<'a>)) {
        // `getKey` of the last property that is in its place. None at the start and after a spread.
        let mut prev: Option<Cow<'a, [u8]>> = None;
        for curr in declarations {
            let Some(key) = curr.key() else {
                prev = None;
                continue;
            };
            let written = curr.file().slice(key.inner_span(curr.file()));
            let name = if self.ignore_case { text::to_lower_case(written) } else { Cow::Borrowed(written) };
            if prev.as_ref().is_some_and(|prev| strings::order_utf16(&name, prev) == Ordering::Less) {
                report(curr);
            } else {
                prev = Some(name);
            }
        }
    }
}
