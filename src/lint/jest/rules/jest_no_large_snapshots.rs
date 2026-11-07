use crate::jest::{self, Ctx, Runner};
use crate::jest_matchers::no_large_snapshots::{NoLargeSnapshotsConfig, may_have_snapshot};
use bun_lint::prelude::*;

/// Disallow large snapshots.
pub struct NoLargeSnapshots<const RUNNER: u8 = { jest::JEST }>(NoLargeSnapshotsConfig);

impl<const RUNNER: u8> Rule for NoLargeSnapshots<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-large-snapshots", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoLargeSnapshots(NoLargeSnapshotsConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && may_have_snapshot(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        self.0.run_once(&ctx);
    }
}
