use crate::diagnostics::LoadMessages;
use crate::load::loaders::reads_raw_bytes;
use crate::load::source_provider::{
    Failed, LoadRequest, Loaded, ModuleName, Resolution, ResolveRequest, SourceProvider,
};
use crate::load::{HOST_ROOT, is_host_path, read_file_bytes};
use bun_ast::{ImportKind, Loader};
use bun_core::fmt::hex_byte_lower;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::resolve::{CodeImportForm, CodeImportKind, CodeRequest, Host, to_path};
use bun_sema::util::SharedSort;
use bun_sema::util::{FxHashMap, ShardedMap};
use bun_sema_driver::host::{Disk, from_argument, from_native, to_native};
use bun_threading::Guarded;
use std::borrow::Cow;
use std::cmp::Ordering;
use std::sync::OnceLock;

const FILE_NAMESPACE: &[u8] = b"file";
const VIRTUAL_DIRECTORY: &[u8] = b"plugin/";
const ENCODED_EMPTY_SEGMENT: &[u8] = b"%2f";

#[derive(Clone, Debug)]
pub(crate) enum PluginResolution {
    NotHandled,
    Path(Vec<u8>),
    External { specifier: Vec<u8> },
}

pub(crate) enum ModuleText {
    Text(Cow<'static, [u8]>),
    Deferred,
    Missing,
    Failed,
}

#[derive(Default)]
pub(crate) struct DeferredReads {
    pub texts: Vec<(Vec<u8>, Cow<'static, [u8]>)>,
    pub missing: Vec<Vec<u8>>,
}

enum ModuleLoad {
    Loaded(StoredModule),
    Deferred(OnceLock<Option<StoredModule>>),
    Missing,
    Failed,
}

pub(crate) struct StoredModule {
    pub loader: Loader,
    pub is_from_plugin: bool,
    contents: Option<Cow<'static, [u8]>>,
}

impl StoredModule {
    #[allow(clippy::ptr_arg)] // a borrowed text is kept without a copy
    fn new(contents: &Cow<'static, [u8]>, loader: Loader, is_from_plugin: bool) -> StoredModule {
        StoredModule {
            loader,
            is_from_plugin,
            contents: is_from_plugin.then(|| contents.clone()),
        }
    }
}

struct DeferredModule {
    host_path: Vec<u8>,
    namespace: Vec<u8>,
    path: Vec<u8>,
}

impl DeferredModule {
    fn compare_name(&self, namespace: &[u8], path: &[u8]) -> Ordering {
        (self.namespace.as_slice(), self.path.as_slice()).cmp(&(namespace, path))
    }
}

type ResolutionKey = (Vec<u8>, Vec<u8>, CodeImportKind, CodeImportForm);

pub(crate) struct PluginModules<'a> {
    provider: &'a dyn SourceProvider,
    disk: &'a Disk,
    messages: &'a LoadMessages,
    in_memory_files: FxHashMap<Vec<u8>, &'a [u8]>,
    resolutions: ShardedMap<ResolutionKey, OnceLock<PluginResolution>>,
    modules: ShardedMap<Vec<u8>, OnceLock<ModuleLoad>>,
    virtual_modules: ShardedMap<Vec<u8>, (Vec<u8>, Vec<u8>)>,
    paths_asked_for_load_plugin: ShardedMap<Vec<u8>, bool>,
    deferred: Guarded<Vec<DeferredModule>>,
}

impl<'a> PluginModules<'a> {
    pub(crate) fn new(
        provider: &'a dyn SourceProvider,
        disk: &'a Disk,
        messages: &'a LoadMessages,
        in_memory_files: &'a [(Vec<u8>, Vec<u8>)],
    ) -> PluginModules<'a> {
        let is_case_sensitive = disk.is_case_sensitive();
        let in_memory_files = in_memory_files.iter().map(|(path, contents)| {
            let path = to_path(&from_native(path), is_case_sensitive).into_owned();
            (path, contents.as_slice())
        });
        PluginModules {
            provider,
            disk,
            messages,
            in_memory_files: in_memory_files.collect(),
            resolutions: ShardedMap::default(),
            modules: ShardedMap::default(),
            virtual_modules: ShardedMap::default(),
            paths_asked_for_load_plugin: ShardedMap::default(),
            deferred: Guarded::new(Vec::new()),
        }
    }

