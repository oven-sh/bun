use crate::jest::Ctx;
use crate::jest_mocks::no_mocks_import;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule reports imports from a path containing a `__mocks__` component.
pub struct NoMocksImport;

impl Rule for NoMocksImport {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-mocks-import", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoMocksImport
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.has_stmts([StmtTag::Import]) || file.mentions("require") {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                no_mocks_import::run_once(&ctx);
            });
        }
    }
}
