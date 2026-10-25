use super::assets::EmbeddedFiles;
use super::macros::MacroThread;
use super::plugins::PluginRequests;
use super::{assets, data_loaders, defines, native_plugins, page_bundles};
use crate::options_impl::BundleOptions;
use crate::{BundleV2, OutputFile, Transpiler, Worker};
use bun_alloc::Arena;
use bun_aot::load::source_provider::{
    DeferredLoad, Failed, LoadRequest, Loaded, MacroCall, ModuleName, Resolution, ResolveRequest,
    SourceFile,
};
use bun_aot::{SourceProvider, WithoutServices};
use bun_ast::{ASTMemoryAllocator, Log};
use bun_paths::resolve_path::posix_to_platform_in_place;
use bun_resolver::options::{ExternalModules, Packages};
use bun_resolver::package_json::Status;
use bun_resolver::{GlobalCache, Resolver, ResultUnion};
use bun_sema::atom::Interner;
use bun_sema::fold::FoldOptions;
use bun_sema::hir_from_data::{DataModule, DataValue};
use bun_sema::resolve::{AOT_CONDITION, CodeFailure, CodeImportKind, FileSearch, FoundCode, Host};
use bun_sema_driver::host::{from_native, to_native};
use bun_threading::Guarded;
use core::ptr::NonNull;

#[derive(Clone)]
pub(crate) struct BuildContext {
    bundle: NonNull<BundleV2<'static>>,
    pub module_prefix: Box<[u8]>,
}

// SAFETY: immutable after its phase. `build` finishes setting up the carrier before `compile`
// starts, and the fields read through this pointer do not change until `compile` returns.
// `plugins.rs` alone makes a `&mut BundleV2` from it, under its lock.
unsafe impl Send for BuildContext {}
// SAFETY: as for `Send`.
unsafe impl Sync for BuildContext {}

impl BuildContext {
    pub(crate) fn bundle(&self) -> &BundleV2<'static> {
        // SAFETY: `build` keeps the carrier alive until `BundlerServices::shut_down` has returned,
        // and every `BuildContext` is gone by then.
        unsafe { self.bundle.as_ref() }
    }

    pub(crate) fn bundle_pointer(&self) -> NonNull<BundleV2<'static>> {
        self.bundle
    }

    pub(crate) fn options(&self) -> &BundleOptions<'static> {
        &self.bundle().transpiler().options
    }

    pub(crate) fn with_worker<R>(
        &self,
        work: impl FnOnce(&mut Transpiler<'static>, &Arena) -> R,
    ) -> R {
        let mut worker = scopeguard::guard(Worker::get(self.bundle()), |worker| worker.unget());
        let data = worker.data.as_mut().expect("Worker::get creates it");
        with_ast_scope(|arena| work(&mut data.transpiler, arena))
    }
}

pub(crate) fn with_ast_scope<R>(work: impl FnOnce(&Arena) -> R) -> R {
    let arena = Arena::new();
    let mut store = ASTMemoryAllocator::borrowing(&arena);
    let _scope = store.enter();
    work(&arena)
}

