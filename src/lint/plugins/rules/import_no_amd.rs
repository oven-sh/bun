use bun_lint_oxlint::import::is_in_root_scope;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Forbids the use of AMD `require` and `define` calls.
pub struct NoAmd;

const NO_AMD: Message = Message::new("", "Do not use AMD `require` and `define` calls.");

impl Rule for NoAmd {
    const META: Meta = Meta::oxlint(Plugin::Import, "no-amd", Kind::Suggestion);
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
        if call.args().len() == 2
            && callee.as_ident().is_some_and(|name| name.is_any(&["define", "require"]))
            && !callee.is_parenthesized()
            && call.args().first().is_some_and(|it| it.tag() == ExprTag::Array && !it.is_parenthesized())
            && is_in_root_scope(Node::Expr(e), &mut cx.state)
        {
            cx.report(callee, NO_AMD).data("name", callee.text());
        }
    }
}
