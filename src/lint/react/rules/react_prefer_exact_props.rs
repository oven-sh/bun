use crate::util_prop_wrapper::{
    format_exact_prop_wrapper_functions, get_exact_prop_wrapper_functions, is_exact_prop_wrapper_function,
};
use crate::util_props::is_prop_types_declaration;
use crate::util_variable::{Found, find_variable_by_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::estree_compat::estree_parent;

/// Prefer exact proptype definitions
pub struct PreferExactProps;

// upstream's `flow`, and what it asks about components, is for the types of Flow: no parser here has them.
const PROP_TYPES: Message =
    Message::new("propTypes", "Component propTypes should be exact by using {{exactPropWrappers}}.");

impl Rule for PreferExactProps {
    const META: Meta = Meta::plugin(Plugin::React, "prefer-exact-props", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Dot, ExprTag::Index]).members();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferExactProps
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        // upstream takes a private name for its text.
        if file.mentions_any(&["propTypes", "#propTypes"]) {
            On::new().exprs(&[ExprTag::Dot, ExprTag::Index]).members()
        } else if file.mentions_any(&["props", "#props"]) {
            On::new().members()
        } else {
            On::new()
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        get_exact_prop_wrapper_functions(file).next().is_some().then_some(())
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !is_prop_types_declaration(Node::Expr(node)) {
            return;
        }
        let Some(right) = right_of_parent(node) else {
            return;
        };
        let is_variable_not_exact = |identifier| {
            let props_definition = find_variable_by_name(Node::Expr(node), identifier);
            matches!(props_definition, Some(Found::Init(it)) if is_not_exact(it))
        };
        if is_not_exact(right) || right.as_ident().is_some_and(is_variable_not_exact) {
            report_prop_types_error(node.span(), cx);
        }
    }

    fn member<'a>(&self, node: Member<'a>, cx: &mut Cx<'a, Self>) {
        if ast_utils::is_property_definition(node)
            && is_prop_types_declaration(Node::Member(node))
            && node.init().is_some_and(is_not_exact)
        {
            report_prop_types_error(node.span(), cx);
        }
    }
}

/// `node.parent.right`. `None`: the parent has none, and upstream throws.
fn right_of_parent(node: Expr<'_>) -> Option<Expr<'_>> {
    if node.is_chain_root() {
        return None;
    }
    match estree_parent(Node::Expr(node)) {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Binary { op: BinOp::Comma, .. } => None,
            ExprKind::Binary { right, .. } | ExprKind::Assign { value: right, .. } => Some(right),
            _ => None,
        },
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::ForIn { expr, .. } | StmtKind::ForOf { expr, .. } => Some(expr),
            _ => None,
        },
        _ => None,
    }
}

/// `isNonEmptyObjectExpression(node) || isNonExactPropWrapperFunction(node)`
fn is_not_exact(node: Expr<'_>) -> bool {
    match node.kind() {
        ExprKind::Object(properties) => !properties.is_empty(),
        ExprKind::Call(call) => {
            !node.is_chain_root() && !is_exact_prop_wrapper_function(node.file(), call.callee().text())
        }
        _ => false,
    }
}

/// `reportPropTypesError`
fn report_prop_types_error(node: Span, cx: &mut Cx<'_, PreferExactProps>) {
    let formatted_wrappers = format_exact_prop_wrapper_functions(cx.file()).unwrap_or_default();
    let message = match get_exact_prop_wrapper_functions(cx.file()).count() > 1 {
        true => [&b"one of "[..], formatted_wrappers.as_slice()].concat(),
        false => formatted_wrappers,
    };
    cx.report(node, PROP_TYPES).data("exactPropWrappers", message);
}
