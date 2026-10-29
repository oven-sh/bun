use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_loss_of_precision::{check, ignores_decimals};

/// Disallow literal numbers that lose precision.
pub struct NoLossOfPrecision {
    ignore_decimals: bool,
}

impl Rule for NoLossOfPrecision {
    const META: Meta = Meta::typescript("no-loss-of-precision", Kind::Problem)
        .deprecated()
        .extends_base_rule("no-loss-of-precision");
    const ON: On = On::new().number_literals();
    no_state!();

    fn new(options: &Options) -> Self {
        NoLossOfPrecision { ignore_decimals: ignores_decimals(options) }
    }

    fn number_literal<'a>(&self, literal: Literal<'a>, cx: &mut Cx<'a, Self>) {
        check(literal, self.ignore_decimals, cx);
    }
}