    pub(crate) fn resolve(&self, request: &CodeRequest<'_>) -> PluginResolution {
        if !self.provider.has_resolve_plugins() {
            return PluginResolution::NotHandled;
        }
        let key = (
            request.specifier.to_vec(),
            request.importer.to_vec(),
            request.kind,
            request.form,
        );
        let cell = match self.resolutions.get_ref(&key) {
            Some(cell) => cell,
            None => self.resolutions.insert_ref(key, OnceLock::new()),
        };
        let resolve = || {
            let provider_request = ResolveRequest {
                specifier: request.specifier,
                importer: self.module_name(request.importer),
                kind: import_kind(request.kind, request.form),
            };
            let provider = self.provider;
            match (self.messages).with_log(|log| provider.resolve(&provider_request, log)) {
                Ok(Resolution::NotHandled) | Err(Failed) => PluginResolution::NotHandled,
                Ok(Resolution::External { specifier }) => PluginResolution::External { specifier },
                Ok(Resolution::Module { namespace, path })
                    if namespace.is_empty() || namespace == FILE_NAMESPACE =>
                {
                    PluginResolution::Path(from_native(&path))
                }
                Ok(Resolution::Module { namespace, path }) => {
                    let virtual_path = create_virtual_path(&namespace, &path);
                    (self.virtual_modules).insert_ref(virtual_path.clone(), (namespace, path));
                    PluginResolution::Path(virtual_path)
                }
            }
        };
        cell.get_or_init(resolve).clone()
    }

    pub(crate) fn read(&self, path: &[u8], default_loader: Loader) -> ModuleText {
        let cell = match self.modules.get_ref(path) {
            Some(cell) => cell,
            None => self.modules.insert_ref(path.to_vec(), OnceLock::new()),
        };
        let mut first_text = None;
        let load = cell.get_or_init(|| {
            let module = self.module_name(path);
            let read_file = || self.read_file(path, default_loader);
            let request = LoadRequest {
                module,
                default_loader,
                read_file: &read_file,
            };
            match (self.messages).with_log(|log| self.provider.load(&request, log)) {
                Ok(Loaded::Source {
                    contents,
                    loader,
                    is_from_plugin,
                }) => {
                    if is_from_plugin {
                        bun_sema_driver::did_read_source(contents.len());
                    }
                    let stored = StoredModule::new(&contents, loader, is_from_plugin);
                    first_text = Some(contents);
                    ModuleLoad::Loaded(stored)
                }
                Ok(Loaded::Deferred) => {
                    self.deferred.lock().push(DeferredModule {
                        host_path: path.to_vec(),
                        namespace: module.namespace.to_vec(),
                        path: module.path.to_vec(),
                    });
                    ModuleLoad::Deferred(OnceLock::new())
                }
                Ok(Loaded::NotFound) => ModuleLoad::Missing,
                Err(Failed) => ModuleLoad::Failed,
            }
        });
        if let Some(text) = first_text {
            return ModuleText::Text(text);
        }
        match load {
            ModuleLoad::Loaded(module) => self.read_again(module, path, default_loader),
            ModuleLoad::Deferred(answer) => match answer.get() {
                None => ModuleText::Deferred,
                Some(Some(module)) => self.read_again(module, path, default_loader),
                Some(None) => ModuleText::Failed,
            },
            ModuleLoad::Missing => ModuleText::Missing,
            ModuleLoad::Failed => ModuleText::Failed,
        }
    }

    pub(crate) fn finish_deferred_reads(&self) -> DeferredReads {
        let mut pending = std::mem::take(&mut *self.deferred.lock());
        let mut reads = DeferredReads::default();
        if pending.is_empty() {
            return reads;
        }
        let answers = (self.messages).with_log(|log| self.provider.finish_deferred_loads(log));
        pending.shared_sort_unstable_by(|a, b| a.compare_name(&b.namespace, &b.path));
        for load in answers {
            let found =
                pending.binary_search_by(|entry| entry.compare_name(&load.namespace, &load.path));
            let Ok(index) = found else {
                continue;
            };
            let host_path = &pending[index].host_path;
            let Some(cell) = self.unanswered_read(host_path) else {
                continue;
            };
            match load.answer {
                Ok(Loaded::Source {
                    contents,
                    loader,
                    is_from_plugin,
                }) => {
                    cell.get_or_init(|| Some(StoredModule::new(&contents, loader, is_from_plugin)));
                    reads.texts.push((host_path.clone(), contents));
                }
                Ok(Loaded::NotFound) => {
                    cell.get_or_init(|| None);
                    reads.missing.push(host_path.clone());
                }
                Ok(Loaded::Deferred) => {}
                Err(Failed) => {
                    cell.get_or_init(|| None);
                }
            }
        }
        for module in &pending {
            let Some(cell) = self.unanswered_read(&module.host_path) else {
                continue;
            };
            let message = [
                &b"a deferred load was never answered: "[..],
                module.namespace.as_slice(),
                b":",
                module.path.as_slice(),
            ];
            self.messages.report_internal_error(message.concat());
            cell.get_or_init(|| None);
        }
        reads.texts.shared_sort_unstable_by(|a, b| a.0.cmp(&b.0));
        reads.missing.shared_sort_unstable();
        reads
    }

    pub(crate) fn has_load_plugin(&self, path: &[u8]) -> bool {
        if let Some(&answer) = self.paths_asked_for_load_plugin.get_ref(path) {
            return answer;
        }
        let answer = self.provider.has_load_plugin(self.module_name(path));
        *(self.paths_asked_for_load_plugin).insert_ref(path.to_vec(), answer)
    }

