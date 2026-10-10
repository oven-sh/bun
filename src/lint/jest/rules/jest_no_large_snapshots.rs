use crate::jest::Ctx;
use crate::jest_matchers::no_large_snapshots::{NoLargeSnapshotsConfig, may_have_snapshot};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow large snapshots.
pub struct NoLargeSnapshots(NoLargeSnapshotsConfig);

impl Rule for NoLargeSnapshots {
    const META: Meta = Meta::oxlint(Plugin::Jest, "no-large-snapshots", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoLargeSnapshots(NoLargeSnapshotsConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        may_have_snapshot(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        self.0.run_once(&ctx);
    }
}
