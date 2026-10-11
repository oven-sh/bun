use crate::n::table::Part;
use crate::n::{Builtins, data};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow unsupported ECMAScript built-ins, or Node.js built-in APIs, on the specified version.
pub struct UnsupportedBuiltins<const OF_NODE: bool = false>(Builtins);

impl<const OF_NODE: bool> Rule for UnsupportedBuiltins<OF_NODE> {
    const META: Meta = Meta::plugin(
        Plugin::Node,
        if OF_NODE { "no-unsupported-features/node-builtins" } else { "no-unsupported-features/es-builtins" },
        Kind::Problem,
    )
    .recommended()
    .reports_on_exit();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        UnsupportedBuiltins(match OF_NODE {
            true => Builtins::new(options, data::NODE_GLOBALS, data::NODE_MODULES, data::NODE_IMPORT_META),
            false => Builtins::new(options, data::ES_GLOBALS, Part::EMPTY, Part::EMPTY),
        })
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        self.0.has_candidates(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.0.check(cx);
    }
}
