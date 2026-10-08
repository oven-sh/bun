use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow unsupported ECMAScript syntax on the specified version.
pub struct EsSyntax;

impl Rule for EsSyntax {
    const META: Meta = Meta::plugin(Plugin::Node, "no-unsupported-features/es-syntax", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        EsSyntax
    }

    fn register<'a>(&self, _: &mut Listeners<'a, Self>, _: &'a File<'a>) {}
}
