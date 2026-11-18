//! What a module loader asks of the `GlobalObjectMethodTable`. Where that has no function, C++ returns nothing.

use bun_engine_bytecode::ImportPhase;
use bun_engine_text::{Identifier, StringImpl};
use bun_engine_vm::{
    Cx, FetchParameters, Gc, JsObject, JsPromise, JsResult, JsString, ModuleHooks, ModuleLoader,
    ModuleName, Shape, SourceCode, SourceProvider, SourceTextModuleRecord, SyntheticExports, Value,
};

unsafe extern "C" {
    safe fn engine_host_import_module(
        cx: &mut Cx,
        loader: Gc<ModuleLoader>,
        specifier: Gc<JsString>,
        parameters: Option<&FetchParameters>,
        origin: Option<&SourceProvider>,
        is_deferred: bool,
    ) -> Option<Gc<JsPromise>>;
    safe fn engine_host_resolve_module(
        cx: &mut Cx,
        loader: Gc<ModuleLoader>,
        name: Value,
        referrer: Value,
        is_specifier: bool,
    ) -> Option<Identifier>;
    safe fn engine_host_fetch_module(
        cx: &mut Cx,
        loader: Gc<ModuleLoader>,
        key: Value,
        referrer: Option<&StringImpl>,
        parameters: Option<&FetchParameters>,
    ) -> Option<Gc<JsPromise>>;
    safe fn engine_host_create_import_meta(
        cx: &mut Cx,
        loader: Gc<ModuleLoader>,
        key: Value,
        module: Gc<SourceTextModuleRecord>,
    ) -> Option<Gc<JsObject>>;
    safe fn engine_host_evaluate_module(
        cx: &mut Cx,
        loader: Gc<ModuleLoader>,
        key: Value,
        module: Gc<SourceTextModuleRecord>,
    ) -> Option<Value>;
    safe fn engine_host_generate_module_exports(
        cx: &mut Cx,
        provider: &SourceProvider,
        key: &Identifier,
        exports: &mut SyntheticExports,
    );
    safe fn engine_host_make_analyzed_module(
        cx: &mut Cx,
        loader: Gc<ModuleLoader>,
        key: &Identifier,
        source: &SourceCode,
        promise: Gc<JsPromise>,
    );
    safe fn engine_host_have_same_origin(a: &SourceProvider, b: &SourceProvider) -> bool;
    safe fn engine_host_module_namespace_shape(cx: &Cx) -> Option<Gc<Shape>>;
}

const DEFAULT: ModuleHooks = ModuleHooks::DEFAULT;

fn or_default<T>(
    cx: &mut Cx,
    result: Option<T>,
    default: impl FnOnce(&mut Cx) -> JsResult<T>,
) -> JsResult<T> {
    cx.check_exception()?;
    result.map_or_else(|| default(cx), Ok)
}

pub(super) const MODULE_HOOKS: ModuleHooks = ModuleHooks {
    import: |cx, loader, name, parameters, origin, phase| {
        let (borrowed, is_deferred) = (parameters.as_deref(), phase == ImportPhase::Defer);
        let result = engine_host_import_module(cx, loader, name, borrowed, origin, is_deferred);
        or_default(cx, result, |cx| {
            (DEFAULT.import)(cx, loader, name, parameters, origin, phase)
        })
    },
    resolve: |cx, loader, name, referrer, kind| {
        let is_specifier = kind == ModuleName::Specifier;
        let result = engine_host_resolve_module(cx, loader, name, referrer, is_specifier);
        or_default(cx, result, |cx| {
            (DEFAULT.resolve)(cx, loader, name, referrer, kind)
        })
    },
    fetch: |cx, loader, key, referrer, parameters| {
        let text = referrer.map(|it| &**it);
        let result = engine_host_fetch_module(cx, loader, key, text, parameters.as_deref());
        or_default(cx, result, |cx| {
            (DEFAULT.fetch)(cx, loader, key, referrer, parameters)
        })
    },
    create_import_meta: |cx, loader, key, module| {
        let result = engine_host_create_import_meta(cx, loader, key, module);
        or_default(cx, result, |cx| {
            (DEFAULT.create_import_meta)(cx, loader, key, module)
        })
    },
    evaluate: |cx, loader, key, module| {
        let result = engine_host_evaluate_module(cx, loader, key, module);
        cx.check_exception().map(|()| result.unwrap_or_default())
    },
    generate_exports: |cx, provider, key, exports| {
        engine_host_generate_module_exports(cx, provider, key, exports);
        cx.check_exception()
    },
    make_analyzed_module: |cx, loader, key, source, promise| {
        engine_host_make_analyzed_module(cx, loader, key, source, promise);
        cx.check_exception()
    },
    have_same_origin: |a, b| engine_host_have_same_origin(a, b),
    create_namespace_shape: |cx| {
        engine_host_module_namespace_shape(cx)
            .unwrap_or_else(|| (DEFAULT.create_namespace_shape)(cx))
    },
};
