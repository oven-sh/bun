use crate::jest::{self, Ctx};
use crate::jest_matchers::no_interpolation_in_snapshots;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevents the use of string interpolations in snapshots.
pub struct NoInterpolationInSnapshots;

impl Rule for NoInterpolationInSnapshots {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-interpolation-in-snapshots", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoInterpolationInSnapshots
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) && file.mentions_any(&no_interpolation_in_snapshots::INLINE_SNAPSHOT_MATCHERS) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                jest::run_on_jest_nodes(&ctx, &no_interpolation_in_snapshots::run);
            });
        }
    }
}
