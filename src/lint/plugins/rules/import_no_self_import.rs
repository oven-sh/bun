use bun_lint_oxlint::module_record::{get_loaded_module, is_waiting_for_modules, requested_modules};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbid a module from importing itself.
pub struct NoSelfImport;

const NO_SELF_IMPORT: Message = Message::new("", "A module importing itself is not allowed");

impl Rule for NoSelfImport {
    const META: Meta = Meta::oxlint(Plugin::Import, "no-self-import", Kind::Problem).needs_modules();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoSelfImport
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if is_waiting_for_modules(file) || file.modules().is_none() {
            return;
        }
        on.finish(|_, cx| {
            let file = cx.file();
            let Some(me) = file.modules().and_then(|it| it.find(file.path())) else {
                return;
            };
            for (request, requested) in requested_modules(file) {
                if get_loaded_module(file, request.bytes()).is_some_and(|it| it.module == me) {
                    for requested_module in requested {
                        cx.report(requested_module.span, NO_SELF_IMPORT);
                    }
                }
            }
        });
    }
}
