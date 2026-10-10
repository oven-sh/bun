use bun_lint_oxlint::import::is_in_root_scope;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Forbid AMD `require` and `define` calls.
pub struct NoAmd;

const EXPECTED_IMPORTS: Message = Message::new("", "Expected imports instead of AMD {{name}}().");
const OXLINT: Message = Message::new("", "Do not use AMD `require` and `define` calls.");

impl Rule for NoAmd {
    const META: Meta = Meta::plugin(Plugin::Import, "no-amd", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = AncestorMemo<'a, ()>;

    fn new(_: &Options) -> Self {
        NoAmd
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !file.mentions_any(&["define", "require"]) {
            return None;
        }
        Some(AncestorMemo::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let callee = call.callee();
        let Some(modules) = call.args().first().filter(|it| call.args().len() == 2 && it.tag() == ExprTag::Array) else {
            return;
        };
        if !callee.as_ident().is_some_and(|name| name.is_any(&["define", "require"])) {
            return;
        }
        if !cx.language().is_oxlint {
            if Node::Expr(e).scope().kind() == ScopeKind::Module {
                cx.report(e, EXPECTED_IMPORTS).data("name", callee.text());
            }
            return;
        }
        // oxlint takes parentheses for nodes, has one scope at the top of any file, and points at the callee.
        if !callee.is_parenthesized() && !modules.is_parenthesized() && is_in_root_scope(Node::Expr(e), &mut cx.state) {
            cx.report(callee, OXLINT).data("name", callee.text());
        }
    }
}
