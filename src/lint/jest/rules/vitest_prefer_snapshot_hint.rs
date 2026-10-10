use crate::jest::Ctx;
use crate::jest_matchers::prefer_snapshot_hint::{SNAPSHOT_MATCHERS, SnapshotHintMode};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces including a hint string with snapshot matchers (toMatchSnapshot and toThrowErrorMatchingSnapshot).
pub struct PreferSnapshotHint(SnapshotHintMode);

impl Rule for PreferSnapshotHint {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-snapshot-hint", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferSnapshotHint(SnapshotHintMode::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions_any(&SNAPSHOT_MATCHERS).then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        self.0.run_once(&ctx);
    }
}
