use bun_lint_oxlint::ast_util::{get_inner_expression, is_import_symbol};
use crate::oxlint::vue::{is_this_object, is_vue_file};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow using deprecated `$set` / `$delete` (in Vue.js 3.0.0+).
pub struct NoDeprecatedDeleteSet;

const NO_DEPRECATED_DELETE_SET: Message = Message::new("", "`$delete` and `$set` are deprecated.");

impl Rule for NoDeprecatedDeleteSet {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-deprecated-delete-set", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    /// That something is in a component.
    type State<'a> = AncestorMemo<'a, ()>;

    fn new(_: &Options) -> Self {
        NoDeprecatedDeleteSet
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (is_vue_file(file) && file.mentions_any(&["set", "delete", "del", "$set", "$delete"])).then(AncestorMemo::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(callee) = e.callee().map(get_inner_expression) else {
            return;
        };
        match callee.kind() {
            ExprKind::Dot { obj, name, .. } if !callee.is_private_member() => {
                let is_deprecated = match name.bytes() {
                    b"set" | b"delete" => is_vue_global_or_default_import(get_inner_expression(obj)),
                    b"$set" | b"$delete" => is_this_object(obj) && is_in_vue_component(e, &mut cx.state),
                    _ => false,
                };
                if is_deprecated {
                    cx.report(name, NO_DEPRECATED_DELETE_SET);
                }
            }
            ExprKind::Ident(_) if is_import_symbol(callee, "vue", "set") || is_import_symbol(callee, "vue", "del") => {
                cx.report(callee, NO_DEPRECATED_DELETE_SET);
            }
            _ => {}
        }
    }
}

/// In an `export default ..`, or in a call of the `defineComponent` of Vue.
fn is_in_vue_component<'a>(node: Expr<'a>, memo: &mut AncestorMemo<'a, ()>) -> bool {
    let is_component = |ancestor: Node| match ancestor {
        Node::Stmt(stmt) => stmt.tag() == StmtTag::ExportDefault || stmt.is_default_export(),
        Node::Expr(e) => e.as_call().is_some_and(|it| is_import_symbol(get_inner_expression(it.callee()), "vue", "defineComponent")),
        _ => false,
    };
    memo.find(Node::Expr(node), |_, parent| is_component(parent).then_some(())).is_some()
}

/// `Vue`, which nothing declares, or which is all of `vue` or what it exports by default.
fn is_vue_global_or_default_import(ident: Expr) -> bool {
    ident.is_ident("Vue")
        && match ident.symbol().map(|it| it.declarations().next()) {
            None => true,
            Some(Some(Declaration::ImportDefault(import) | Declaration::ImportNamespace(import))) => import.spec().is("vue"),
            Some(_) => false,
        }
}