/// Bun's resolver, asked which file runs for an import.
pub struct FileFinder(Resolver<'static>);

// SAFETY: one thread at a time holds it. What it points to belongs to the transpiler it was made from, which is not
// written while it lives, or to every resolver of the process, which share it under their own locks.
unsafe impl Send for FileFinder {}

impl FileFinder {
    /// `conditions`: those of "exports" and "imports" that hold beside the ones of `transpiler`.
    ///
    /// # Safety
    /// `transpiler` outlives what is returned and is not written in the meantime.
    pub unsafe fn new(transpiler: &Transpiler<'_>, conditions: &[Vec<u8>]) -> FileFinder {
        let mut options = crate::transpiler::resolver_bundle_options_subset(&transpiler.options);
        // Whoever asks has taken out what is external and the modules of Bun's own that it has.
        options.mark_builtins_as_external = false;
        options.packages = Packages::Bundle;
        options.external = ExternalModules::default();
        options.preserve_symlinks = transpiler.resolver.opts.preserve_symlinks;
        // `bun build` adds "development" by itself. A compiled program runs the files that `bun run` runs.
        let mut asked_for = transpiler.options.custom_conditions.iter();
        if !asked_for.any(|condition| **condition == *b"development") {
            options.conditions.import.swap_remove(b"development");
            options.conditions.require.swap_remove(b"development");
        }
        for condition in conditions {
            options.conditions.import.insert(condition, ());
            options.conditions.require.insert(condition, ());
        }
        let resolver = &transpiler.resolver;
        // SAFETY: the caller's.
        FileFinder(unsafe { Resolver::for_worker(resolver, resolver.log, options) })
    }

    pub fn find(&mut self, search: &FileSearch<'_>) -> FoundCode {
        with_ast_scope(|_| self.find_in_ast_scope(search))
    }

    // The resolver reads `package.json` and `tsconfig.json` into the thread's store of trees.
    fn find_in_ast_scope(&mut self, search: &FileSearch<'_>) -> FoundCode {
        let resolver = &mut self.0;
        let kind = match search.kind {
            CodeImportKind::EntryPoint => bun_ast::ImportKind::EntryPointBuild,
            CodeImportKind::Import => bun_ast::ImportKind::Stmt,
            CodeImportKind::Require => bun_ast::ImportKind::Require,
        };
        let mut unread_log = Log::init();
        // SAFETY: the resolver and `unread_log` outlive the guard.
        let _log_scope =
            unsafe { Resolver::scoped_log(&raw mut *resolver, NonNull::from(&mut unread_log)) };
        resolver.prefer_module_field = search.prefers_module_field;
        resolver.esm_failure = None;
        let mut directory = to_native(search.directory).to_vec();
        posix_to_platform_in_place(&mut directory);
        if directory.last() != Some(&bun_paths::SEP) {
            directory.push(bun_paths::SEP);
        }
        let result = resolver.resolve_and_auto_install(
            &directory,
            search.specifier,
            kind,
            GlobalCache::disable,
        );
        let failure = resolver.esm_failure.take();
        let result = match result {
            ResultUnion::Success(result) => result,
            ResultUnion::Failure(_) | ResultUnion::Pending(_) | ResultUnion::NotFound => {
                return failure.map_or_else(FoundCode::not_found, describe_failure);
            }
        };
        match result.path_const() {
            None => FoundCode::not_found(),
            Some(path) if result.flags.is_external() || path.is_data_url() => {
                FoundCode::External(path.text.to_vec())
            }
            Some(path) => FoundCode::File {
                path: from_native(path.text),
                required: (result.path_pair.secondary.as_ref()).map(|it| from_native(it.text)),
            },
        }
    }
}

fn describe_failure(status: Status) -> FoundCode {
    let failure = match status {
        Status::InvalidModuleSpecifier => CodeFailure::InvalidModuleSpecifier,
        Status::InvalidPackageConfiguration => CodeFailure::InvalidPackageConfiguration,
        Status::InvalidPackageTarget => CodeFailure::InvalidPackageTarget,
        Status::UnsupportedDirectoryImport => CodeFailure::UnsupportedDirectoryImport,
        Status::PackageImportNotDefined => CodeFailure::PackageImportNotDefined,
        Status::Exact
        | Status::ExactEndsWithStar
        | Status::Inexact
        | Status::PackageResolve
        | Status::ModuleNotFound => CodeFailure::ModuleNotFound,
        Status::Undefined
        | Status::UndefinedNoConditionsMatch
        | Status::Null
        | Status::PackagePathNotExported
        | Status::PackagePathDisabled => CodeFailure::PackagePathNotExported,
    };
    FoundCode::NotFound(failure)
}

#[cfg(test)]
pub(crate) fn with_test_context<R>(
    configure: impl FnOnce(&mut BundleOptions<'_>),
    then: impl FnOnce(&BuildContext) -> R,
) -> R {
    static OUTPUT: std::sync::Once = std::sync::Once::new();
    OUTPUT.call_once(bun_core::output::stdio::init);
    let mut log = Log::init();
    let mut event_loop = bun_event_loop::AnyEventLoop::default();
    let arena = Arena::new();
    let transform_options = crate::options::TransformOptions {
        absolute_working_dir: Some(Box::from(&b"/project"[..])),
        target: Some(bun_options_types::schema::api::Target::Bun),
        ..Default::default()
    };
    let transpiler = arena.alloc(
        Transpiler::init(&arena, &raw mut log, transform_options, None)
            .expect("default options are valid"),
    );
    configure(&mut transpiler.options);
    let mut bundle = BundleV2::init(
        transpiler,
        None,
        &arena,
        Some(NonNull::from(&mut event_loop)),
        false,
        None,
        &arena,
    )
    .expect("the carrier starts");
    let context = BuildContext {
        bundle: NonNull::from(&mut *bundle).cast(),
        module_prefix: Box::from(&b"/$bunfs/root/"[..]),
    };
    let result = then(&context);
    drop(context);
    bundle.deinit_without_freeing_arena();
    drop(bundle);
    result
}

pub(crate) struct BundlerServices {
    context: BuildContext,
    plugins: Option<PluginRequests>,
    embedded: EmbeddedFiles,
    macros: MacroThread,
    /// Those that no thread holds.
    file_finders: Guarded<Vec<FileFinder>>,
}

impl BundlerServices {
    pub(crate) fn new(bundle: NonNull<BundleV2<'static>>, module_prefix: &[u8]) -> BundlerServices {
        let context = BuildContext {
            bundle,
            module_prefix: Box::from(module_prefix),
        };
        let plugins = context
            .bundle()
            .plugins
            .is_some()
            .then(|| PluginRequests::new(bundle));
        BundlerServices {
            context,
            plugins,
            embedded: EmbeddedFiles::default(),
            macros: MacroThread::new(),
            file_finders: Guarded::new(Vec::new()),
        }
    }

    pub(crate) fn shut_down(self) -> Vec<OutputFile> {
        self.macros.shut_down();
        if let Some(plugins) = self.plugins {
            plugins.shut_down();
        }
        self.embedded.into_output_files()
    }
}

impl SourceProvider for BundlerServices {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        defines::fold_options(self.context.options(), arena, atoms, log)
    }

    fn resolve(&self, request: &ResolveRequest<'_>, log: &mut Log) -> Result<Resolution, Failed> {
        match &self.plugins {
            Some(plugins) => plugins.resolve(request, log),
            None => Ok(Resolution::NotHandled),
        }
    }

    fn has_resolve_plugins(&self) -> bool {
        self.plugins.is_some()
    }

    fn find_file(&self, _host: &dyn Host, search: &FileSearch<'_>) -> FoundCode {
        let idle = self.file_finders.lock().pop();
        let create = || {
            let conditions = [AOT_CONDITION.to_vec()];
            // SAFETY: `build` keeps the carrier and its transpiler as they are until `shut_down` has returned.
            unsafe { FileFinder::new(self.context.bundle().transpiler(), &conditions) }
        };
        let mut finder = idle.unwrap_or_else(create);
        let found = finder.find(search);
        self.file_finders.lock().push(finder);
        found
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        let loaded = match &self.plugins {
            Some(plugins) => plugins.load(request, log)?,
            None => WithoutServices.load(request, log)?,
        };
        native_plugins::run_before_parse(&self.context, request.module, loaded, log)
    }

    fn has_load_plugin(&self, module: ModuleName<'_>) -> bool {
        self.plugins
            .as_ref()
            .is_some_and(|plugins| plugins.has_load_plugin(module))
            || native_plugins::has_before_parse_plugins(&self.context)
    }

    fn finish_deferred_loads(&self, log: &mut Log) -> Vec<DeferredLoad> {
        let Some(plugins) = &self.plugins else {
            return Vec::new();
        };
        plugins
            .finish_deferred_loads(log)
            .into_iter()
            .map(|(namespace, path, answer)| {
                let module = ModuleName {
                    namespace: &namespace,
                    path: &path,
                };
                let answer = answer.and_then(|loaded| {
                    native_plugins::run_before_parse(&self.context, module, loaded, log)
                });
                DeferredLoad {
                    namespace,
                    path,
                    answer,
                }
            })
            .collect()
    }

    fn asset_paths_ignore_contents(&self) -> bool {
        assets::asset_paths_ignore_contents(&self.context)
    }

    fn set_embedded_contents(&self, file: &SourceFile<'_>, log: &mut Log) -> Result<(), Failed> {
        self.embedded.set_contents(&self.context, file, log)
    }

    fn clear_embedded_files(&self) {
        self.embedded.clear();
    }

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, Failed> {
        data_loaders::parse_data(&self.context, &self.embedded, file, arena, atoms, log)
    }

    fn run_macro<'s>(
        &self,
        call: &MacroCall<'_, 's>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<&'s DataValue<'s>, Failed> {
        self.macros
            .run_macro(&self.context, call, arena, atoms, log)
    }

    fn bundle_pages<'s>(
        &self,
        pages: &[&[u8]],
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<Vec<&'s DataValue<'s>>, Failed> {
        page_bundles::bundle_pages(&self.context, &self.embedded, pages, arena, atoms, log)
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
        self.embedded.check_names(log)
    }
}

#[cfg(test)]
mod tests {
    use super::{BundlerServices, with_ast_scope, with_test_context};
    use bun_aot::SourceProvider;
    use bun_aot::load::source_provider::ModuleName;
    use bun_ast::{E, Expr, ExprData, Loc};

    fn allocate_array() -> Expr {
        Expr::init(E::Array::default(), Loc::EMPTY)
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn build_without_plugins_has_no_load_plugin() {
        with_test_context(
            |_| {},
            |context| {
                let services =
                    BundlerServices::new(context.bundle_pointer(), &context.module_prefix);
                for namespace in [&b"file"[..], b"virtual"] {
                    assert!(!services.has_load_plugin(ModuleName {
                        namespace,
                        path: b"/project/a.ts",
                    }));
                }
                assert!(services.shut_down().is_empty());
            },
        );
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn nested_ast_scopes_restore_outer_store() {
        with_ast_scope(|_| {
            let before = allocate_array();
            with_ast_scope(|_| {
                with_ast_scope(|_| {
                    assert!(matches!(allocate_array().data, ExprData::EArray(_)));
                });
                assert!(matches!(allocate_array().data, ExprData::EArray(_)));
            });
            let after = allocate_array();
            assert!(matches!(before.data, ExprData::EArray(_)));
            assert!(matches!(after.data, ExprData::EArray(_)));
        });
    }
}
