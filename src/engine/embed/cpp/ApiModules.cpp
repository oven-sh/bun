#include "engine/Engine.h"

namespace JSC {

static void appendAttribute(void* attributes, UniquedStringImpl* key, StringImpl* value)
{
    static_cast<ScriptFetchParameters::Attributes*>(attributes)->append({ key, String(value) });
}

const ScriptFetchParameters::Attributes ScriptFetchParameters::attributes() const
{
    Attributes attributes;
    Engine::fetch_parameters_for_each_attribute(*this, &attributes, appendAttribute);
    return attributes;
}

const ScriptFetchParameters::Attributes JSModuleRecord::declaredAttributes(ModuleMapKey request) const
{
    ScriptFetchParameters::Attributes attributes;
    Engine::source_text_module_for_each_declared_attribute(this, request.first, request.second, &attributes, appendAttribute);
    return attributes;
}

auto AbstractModuleRecord::requestedModules() const -> const Vector<ModuleRequest>
{
    Vector<ModuleRequest> requests;
    requests.reserveInitialCapacity(requestedModuleCount());
    Engine::module_for_each_request(this, &requests, [](void* requests, UniquedStringImpl* specifier, ScriptFetchParameters* parameters, bool isDeferred) {
        specifier->ref();
        static_cast<Vector<ModuleRequest>*>(requests)->append({ Identifier::adopt(specifier), parameters, isDeferred ? ModulePhase::Defer : ModulePhase::Evaluation });
    });
    return requests;
}

auto AbstractModuleRecord::loadedModules() const -> const Vector<LoadedModule, 8>
{
    Vector<LoadedModule, 8> modules;
    Engine::module_for_each_loaded_module(this, &modules, [](void* modules, UniquedStringImpl* specifier, ScriptFetchParameters::Type type, AbstractModuleRecord* module) {
        static_cast<Vector<LoadedModule, 8>*>(modules)->append({ { specifier, type }, module });
    });
    return modules;
}

const Vector<RefPtr<UniquedStringImpl>, 8> AbstractModuleRecord::resolvedRequests() const
{
    Vector<RefPtr<UniquedStringImpl>, 8> keys;
    Engine::module_for_each_resolved_request(this, &keys, [](void* keys, UniquedStringImpl* key) {
        static_cast<Vector<RefPtr<UniquedStringImpl>, 8>*>(keys)->append(key);
    });
    return keys;
}

JSModuleNamespaceObject* JSModuleLoader::getModuleNamespaceObject(JSGlobalObject* globalObject, JSValue moduleRecord)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* record = dynamicDowncast<AbstractModuleRecord>(moduleRecord);
    if (!record) {
        throwTypeError(globalObject, scope);
        return nullptr;
    }
    RELEASE_AND_RETURN(scope, record->getModuleNamespace(globalObject));
}

extern "C" JSPromise* engine_host_import_module(JSGlobalObject* globalObject, JSModuleLoader* loader, JSString* specifier, ScriptFetchParameters* parameters, SourceProvider* origin, bool isDeferred)
{
    auto* import = globalObject->globalObjectMethodTable()->moduleLoaderImportModule;
    if (!import)
        return nullptr;
    if (!origin)
        return import(globalObject, loader, specifier, parameters, {}, isDeferred);
    return import(globalObject, loader, specifier, parameters, origin->sourceOrigin(), isDeferred);
}

extern "C" UniquedStringImpl* engine_host_resolve_module(JSGlobalObject* globalObject, JSModuleLoader* loader, EncodedJSValue name, EncodedJSValue referrer, bool isSpecifier)
{
    auto* resolve = globalObject->globalObjectMethodTable()->moduleLoaderResolve;
    return resolve ? resolve(globalObject, loader, JSValue::decode(name), JSValue::decode(referrer), nullptr, isSpecifier).releaseImpl().leakRef() : nullptr;
}

extern "C" JSPromise* engine_host_fetch_module(JSGlobalObject* globalObject, JSModuleLoader* loader, EncodedJSValue key, StringImpl* referrer, ScriptFetchParameters* parameters)
{
    auto* fetch = globalObject->globalObjectMethodTable()->moduleLoaderFetch;
    return fetch ? fetch(globalObject, loader, JSValue::decode(key), String(referrer), parameters, nullptr) : nullptr;
}

extern "C" JSObject* engine_host_create_import_meta(JSGlobalObject* globalObject, JSModuleLoader* loader, EncodedJSValue key, JSModuleRecord* module)
{
    auto* create = globalObject->globalObjectMethodTable()->moduleLoaderCreateImportMetaProperties;
    return create ? create(globalObject, loader, JSValue::decode(key), module, nullptr) : nullptr;
}

extern "C" EncodedJSValue engine_host_evaluate_module(JSGlobalObject* globalObject, JSModuleLoader* loader, EncodedJSValue key, JSModuleRecord* module)
{
    if (auto* evaluate = globalObject->globalObjectMethodTable()->moduleLoaderEvaluate)
        return JSValue::encode(evaluate(globalObject, loader, JSValue::decode(key), module, nullptr, jsUndefined(), jsUndefined()));
    return engine_source_text_module_run_code(module, globalObject);
}

extern "C" void engine_host_generate_module_exports(JSGlobalObject* globalObject, SourceProvider* provider, UniquedStringImpl** key, Engine::SyntheticExports* exports)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    Vector<Identifier, 4> names;
    MarkedArgumentBuffer values;
    JSObject* source = static_cast<SyntheticSourceProvider*>(provider)->generate(globalObject, *reinterpret_cast<Identifier*>(key), names, values);
    RETURN_IF_EXCEPTION(scope, );
    if (values.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return;
    }
    Engine::synthetic_exports_set(*exports, names.span(), ArgList(values).span(), source);
}

extern "C" EncodedJSValue Bun__analyzeTranspiledModule(JSGlobalObject*, JSModuleLoader*, const Identifier& key, const SourceCode&, JSPromise*);

extern "C" void engine_host_make_analyzed_module(JSGlobalObject* globalObject, JSModuleLoader* loader, UniquedStringImpl** key, SourceCode* source, JSPromise* promise)
{
    Bun__analyzeTranspiledModule(globalObject, loader, *reinterpret_cast<Identifier*>(key), *source, promise);
}

extern "C" bool engine_host_have_same_origin(SourceProvider* a, SourceProvider* b)
{
    return a->sourceOrigin() == b->sourceOrigin();
}

extern "C" Structure* engine_host_module_namespace_shape(JSGlobalObject* globalObject)
{
    return globalObject->m_moduleNamespaceObjectStructure.get(globalObject);
}

} // namespace JSC
