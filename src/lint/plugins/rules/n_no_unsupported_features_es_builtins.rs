use crate::n::table::Part;
use crate::n::{Builtins, data};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow unsupported ECMAScript built-ins on the specified version.
pub struct EsBuiltins(Builtins);

impl Rule for EsBuiltins {
    const META: Meta = Meta::plugin(Plugin::Node, "no-unsupported-features/es-builtins", Kind::Problem).recommended();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        EsBuiltins(Builtins::new(options, data::ES_GLOBALS, Part::EMPTY, Part::EMPTY))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        self.0.has_candidates(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.0.check(cx);
    }
}
