use bun_lint_oxlint::import::{ImportImportName, import_entries};
use bun_lint_oxlint::module_record::{debug, get_loaded_module, is_waiting_for_modules};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// If a default import is requested, this rule will report if there is no default export in the imported module.
pub struct Default;

const DEFAULT: Message = Message::new("", "No default export found in imported module {{imported_name}}");

/// `oxc_span`'s `VALID_EXTENSIONS`
fn has_valid_extension(path: &[u8]) -> bool {
    [&b".js"[..], b".mjs", b".cjs", b".jsx", b".ts", b".mts", b".cts", b".tsx"].iter().any(|it| path.ends_with(it))
}

impl Rule for Default {
    const META: Meta = Meta::oxlint(Plugin::Import, "default", Kind::Problem).needs_modules();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Default
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if is_waiting_for_modules(file) || file.modules().is_none() {
            return;
        }
        on.finish(|_, cx| {
            for entry in import_entries(cx.file()) {
                let ImportImportName::Default(local) = entry.import_name else {
                    continue;
                };
                let specifier = entry.declaration.spec().bytes();
                if let Some(remote) = get_loaded_module(cx.file(), specifier)
                    && remote.record.has_module_syntax
                    && has_valid_extension(remote.path())
                    && !remote.record.has_export_default
                    && !remote.exports(b"default")
                {
                    cx.report(local, DEFAULT).data("imported_name", debug(specifier));
                }
            }
        });
    }
}
