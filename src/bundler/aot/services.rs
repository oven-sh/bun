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
use bun_sema::atom::Interner;
use bun_sema::fold::FoldOptions;
use bun_sema::hir_from_data::{DataModule, DataValue};
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

#[cfg(test)]
pub(crate) fn with_test_context<R>(
    configure: impl FnOnce(&mut BundleOptions<'_>),
    then: impl FnOnce(&BuildContext) -> R,
) -> R {
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
