use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_snapshot_hint::{SNAPSHOT_MATCHERS, SnapshotHintMode};
use bun_lint::prelude::*;

/// Enforces including a hint string with snapshot matchers (toMatchSnapshot and toThrowErrorMatchingSnapshot).
pub struct PreferSnapshotHint<const VITEST: bool = false>(SnapshotHintMode);

impl<const VITEST: bool> Rule for PreferSnapshotHint<VITEST> {
    const META: Meta = Meta::oxlint(jest::plugin(VITEST), "prefer-snapshot-hint", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferSnapshotHint(SnapshotHintMode::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions_any(&SNAPSHOT_MATCHERS).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        self.0.run_once(&ctx);
    }
}
