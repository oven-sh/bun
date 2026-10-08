use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_loss_of_precision::register;

/// Disallow literal numbers that lose precision.
pub struct NoLossOfPrecision;

impl Rule for NoLossOfPrecision {
    const META: Meta = Meta::typescript("no-loss-of-precision", Kind::Problem)
        .deprecated()
        .extends_base_rule("no-loss-of-precision");
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoLossOfPrecision
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        register(on);
    }
}
