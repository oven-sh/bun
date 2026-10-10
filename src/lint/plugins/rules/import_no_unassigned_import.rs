use crate::import_minimatch::GlobsFromCwd;
use crate::module_visitor::static_require;
use bun_lint::paths;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::import::is_require_call;
use bun_lint_oxlint::text::glob_match;

/// Forbid unassigned imports.
pub struct NoUnassignedImport {
    /// `allow`, as it is written: so oxlint matches it.
    globs: Vec<Box<[u8]>>,
    allow: GlobsFromCwd,
}

const IMPORT: Message = Message::new("", "Imported module should be assigned");
const REQUIRE: Message = Message::new("", "A `require()` style import is forbidden.");

impl Rule for NoUnassignedImport {
    const META: Meta = Meta::plugin(Plugin::Import, "no-unassigned-import", Kind::Suggestion).needs_modules();
    const ON: On = On::new().stmts(&[StmtTag::Import]).exprs(&[ExprTag::Call]);
    no_state!();

    fn new(options: &Options) -> Self {
        let allow = options.object(0).strings("allow");
        NoUnassignedImport {
            globs: allow.iter().map(|it| it.as_bytes().into()).collect(),
            allow: GlobsFromCwd::new(&allow),
        }
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
            && import.default().is_none()
            && import.namespace().is_none()
            && import.named().is_empty()
            // oxlint takes what `import {} from "a"` imports for assigned.
            && !(import.has_named_imports() && cx.language().is_oxlint)
            && !self.is_allow(import.spec().bytes(), cx.file())
        {
            cx.report(stmt, IMPORT);
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        if e.is_chain_root() || !matches!(e.parent(), Node::Stmt(stmt) if stmt.tag() == StmtTag::Expr) {
            return;
        }
        let is_oxlint = cx.language().is_oxlint;
        // oxlint sees parentheses, and has a text of its own.
        let (argument, message) = match is_oxlint {
            true => (call.args().first().filter(|_| is_require_call(call) && !e.is_parenthesized()), REQUIRE),
            false => (static_require(call), IMPORT),
        };
        if let Some(source) = argument.and_then(Expr::as_string)
            && !self.is_allow(source.bytes(), cx.file())
        {
            cx.report(e, message);
        }
    }
}

impl NoUnassignedImport {
    /// upstream's `testIsAllow`
    fn is_allow(&self, source: &[u8], file: &File) -> bool {
        if self.globs.is_empty() {
            return false;
        }
        // oxlint matches what is written.
        if file.language().is_oxlint {
            return self.globs.iter().any(|glob| glob_match(glob, source));
        }
        let Some(modules) = file.modules() else {
            return false;
        };
        let cwd = modules.cwd();
        if !matches!(source.first(), Some(b'.' | b'/')) {
            return self.allow.matches(cwd, source);
        }
        let filename = paths::portable(file.path(), file.path());
        let directory = paths::resolve(cwd, paths::dirname(&filename));
        self.allow.matches(cwd, &paths::resolve(&directory, source))
    }
}
