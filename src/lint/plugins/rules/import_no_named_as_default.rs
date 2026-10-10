use crate::import_export_map::{ExportMaps, PARSE_ERRORS};
use bun_lint_oxlint::module_record::{debug, get_loaded_module, is_waiting_for_modules};
use bun_lint::modules::{ImportName, IndirectExportEntry, ModuleId, Record};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::{FxHashMap, FxHashSet};

/// Forbid use of exported name as identifier of default export.
pub struct NoNamedAsDefault;

const USING_EXPORTED_NAME: Message = Message::new("", "Using exported name '{{name}}' as identifier for default import.");
const OXLINT: Message = Message::new("", "Module {{export_name}} has named export {{module_name}}");

pub struct State<'a> {
    /// `None`: oxlint asks its own records.
    maps: Option<ExportMaps<'a>>,
}

impl Rule for NoNamedAsDefault {
    const META: Meta = Meta::plugin(Plugin::Import, "no-named-as-default", Kind::Problem).needs_modules();
    const ON: On = On::new().finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoNamedAsDefault
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        if file.language().is_oxlint {
            return (!is_waiting_for_modules(file) && file.modules().is_some()).then_some(State { maps: None });
        }
        if !file.has_stmts([StmtTag::Import]) {
            return None;
        }
        Some(State { maps: Some(ExportMaps::of(file)?) })
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut reexports: FxHashMap<ModuleId, Reexports> = FxHashMap::default();
        for stmt in cx.file().stmts_of_kind(StmtTag::Import) {
            let StmtKind::Import(declaration) = stmt.kind() else {
                continue;
            };
            let Some(local) = declaration.default() else {
                continue;
            };
            if let Some(maps) = &cx.state.maps {
                check_default(declaration, local, maps, cx);
                continue;
            }
            // oxlint's record has what is at the top level, and it passes over the types.
            if declaration.is_type_only() || !matches!(stmt.parent(), Node::File(_)) {
                continue;
            }
            let (specifier, import_name) = (declaration.spec().bytes(), local.bytes());
            if let Some(remote) = get_loaded_module(cx.file(), specifier)
                && remote.exports(import_name)
                && !reexports
                    .entry(remote.module)
                    .or_insert_with(|| Reexports::new(remote.record))
                    .default_and_named_are_same_reexport(import_name)
            {
                cx.report(local, OXLINT).data("export_name", debug(specifier)).data("module_name", debug(import_name));
            }
        }
    }
}

/// upstream's `checkDefault`, of an `ImportDefaultSpecifier`.
fn check_default<'a>(declaration: Import<'a>, local: Ident<'a>, maps: &ExportMaps<'a>, cx: &Cx<'a, NoNamedAsDefault>) {
    let (source, analyzed_name) = (declaration.spec().bytes(), local.bytes());
    let Some(imported_module) = maps.get(source) else {
        return;
    };
    if imported_module.has_errors() {
        if let Some(at) = declaration.spec_span() {
            cx.report(at, PARSE_ERRORS).data("source", source).data("errors", imported_module.errors_text());
        }
        return;
    }
    if !maps.has_default(imported_module) || !maps.has(imported_module, analyzed_name) {
        return;
    }
    if let Some((_, named)) = maps.reexport(imported_module, analyzed_name)
        && let Some((_, default)) = maps.reexport(imported_module, b"default")
    {
        // Where one of them is ignored upstream throws.
        let (Some(named), Some(default)) = (named, default) else {
            return;
        };
        // It compares `local` of the two modules too, which no module has.
        if named.path() == default.path() {
            return;
        }
    }
    cx.report(local, USING_EXPORTED_NAME).data("name", local);
}

/// What another module exports that it has from elsewhere, for oxlint.
struct Reexports<'m> {
    /// The first of the `indirect_export_entries` with each `export_name`.
    by_export_name: FxHashMap<&'m [u8], &'m IndirectExportEntry>,
    /// The specifier and the name of each `import name from "specifier"`.
    default_imports: FxHashSet<(&'m [u8], &'m [u8])>,
}

impl<'m> Reexports<'m> {
    fn new(remote: &'m Record) -> Self {
        let mut by_export_name = FxHashMap::default();
        for entry in remote.indirect_export_entries.iter() {
            by_export_name.entry(&*entry.export_name).or_insert(entry);
        }
        let default_imports = remote.import_entries.iter().filter(|it| matches!(it.import_name, ImportName::Default));
        Reexports { by_export_name, default_imports: default_imports.map(|it| (&*it.module_request, &*it.local_name)).collect() }
    }

    /// `export { a as default, a } from "m"`, and the same of what is imported from `m`.
    fn default_and_named_are_same_reexport(&self, name: &[u8]) -> bool {
        let (Some(default_entry), Some(named_entry)) = (self.by_export_name.get(&b"default"[..]), self.by_export_name.get(name)) else {
            return false;
        };
        let (Some(default_import), Some(named_import)) = (&default_entry.import_name, &named_entry.import_name) else {
            return false;
        };
        if default_entry.module_request != named_entry.module_request {
            return false;
        }
        // Of `import a from "m"; export { a as default }` the record has the name `a`.
        let is_default_import = self.default_imports.contains(&(&*default_entry.module_request, &**default_import));
        if is_default_import { **named_import == *b"default" } else { default_import == named_import }
    }
}
