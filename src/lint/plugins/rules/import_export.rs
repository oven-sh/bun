use bun_lint_oxlint::module_record::{
    ExportEntry, ExportExportName, Loaded, ModuleRecord, get_loaded_module, is_waiting_for_modules,
};
use bun_lint_oxlint::text::find_next_token_within;
use bun_core::strings;
use bun_lint::modules::ModuleId;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::{FxHashMap, FxHashSet};

/// Reports funny business with exports, like repeated exports of names or defaults.
pub struct Export;

const NO_NAMED_EXPORT: Message = Message::new("", "No named exports found in module '{{module_name}}'");
const MULTIPLE_EXPORTS: Message = Message::new("", "Multiple exports of name '{{name}}'.");

impl Rule for Export {
    const META: Meta = Meta::oxlint(Plugin::Import, "export", Kind::Problem).needs_modules();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Export
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (!is_waiting_for_modules(file)).then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let module_record = ModuleRecord::new(file);
        diagnose_duplicate_named_exports(&module_record, cx);
        // The first `export *` that brings each name.
        let mut all_export_names: FxHashMap<&'a [u8], Span> = FxHashMap::default();
        let mut visited = FxHashSet::default();
        for star_export_entry in module_record.star_export_entries.iter().filter(|it| !it.is_type) {
            let Some(module_request) = star_export_entry.module_request else {
                continue;
            };
            let Some(remote) = get_loaded_module(file, module_request.name.bytes()) else {
                continue;
            };
            let export_names = walk_exported_recursive(remote, &mut visited);
            if export_names.is_empty() {
                cx.report(module_request.span, NO_NAMED_EXPORT).data("module_name", module_request.name);
            } else {
                for name in export_names {
                    all_export_names.entry(name).or_insert(star_export_entry.span);
                }
            }
        }
        if all_export_names.is_empty() {
            return;
        }
        for (name, span) in &module_record.exported_bindings {
            if let Some(first) = all_export_names.get(name.bytes()) {
                cx.report(*first, MULTIPLE_EXPORTS).data("name", *name).label(*span, "");
            }
        }
    }
}

fn export_name<'a>(export_entry: &ExportEntry<'a>) -> Option<(&'a [u8], Span)> {
    match export_entry.export_name {
        ExportExportName::Name(name) => Some((name.name.bytes(), name.span)),
        ExportExportName::Default(span) => Some((b"default", span)),
        ExportExportName::Null => None,
    }
}

fn diagnose_duplicate_named_exports<'a>(module_record: &ModuleRecord<'a>, cx: &Cx<'a, Export>) {
    struct ExportNameSpans {
        first: Span,
        count: usize,
        has_named_specifier: bool,
    }
    let entries = || module_record.local_export_entries.iter().chain(&module_record.indirect_export_entries);
    // By the name, and whether it is the name of a type.
    let mut export_names: FxHashMap<(&'a [u8], bool), ExportNameSpans> = FxHashMap::default();
    for export_entry in entries() {
        if let Some((name, first)) = export_name(export_entry) {
            let new = ExportNameSpans { first, count: 0, has_named_specifier: false };
            export_names.entry((name, export_entry.is_type)).or_insert(new).count += 1;
        }
    }
    export_names.retain(|_, it| it.count > 1);
    if export_names.is_empty() {
        return;
    }
    for export_entry in entries() {
        if let Some((name, _)) = export_name(export_entry)
            && let Some(spans) = export_names.get_mut(&(name, export_entry.is_type))
        {
            spans.has_named_specifier |= is_named_export_specifier(export_entry, cx.file());
        }
    }
    for ((name, is_type), spans) in export_names.iter().filter(|it| it.1.has_named_specifier) {
        cx.report(spans.first, MULTIPLE_EXPORTS).data("name", *name).labels_with(|labels| {
            let same = entries().filter(|it| it.is_type == *is_type).filter_map(export_name).filter(|it| it.0 == *name);
            for (_, span) in same.skip(1) {
                labels.push(span, "");
            }
        });
    }
}

/// It is in braces.
fn is_named_export_specifier<'a>(export_entry: &ExportEntry<'a>, file: &'a File<'a>) -> bool {
    // What is made of an `import` and an `export { a }` has the place of the import, which can come later.
    export_entry.statement_span.start > export_entry.span.start
        || find_next_token_within(file, Span::before(export_entry.statement_span.start, export_entry.span), b"{").is_some()
}

/// The names that `module` exports, with those that it gets by `export *`. Nothing of what is in `visited`, or in a `node_modules`.
fn walk_exported_recursive<'m>(module: Loaded<'m>, visited: &mut FxHashSet<ModuleId>) -> FxHashSet<&'m [u8]> {
    let mut result = FxHashSet::default();
    let mut pending = vec![module];
    while let Some(at) = pending.pop() {
        let is_in_node_modules = strings::split(at.path(), b"/").any(|it| it == b"node_modules");
        if is_in_node_modules || !visited.insert(at.module) {
            continue;
        }
        result.extend(at.record.exported_bindings.iter().map(|it| &**it));
        pending.extend(at.record.star_export_entries.iter().filter_map(|it| at.get_loaded_module(it)));
    }
    result
}
