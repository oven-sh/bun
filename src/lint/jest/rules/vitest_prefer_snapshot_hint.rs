use crate::jest::Ctx;
use crate::jest_matchers::prefer_snapshot_hint::{SNAPSHOT_MATCHERS, SnapshotHintMode};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces including a hint string with snapshot matchers (toMatchSnapshot and toThrowErrorMatchingSnapshot).
pub struct PreferSnapshotHint(SnapshotHintMode);

impl Rule for PreferSnapshotHint {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-snapshot-hint", Kind::Problem);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferSnapshotHint(SnapshotHintMode::new(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.mentions_any(&SNAPSHOT_MATCHERS) {
            on.finish(|rule, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                rule.0.run_once(&ctx);
            });
        }
    }
}
