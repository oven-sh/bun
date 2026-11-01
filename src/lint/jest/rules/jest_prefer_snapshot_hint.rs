use crate::jest::{self, Ctx, Runner};
use crate::jest_matchers::prefer_snapshot_hint::{SNAPSHOT_MATCHERS, SnapshotHintMode};
use bun_lint::prelude::*;

/// Enforces including a hint string with snapshot matchers (toMatchSnapshot and toThrowErrorMatchingSnapshot).
pub struct PreferSnapshotHint<const RUNNER: u8 = { jest::JEST }>(SnapshotHintMode);

impl<const RUNNER: u8> Rule for PreferSnapshotHint<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "prefer-snapshot-hint", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferSnapshotHint(SnapshotHintMode::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && file.mentions("expect") && jest::mentions_any(file, &const { jest::mention_bits(SNAPSHOT_MATCHERS) })).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        self.0.run_once(&ctx);
    }
}
