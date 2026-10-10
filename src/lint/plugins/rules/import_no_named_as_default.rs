use bun_lint_oxlint::import::{ImportImportName, import_entries};
use bun_lint_oxlint::module_record::{debug, get_loaded_module, is_waiting_for_modules};
use bun_lint::modules::{ImportName, IndirectExportEntry, ModuleId, Record};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::{FxHashMap, FxHashSet};

/// Forbid using an exported name as the identifier of a default export.
pub struct NoNamedAsDefault;

const NO_NAMED_AS_DEFAULT: Message = Message::new("", "Module {{export_name}} has named export {{module_name}}");

impl Rule for NoNamedAsDefault {
    const META: Meta = Meta::oxlint(Plugin::Import, "no-named-as-default", Kind::Problem).needs_modules();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNamedAsDefault
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if is_waiting_for_modules(file) || file.modules().is_none() {
            return None;
        }
        Some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut reexports: FxHashMap<ModuleId, Reexports> = FxHashMap::default();
        for entry in import_entries(cx.file()).filter(|it| !it.is_type()) {
            let ImportImportName::Default(local) = entry.import_name else {
                continue;
            };
            let (specifier, import_name) = (entry.declaration.spec().bytes(), local.bytes());
            if let Some(remote) = get_loaded_module(cx.file(), specifier)
                && remote.exports(import_name)
                && !reexports
                    .entry(remote.module)
                    .or_insert_with(|| Reexports::new(remote.record))
                    .default_and_named_are_same_reexport(import_name)
            {
                cx.report(local, NO_NAMED_AS_DEFAULT).data("export_name", debug(specifier)).data("module_name", debug(import_name));
            }
        }
    }
}

/// What another module exports that it has from elsewhere.
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
