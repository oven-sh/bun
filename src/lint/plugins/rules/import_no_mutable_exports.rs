use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbid the use of mutable exports with `var` or `let`.
pub struct NoMutableExports;

impl Rule for NoMutableExports {
    const META: Meta = Meta::plugin(Plugin::Import, "no-mutable-exports", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoMutableExports
    }

    fn register<'a>(&self, _: &mut Listeners<'a, Self>, _: &'a File<'a>) {}
}
