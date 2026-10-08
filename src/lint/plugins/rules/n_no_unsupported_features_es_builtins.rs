use crate::n::{Builtins, data};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow unsupported ECMAScript built-ins on the specified version.
pub struct EsBuiltins(Builtins);

impl Rule for EsBuiltins {
    const META: Meta = Meta::plugin(Plugin::Node, "no-unsupported-features/es-builtins", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        EsBuiltins(Builtins::new(options, data::ES_GLOBALS, &[], &[]))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if self.0.has_candidates(file) {
            on.finish(|rule, cx| rule.0.check(cx));
        }
    }
}
