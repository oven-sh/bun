use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Verifies the list of dependencies for Hooks like useEffect and similar.
pub struct ExhaustiveDeps;

impl Rule for ExhaustiveDeps {
    const META: Meta = Meta::plugin(Plugin::ReactHooks, "exhaustive-deps", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ExhaustiveDeps
    }

    fn register<'a>(&self, _: &mut Listeners<'a, Self>, _: &'a File<'a>) {}
}
