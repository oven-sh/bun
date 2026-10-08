use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_magic_numbers::{Checker, Checks};

/// Disallow magic numbers.
pub struct NoMagicNumbers(Checker);

impl Checks for NoMagicNumbers {
    fn checker(&self) -> &Checker {
        &self.0
    }
}

impl Rule for NoMagicNumbers {
    const META: Meta =
        Meta::typescript("no-magic-numbers", Kind::Suggestion).extends_base_rule("no-magic-numbers");
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoMagicNumbers(Checker::new(options, true))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        self.0.register(on);
    }
}
