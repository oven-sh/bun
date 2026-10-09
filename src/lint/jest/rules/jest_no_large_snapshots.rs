use crate::jest::Ctx;
use crate::jest_matchers::no_large_snapshots::{NoLargeSnapshotsConfig, may_have_snapshot};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow large snapshots.
pub struct NoLargeSnapshots(NoLargeSnapshotsConfig);

impl Rule for NoLargeSnapshots {
    const META: Meta = Meta::oxlint(Plugin::Jest, "no-large-snapshots", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoLargeSnapshots(NoLargeSnapshotsConfig::new(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if may_have_snapshot(file) {
            on.finish(|rule, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                rule.0.run_once(&ctx);
            });
        }
    }
}
