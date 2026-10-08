use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevents using object or array spreads on accumulators in `Array.prototype.reduce()` and in loops.
pub struct NoAccumulatingSpread;

impl Rule for NoAccumulatingSpread {
    const META: Meta = Meta::plugin(Plugin::Oxc, "no-accumulating-spread", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoAccumulatingSpread
    }

    fn register<'a>(&self, _: &mut Listeners<'a, Self>, _: &'a File<'a>) {}
}
