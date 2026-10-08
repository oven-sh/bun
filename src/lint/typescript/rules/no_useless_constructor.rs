use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_useless_constructor::check;

/// Disallow unnecessary constructors.
pub struct NoUselessConstructor;

impl Rule for NoUselessConstructor {
    const META: Meta = Meta::typescript("no-useless-constructor", Kind::Problem)
        .has_suggestions()
        .presets(Presets::STRICT)
        .extends_base_rule("no-useless-constructor");
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUselessConstructor
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.members(|_, member, cx| check(member, cx));
    }
}
