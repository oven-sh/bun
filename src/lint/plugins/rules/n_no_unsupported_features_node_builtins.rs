use crate::n::{Builtins, data};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow unsupported Node.js built-in APIs on the specified version.
pub struct NodeBuiltins(Builtins);

impl Rule for NodeBuiltins {
    const META: Meta = Meta::plugin(Plugin::Node, "no-unsupported-features/node-builtins", Kind::Problem).recommended();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NodeBuiltins(Builtins::new(options, data::NODE_GLOBALS, data::NODE_MODULES, data::NODE_IMPORT_META))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        self.0.has_candidates(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.0.check(cx);
    }
}
