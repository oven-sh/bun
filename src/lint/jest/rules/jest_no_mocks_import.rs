use crate::jest::{self, Ctx};
use crate::jest_mocks::no_mocks_import;
use bun_lint::prelude::*;

/// This rule reports imports from a path containing a `__mocks__` component.
pub struct NoMocksImport<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for NoMocksImport<VITEST> {
    const META: Meta = Meta::oxlint(jest::plugin(VITEST), "no-mocks-import", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoMocksImport
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.has_stmts([StmtTag::Import]) || file.mentions("require")).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        no_mocks_import::run_once(&ctx);
    }
}
