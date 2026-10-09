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
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoUnassignedImport { globs: options.object(0).strings("allow").iter().map(|it| it.as_bytes().into()).collect() }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        on.stmts([StmtTag::Import], |rule, stmt, cx| {
            if let StmtKind::Import(import) = stmt.kind()
                && import.is_side_effect()
                && !rule.is_match_allow_globs(import.spec())
            {
                cx.report(stmt, IMPORT);
            }
        });
        if !file.mentions("require") {
            return;
        }
        on.exprs([ExprTag::Call], |rule, e, cx| {
            if let Some(call) = e.as_call()
                && is_require_call(call)
                && let Some(source) = call.args().first().and_then(Expr::as_string)
                && !e.is_parenthesized()
                && !e.is_chain_root()
                && matches!(e.parent(), Node::Stmt(stmt) if stmt.tag() == StmtTag::Expr)
                && !rule.is_match_allow_globs(source)
            {
                cx.report(e, REQUIRE);
            }
        });
    }
}

impl NoUnassignedImport {
    fn is_match_allow_globs(&self, source: Name) -> bool {
        self.globs.iter().any(|glob| glob_match(glob, source.bytes()))
    }
}
