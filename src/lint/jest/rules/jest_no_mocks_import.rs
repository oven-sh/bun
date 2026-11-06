use crate::jest::{self, Ctx, Runner};
use crate::jest_mocks::no_mocks_import;
use bun_lint::prelude::*;

/// This rule reports imports from a path containing a `__mocks__` component.
pub struct NoMocksImport<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for NoMocksImport<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-mocks-import", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoMocksImport
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.has_stmts([StmtTag::Import]) || file.mentions("require")).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        no_mocks_import::run_once(&ctx);
    }
}
