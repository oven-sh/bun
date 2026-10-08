use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow unsupported Node.js built-in APIs on the specified version.
pub struct NodeBuiltins;

impl Rule for NodeBuiltins {
    const META: Meta = Meta::plugin(Plugin::Node, "no-unsupported-features/node-builtins", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NodeBuiltins
    }

    fn register<'a>(&self, _: &mut Listeners<'a, Self>, _: &'a File<'a>) {}
}
