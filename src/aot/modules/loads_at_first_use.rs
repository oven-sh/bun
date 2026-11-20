//! Which built-in modules an import statement leaves to their first use.
//!
//! `src/codegen/builtins/data/acts-at-load.txt` says of each module what its load does that a program can see. A load that
//! does nothing of that, and that reads nothing but what the host can ask of where the importer links, shows in no way when
//! it runs. The file that imports such a module runs no body of Bun's when it is linked: the module runs where a name that a
//! statement binds is first read, or where anything else first asks for it, and the loader takes the exports then. The host
//! may still say, where the importer links, that a program can write what the load reads: then the module runs there, as it
//! did before.

#[cfg(test)]
mod tests;

use super::imports::FileImports;
use super::interop::ImportPhase;
use super::module_set::ModuleSet;
use super::requests::Scans;
use super::{BindInput, ModuleRef};
use crate::builtins::{RuntimeModule, table};
use bun_sema::util::FxHashSet;

// src/codegen/bundle-modules.ts takes them out of the list.
include!(concat!(
    env!("BUN_CODEGEN_DIR"),
    "/generated_quiet_builtin_loads.rs"
));

pub(crate) fn loads_quietly(module: RuntimeModule) -> bool {
    let specifier = table::specifier_of(module);
    SPECIFIERS_OF_QUIET_LOADS.binary_search(&specifier).is_ok()
}

pub(super) fn find_modules_loaded_at_first_use(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
    imports: &[FileImports],
    mocked: &FxHashSet<ModuleRef>,
) -> Vec<RuntimeModule> {
    if !input.loads_builtins_at_first_use {
        return Vec::new();
    }
    let of_library = |module: ModuleRef| match module {
        ModuleRef::Runtime(module) => Some(module),
        _ => None,
    };
    let mut imported: Vec<RuntimeModule> = Vec::new();
    // The loader lists the names of a module behind a star, and looks a required name up in it, when the importer links.
    let mut read_at_link: FxHashSet<RuntimeModule> = FxHashSet::default();
    for &file in &modules.compiled_files {
        for request in &scans.of(file).requests {
            let Some(module) = of_library(request.target) else {
                continue;
            };
            // A statement that writes `import defer` keeps what it says.
            match request.is_star_export || request.phase == ImportPhase::Defer {
                true => drop(read_at_link.insert(module)),
                false => imported.push(module),
            }
        }
    }
    let required = imports.iter().flat_map(|file| &file.required_names);
    read_at_link.extend(required.filter_map(|required| of_library(required.module)));
    read_at_link.extend(mocked.iter().filter_map(|&module| of_library(module)));
    imported.sort_unstable();
    imported.dedup();
    imported.retain(|&module| {
        // What loads the module where a name is first read is a require of the program to the engine. One of a name without
        // `node:` lists the module in `require.cache`, which an import statement of most of these names does not.
        table::specifier_of(module).starts_with(b"node:")
            && !read_at_link.contains(&module)
            && loads_quietly(module)
    });
    imported
}