    pub(crate) fn was_read(&self, path: &[u8]) -> bool {
        self.modules.get_ref(path).is_some()
    }

    pub(crate) fn loaded(&self, path: &[u8]) -> Option<&StoredModule> {
        match self.modules.get_ref(path)?.get()? {
            ModuleLoad::Loaded(module) => Some(module),
            ModuleLoad::Deferred(answer) => answer.get()?.as_ref(),
            ModuleLoad::Missing | ModuleLoad::Failed => None,
        }
    }

    pub(crate) fn virtual_module(&self, path: &[u8]) -> Option<(&[u8], &[u8])> {
        if !is_host_path(path) {
            return None;
        }
        let (namespace, plugin_path) = self.virtual_modules.get_ref(path)?;
        Some((namespace.as_slice(), plugin_path.as_slice()))
    }

    // As the bundler has it: the directory in the path that the plugin gave the module, below the working directory if it is relative.
    pub(crate) fn directory_of_virtual_module(
        &self,
        path: &[u8],
        working_directory: &[u8],
    ) -> Option<Vec<u8>> {
        let (_, plugin_path) = self.virtual_module(path)?;
        let as_file = from_argument(working_directory, plugin_path);
        Some(dirname::<Posix>(&as_file).to_vec())
    }

    pub(crate) fn provider_path<'p>(&'p self, path: &'p [u8]) -> &'p [u8] {
        self.module_name(path).path
    }

    fn module_name<'p>(&'p self, path: &'p [u8]) -> ModuleName<'p> {
        match self.virtual_module(path) {
            Some((namespace, plugin_path)) => ModuleName {
                namespace,
                path: plugin_path,
            },
            None => ModuleName {
                namespace: FILE_NAMESPACE,
                path: to_native(path),
            },
        }
    }

    fn read_again(&self, module: &StoredModule, path: &[u8], default_loader: Loader) -> ModuleText {
        let text = match &module.contents {
            Some(contents) => Some(contents.clone()),
            None => self.read_file(path, default_loader),
        };
        text.map_or(ModuleText::Missing, ModuleText::Text)
    }

    fn read_file(&self, path: &[u8], loader: Loader) -> Option<Cow<'static, [u8]>> {
        if self.virtual_module(path).is_some() {
            return None;
        }
        if !reads_raw_bytes(loader) {
            return self.disk.read(path);
        }
        let in_memory_path = to_path(path, self.disk.is_case_sensitive());
        let bytes = match self.in_memory_files.get(&*in_memory_path) {
            Some(contents) => contents.to_vec(),
            None => read_file_bytes(path)?,
        };
        Some(Cow::Owned(bytes))
    }

    fn unanswered_read(&self, host_path: &[u8]) -> Option<&OnceLock<Option<StoredModule>>> {
        match self.modules.get_ref(host_path)?.get()? {
            ModuleLoad::Deferred(answer) => answer.get().is_none().then_some(answer),
            ModuleLoad::Loaded(_) | ModuleLoad::Missing | ModuleLoad::Failed => None,
        }
    }
}

fn import_kind(kind: CodeImportKind, form: CodeImportForm) -> ImportKind {
    match (kind, form) {
        (CodeImportKind::EntryPoint, _) => ImportKind::EntryPointBuild,
        (_, CodeImportForm::ResolveOnly) => ImportKind::RequireResolve,
        (_, CodeImportForm::Dynamic) => ImportKind::Dynamic,
        (CodeImportKind::Import, CodeImportForm::Static | CodeImportForm::Macro) => {
            ImportKind::Stmt
        }
        (CodeImportKind::Require, CodeImportForm::Static | CodeImportForm::Macro) => {
            ImportKind::Require
        }
    }
}

fn create_virtual_path(namespace: &[u8], path: &[u8]) -> Vec<u8> {
    let mut virtual_path = [HOST_ROOT, VIRTUAL_DIRECTORY].concat();
    append_encoded_segment(&mut virtual_path, namespace);
    for segment in bun_core::strings::split(path, b"/") {
        virtual_path.push(b'/');
        append_encoded_segment(&mut virtual_path, segment);
    }
    virtual_path
}

pub(crate) fn append_encoded_segment(target: &mut Vec<u8>, segment: &[u8]) {
    if segment.is_empty() {
        target.extend_from_slice(ENCODED_EMPTY_SEGMENT);
        return;
    }
    let is_dot_segment = matches!(segment, b"." | b"..");
    for &byte in segment {
        if matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'.' | b'_' | b'-') && !is_dot_segment {
            target.push(byte);
        } else {
            let [high_digit, low_digit] = hex_byte_lower(byte);
            target.extend_from_slice(&[b'%', high_digit, low_digit]);
        }
    }
}

#[cfg(test)]
mod tests;
