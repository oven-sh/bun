use crate::jest::{self, Ctx, Runner};
use crate::jest_matchers::prefer_to_be_simply_bool;
use bun_lint::prelude::*;

/// Prefer `toBeFalsy()` over `toBe(false)`, or `toBeTruthy()` over `toBe(true)`.
pub struct PreferToBeFalsy<const RUNNER: u8 = { jest::VITEST }, const TRUTHY: bool = false>;

impl<const RUNNER: u8, const TRUTHY: bool> Rule for PreferToBeFalsy<RUNNER, TRUTHY> {
    const META: Meta = jest::meta(
        RUNNER,
        if TRUTHY { "prefer-to-be-truthy" } else { "prefer-to-be-falsy" },
        Kind::Suggestion,
    )
    .has_suggestions();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferToBeFalsy
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::mentions_any(file, &const { jest::mention_bits(["expect", "expectTypeOf"]) }) && jest::mentions_any(file, &const { jest::mention_bits(["toBe", "toEqual", "toStrictEqual"]) }) && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &|node, ctx| prefer_to_be_simply_bool::run(node, ctx, TRUTHY));
    }
}
