use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbid a module from importing a module with a dependency path back to itself.
pub struct NoCycle;

impl Rule for NoCycle {
    const META: Meta = Meta::plugin(Plugin::Import, "no-cycle", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoCycle
    }

    fn register<'a>(&self, _: &mut Listeners<'a, Self>, _: &'a File<'a>) {}
}
