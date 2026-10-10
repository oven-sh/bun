use bun_lint_oxlint::import::{ImportEntry, ImportImportName};
use bun_lint_oxlint::module_record::{
    ExportEntry, ExportImportName, Loaded, ModuleRecord, NameSpan, StarExports, debug, get_loaded_module, is_waiting_for_modules,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;

/// Verify that all named imports are part of the set of named exports in the referenced module.
pub struct Named;

const NAMED: Message = Message::new("", "named import {{imported_name}} not found");

impl Rule for Named {
    const META: Meta = Meta::oxlint(Plugin::Import, "named", Kind::Problem).needs_modules();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Named
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // Before anything else: others ask what this file exports.
        if is_waiting_for_modules(file) || file.modules().is_none() || !file.is_javascript() {
            return None;
        }
        Some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let module_record = ModuleRecord::new(file);
        let mut star_exports = StarExports::default();
        let loaded_module = |specifier: Name<'a>| get_loaded_module(file, specifier.bytes()).filter(|it| it.record.has_module_syntax);
        let report = |name: NameSpan<'a>, module_name: Name<'a>| {
            cx.report(name.span, NAMED)
                .data("imported_name", debug(name.name.bytes()))
                .data("module_name", debug(module_name.bytes()));
        };
        for import_entry in &module_record.import_entries {
            let ImportImportName::Name(specifier) = import_entry.import_name else {
                continue;
            };
            let Some(remote) = loaded_module(import_entry.declaration.spec()) else {
                continue;
            };
            let import_name = NameSpan::from(specifier.imported());
            let name = import_name.name.bytes();
            if !(name == b"default" && remote.record.has_export_default) && !remote.exports(name) && !star_exports.contains(remote, name) {
                report(import_name, import_entry.declaration.spec());
            }
        }
        let is_default = |it: &&ImportEntry<'a>| matches!(it.import_name, ImportImportName::Default(_));
        let default_imports = module_record.import_entries.iter().filter(is_default);
        let default_imports: FxHashSet<_> = default_imports.map(|it| (it.declaration.spec(), it.local_name().name())).collect();
        for export_entry in &module_record.indirect_export_entries {
            let (Some(module_request), ExportImportName::Name(import_name)) = (export_entry.module_request, export_entry.import_name) else {
                continue;
            };
            let Some(remote) = loaded_module(module_request.name) else {
                continue;
            };
            let name = import_name.name.bytes();
            if !(name == b"default" && has_default_export(remote))
                && !is_reexport_of_default_import(&default_imports, export_entry, module_request, import_name, remote)
                && !remote.exports(name)
            {
                report(import_name, module_request.name);
            }
        }
    }
}

fn has_default_export(remote: Loaded) -> bool {
    remote.record.has_export_default || remote.exports(b"default")
}

/// It is made of an `import` and an `export { a }`.
fn is_synthesized_indirect_export_entry(export_entry: &ExportEntry) -> bool {
    !export_entry.statement_span.contains(export_entry.span)
}

/// `default_imports`: the specifier and the name of each `import name from "specifier"`.
fn is_reexport_of_default_import<'a>(
    default_imports: &FxHashSet<(Name<'a>, Name<'a>)>,
    export_entry: &ExportEntry<'a>,
    module_request: NameSpan<'a>,
    import_name: NameSpan<'a>,
    remote: Loaded,
) -> bool {
    is_synthesized_indirect_export_entry(export_entry)
        && has_default_export(remote)
        && default_imports.contains(&(module_request.name, import_name.name))
}
