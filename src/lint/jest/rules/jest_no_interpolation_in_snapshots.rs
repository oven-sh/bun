use crate::jest::{self, Ctx, Runner};
use crate::jest_matchers::no_interpolation_in_snapshots;
use bun_lint::prelude::*;

/// Prevents the use of string interpolations in snapshots.
pub struct NoInterpolationInSnapshots<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for NoInterpolationInSnapshots<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-interpolation-in-snapshots", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoInterpolationInSnapshots
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        const MATCHERS: [u32; 2] = jest::mention_bits(no_interpolation_in_snapshots::INLINE_SNAPSHOT_MATCHERS);
        (file.mentions("expect") && jest::mentions_any(file, &MATCHERS) && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &no_interpolation_in_snapshots::run);
    }
}
