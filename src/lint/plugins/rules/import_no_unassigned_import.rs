use bun_lint_oxlint::import::is_require_call;
use bun_lint_oxlint::text::glob_match;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule aims to remove modules with side-effects by reporting when a module is imported but not assigned.
pub struct NoUnassignedImport {
    globs: Vec<Box<[u8]>>,
}

const IMPORT: Message = Message::new("", "Imported module should be assigned");
const REQUIRE: Message = Message::new("", "A `require()` style import is forbidden.");

impl Rule for NoUnassignedImport {
    const META: Meta = Meta::oxlint(Plugin::Import, "no-unassigned-import", Kind::Problem);
    const ON: On = On::new().stmts(&[StmtTag::Import]).exprs(&[ExprTag::Call]);
    no_state!();

    fn new(options: &Options) -> Self {
        NoUnassignedImport { globs: options.object(0).strings("allow").iter().map(|it| it.as_bytes().into()).collect() }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().stmts(&[StmtTag::Import]);
        if !file.mentions("require") {
            return on;
        }
        on.exprs(&[ExprTag::Call])
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Import(import) = stmt.kind()
            && import.is_side_effect()
            && !self.is_match_allow_globs(import.spec())
        {
            cx.report(stmt, IMPORT);
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(call) = e.as_call()
            && is_require_call(call)
            && let Some(source) = call.args().first().and_then(Expr::as_string)
            && !e.is_parenthesized()
            && !e.is_chain_root()
            && matches!(e.parent(), Node::Stmt(stmt) if stmt.tag() == StmtTag::Expr)
            && !self.is_match_allow_globs(source)
        {
            cx.report(e, REQUIRE);
        }
    }
}

impl NoUnassignedImport {
    fn is_match_allow_globs(&self, source: Name) -> bool {
        self.globs.iter().any(|glob| glob_match(glob, source.bytes()))
    }
}
