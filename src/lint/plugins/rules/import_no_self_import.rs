use crate::import_resolve::Resolvers;
use crate::module_visitor::{Systems, Visitor};
use bun_lint::paths;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::module_record::{get_loaded_module, is_waiting_for_modules};

/// Forbid a module from importing itself.
pub struct NoSelfImport;

const IMPORTS_ITSELF: Message = Message::new("", "Module imports itself.");
const OXLINT: Message = Message::new("", "A module importing itself is not allowed");

/// oxlint does not look at `require`.
fn visitor(is_oxlint: bool) -> Visitor {
    Visitor::of(Systems { esmodule: true, commonjs: !is_oxlint, amd: false })
}

impl Rule for NoSelfImport {
    const META: Meta = Meta::plugin(Plugin::Import, "no-self-import", Kind::Problem).recommended().needs_modules();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoSelfImport
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        let is_oxlint = file.language().is_oxlint;
        // oxlint asks about modules that it has read.
        if is_oxlint && is_waiting_for_modules(file) {
            return None;
        }
        let is_on_the_disk = file.modules().is_some() && file.path() != b"<text>";
        (is_on_the_disk && visitor(is_oxlint).may_visit(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let is_oxlint = file.language().is_oxlint;
        let visited = visitor(is_oxlint).visit(file);
        if is_oxlint {
            // oxlint knows the declarations at the top level, resolves in its own way, and points at the specifier.
            let Some(me) = file.modules().and_then(|it| it.find(file.path())) else {
                return;
            };
            for it in visited.iter().filter(|it| matches!(it.importer.parent(), Node::File(_))) {
                if get_loaded_module(file, it.specifier).is_some_and(|it| it.module == me) {
                    cx.report(it.source, OXLINT);
                }
            }
            return;
        }
        let Some(resolvers) = Resolvers::of(file.settings()) else {
            return;
        };
        let file_path = paths::portable(file.path(), file.path());
        for it in visited {
            if resolvers.resolve(file, it.specifier, it.is_require).file() == Some(&file_path[..]) {
                cx.report(it.importer, IMPORTS_ITSELF);
            }
        }
    }
}
