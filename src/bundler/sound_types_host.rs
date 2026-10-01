//! Lets the parser of one module look up the types another module exports, so
//! that `--sound-types` can check annotations that name imported types.
//!
//! Type-only imports leave no import record, so the modules they name may not
//! be in the bundle graph at all. Each one is resolved, read and parsed for its
//! type declarations on the worker thread that first asks for it.

use std::sync::Arc;

use bun_ast::sound_types::{ModuleTypes, ModuleTypesHost};
use bun_collections::StringHashMap;
use bun_resolver::Resolver;

/// Absolute path -> the module's types. One per bundle.
#[derive(Default)]
pub struct SoundTypesCache {
    modules: bun_threading::Guarded<StringHashMap<Option<Arc<ModuleTypes>>>>,
}

/// One per parse task.
pub(crate) struct SoundTypesHost {
    /// The worker's resolver. Nothing else uses it while the parser runs.
    pub(crate) resolver: *mut Resolver<'static>,
    pub(crate) cache: bun_ptr::BackRef<SoundTypesCache>,
}

impl SoundTypesHost {
    fn resolve(&self, importer: &[u8], specifier: &[u8]) -> Option<&'static [u8]> {
        // A type import that does not resolve is not an error: nothing loads it.
        let mut log = bun_ast::Log::init();
        // SAFETY: the resolver outlives this call, and `log` outlives the guard.
        let _log_scope =
            unsafe { Resolver::scoped_log(self.resolver, core::ptr::NonNull::from(&mut log)) };
        // SAFETY: see `resolver`.
        let result = unsafe { &mut *self.resolver }
            .resolve(
                bun_paths::fs::Path::init(importer).source_dir(),
                specifier,
                bun_ast::ImportKind::Stmt,
            )
            .ok()?;
        if result.flags.is_external() {
            return None;
        }
        let path = result.path_const()?;
        (path.namespace.is_empty() || path.namespace == b"file").then_some(path.text)
    }
}

impl ModuleTypesHost for SoundTypesHost {
    fn module_types(&self, importer: &[u8], specifier: &[u8]) -> Option<Arc<ModuleTypes>> {
        let resolved = self.resolve(importer, specifier)?;
        let extension = bun_paths::extension(resolved);
        // The types of `x.js` are in the `x.d.ts` next to it, if anywhere.
        let declaration_file: Vec<u8>;
        let path = match extension {
            b".js" | b".jsx" | b".mjs" | b".cjs" => {
                let declaration_extension: &[u8] = match extension {
                    b".mjs" => b".d.mts",
                    b".cjs" => b".d.cts",
                    _ => b".d.ts",
                };
                declaration_file = [
                    &resolved[..resolved.len() - extension.len()],
                    declaration_extension,
                ]
                .concat();
                declaration_file.as_slice()
            }
            _ => resolved,
        };
        let loader = bun_ast::Loader::from_string(bun_paths::extension(path))
            .filter(|loader| loader.is_typescript())?;
        if let Some(found) = self.cache.modules.lock().get(path) {
            return found.clone();
        }
        // Two workers can get here for the same module. Both compute the same table.
        let types = bun_sys::File::read_from(bun_sys::Fd::cwd(), path)
            .ok()
            .and_then(|text| bun_js_parser::sound_types::module_types_of_text(path, &text, loader))
            .map(Arc::new);
        bun_core::handle_oom(self.cache.modules.lock().put(path, types.clone()));
        types
    }
}
