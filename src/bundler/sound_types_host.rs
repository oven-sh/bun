
use std::sync::Arc;

use bun_ast::sound_types::{ModuleTypes, ModuleTypesHost};
use bun_collections::StringHashMap;
use bun_resolver::Resolver;

#[derive(Default)]
pub struct SoundTypesCache {
    modules: bun_threading::Guarded<StringHashMap<Option<Arc<ModuleTypes>>>>,
}

pub(crate) struct SoundTypesHost {
    pub(crate) resolver: *mut Resolver<'static>,
    pub(crate) cache: bun_ptr::BackRef<SoundTypesCache>,
}

impl SoundTypesHost {
    fn resolve(&self, importer: &[u8], specifier: &[u8]) -> Option<&'static [u8]> {
        let mut log = bun_ast::Log::init();
        let _log_scope =
            unsafe { Resolver::scoped_log(self.resolver, core::ptr::NonNull::from(&mut log)) };
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
        let types = bun_sys::File::read_from(bun_sys::Fd::cwd(), path)
            .ok()
            .and_then(|text| bun_js_parser::sound_types::module_types_for_text(path, &text, loader))
            .map(Arc::new);
        bun_core::handle_oom(self.cache.modules.lock().put(path, types.clone()));
        types
    }
}
