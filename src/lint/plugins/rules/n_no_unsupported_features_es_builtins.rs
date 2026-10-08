use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow unsupported ECMAScript built-ins on the specified version.
pub struct EsBuiltins;

impl Rule for EsBuiltins {
    const META: Meta = Meta::plugin(Plugin::Node, "no-unsupported-features/es-builtins", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        EsBuiltins
    }

    fn register<'a>(&self, _: &mut Listeners<'a, Self>, _: &'a File<'a>) {}
}
