use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_eslint::rules::no_inner_declarations::{
    Config, MOVE_DECL_TO_ROOT, State, get_allowed_body_description,
};

/// disallow variable or `function` declarations in nested blocks
pub struct NoInnerDeclarations(Config);

impl Rule for NoInnerDeclarations {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-inner-declarations", Kind::Problem).recommended();
    const ON: On = On::new().stmts(&[StmtTag::Fn, StmtTag::Var]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoInnerDeclarations(Config::new_for_svelte(options))
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        self.0.narrow()
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(AncestorMemo::default())
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let Some(finding) = self.0.finding(statement, cx.file()) else {
            return;
        };
        let body = get_allowed_body_description(statement, &mut cx.state);
        cx.report(statement, MOVE_DECL_TO_ROOT)
            .data("type", finding.kind)
            .data("body", body);
    }
}
