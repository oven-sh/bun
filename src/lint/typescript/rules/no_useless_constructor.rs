use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_useless_constructor::check;

/// Disallow unnecessary constructors.
pub struct NoUselessConstructor;

impl Rule for NoUselessConstructor {
    const META: Meta = Meta::typescript("no-useless-constructor", Kind::Problem)
        .has_suggestions()
        .presets(Presets::STRICT)
        .extends_base_rule("no-useless-constructor");
    const ON: On = On::new().members();
    no_state!();

    fn new(_: &Options) -> Self {
        NoUselessConstructor
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        check(member, cx);
    }
}
