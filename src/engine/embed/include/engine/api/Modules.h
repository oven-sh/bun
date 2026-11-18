#pragma once

// Module records, namespaces and loaders.

#include "engine/api/Code.h"
#include "engine/api/Promise.h"
#include "engine/api/Scope.h"

namespace JSC {

class JSModuleNamespaceObject;
class ModuleProgramExecutable;

class ScriptFetchParameters {
    WTF_MAKE_NONCOPYABLE(ScriptFetchParameters);

public:
    using Type = ScriptFetchParametersType;
    using enum Type;
    using Attributes = Vector<KeyValuePair<RefPtr<UniquedStringImpl>, String>>;

    static Ref<ScriptFetchParameters> create(Type type) { return Engine::fetch_parameters_create(type); }
    static Ref<ScriptFetchParameters> create(const String& hostDefinedImportType) { return Engine::fetch_parameters_create_host_defined(hostDefinedImportType); }

    void ref() const { Engine::fetch_parameters_retain(this); }
    void deref() const { Engine::fetch_parameters_release(this); }

    Type type() const { return Engine::fetch_parameters_type(*this); }
    String hostDefinedImportType() const { return Engine::fetch_parameters_host_defined_type(*this); }
    // Those of an `import()`.
    const Attributes attributes() const;
};

using ModuleMapKey = std::pair<UniquedStringImpl*, ScriptFetchParameters::Type>;

class SyntheticSourceProvider final : public SourceProvider {
public:
    using SyntheticSourceGenerator = Function<void(JSGlobalObject*, Identifier, Vector<Identifier, 4>& exportNames, MarkedArgumentBuffer& exportValues)>;
    // An export whose value is empty is read from the returned object when it is first needed.
    using LazySyntheticSourceGenerator = Function<JSObject*(JSGlobalObject*, Identifier, Vector<Identifier, 4>& exportNames, MarkedArgumentBuffer& exportValues)>;

    static Ref<SyntheticSourceProvider> create(SyntheticSourceGenerator&& generator, const SourceOrigin& origin, String url) { return adoptRef(*new SyntheticSourceProvider(WTF::move(generator), nullptr, origin, WTF::move(url))); }
    static Ref<SyntheticSourceProvider> createWithLazyExports(LazySyntheticSourceGenerator&& generator, const SourceOrigin& origin, String url) { return adoptRef(*new SyntheticSourceProvider(nullptr, WTF::move(generator), origin, WTF::move(url))); }

    JSObject* generate(JSGlobalObject* globalObject, const Identifier& key, Vector<Identifier, 4>& exportNames, MarkedArgumentBuffer& exportValues)
    {
        if (m_lazyGenerator)
            return m_lazyGenerator(globalObject, key, exportNames, exportValues);
        m_generator(globalObject, key, exportNames, exportValues);
        return nullptr;
    }

private:
    SyntheticSourceProvider(SyntheticSourceGenerator&& generator, LazySyntheticSourceGenerator&& lazyGenerator, const SourceOrigin& origin, String&& url)
        : SourceProvider("[native code]"_s, origin, WTF::move(url), {}, SourceProviderSourceType::Synthetic)
        , m_generator(WTF::move(generator))
        , m_lazyGenerator(WTF::move(lazyGenerator))
    {
    }

    SyntheticSourceGenerator m_generator;
    LazySyntheticSourceGenerator m_lazyGenerator;
};

class JSSourceCode final : public JSCell {
public:
    ENGINE_DECLARE_CLASS(SourceCode)

    static JSSourceCode* create(VM& vm, SourceCode&& source) { return Engine::source_code_create(vm, source); }

    const SourceCode& sourceCode() const { return Engine::fieldAt<SourceCode>(this, Engine::Layout::JsSourceCode_source); }
};
ENGINE_CLASS_HAS_TYPE(JSSourceCode, JSSourceCodeType);

// What returns a list returns a copy.
class AbstractModuleRecord : public JSDestructibleObject {
public:
    ENGINE_DECLARE_CLASS(AbstractModuleRecord)

    enum class ModulePhase : bool { Evaluation,
        Defer };

    struct ModuleRequest {
        ScriptFetchParameters::Type type() const { return m_attributes ? m_attributes->type() : ScriptFetchParameters::Type::JavaScript; }
        ModuleMapKey key() const { return { m_specifier.impl(), type() }; }

        Identifier m_specifier;
        RefPtr<ScriptFetchParameters> m_attributes;
        ModulePhase m_phase { ModulePhase::Evaluation };
    };

    struct LoadedModule {
        ModuleMapKey request;
        NakedPtr<AbstractModuleRecord> m_module;
    };

    enum class ImportEntryType : uint8_t {
        Single = Engine::ImportKind::Single,
        SingleTypeScript = Engine::ImportKind::SingleTypeScript,
        Namespace = Engine::ImportKind::Namespace,
    };

    struct Resolution {
        enum class Type : bool { NotResolved,
            Resolved };

        bool isLiveExport(VM& vm) const { return type == Type::Resolved && moduleRecord->hasLiveExports() && localName != vm.propertyNames->starNamespacePrivateName; }

        Type type { Type::NotResolved };
        AbstractModuleRecord* moduleRecord { nullptr };
        Identifier localName;
    };

    const Identifier& moduleKey() const { return Engine::fieldAt<Identifier>(this, Engine::Layout::AbstractModuleRecord_key); }
    JSModuleEnvironment* moduleEnvironmentMayBeNull() const { return Engine::module_environment(this); }
    JSModuleEnvironment* moduleEnvironment() const
    {
        ASSERT(moduleEnvironmentMayBeNull());
        return moduleEnvironmentMayBeNull();
    }

    const Vector<ModuleRequest> requestedModules() const;
    size_t requestedModuleCount() const { return Engine::module_request_count(this); }
    ModuleMapKey requestedModuleKey(size_t index) const
    {
        ScriptFetchParameters::Type type;
        auto* specifier = Engine::module_request_key(this, index, type);
        return { static_cast<UniquedStringImpl*>(specifier), type };
    }
    const Vector<LoadedModule, 8> loadedModules() const;
    AbstractModuleRecord* loadedModule(ModuleMapKey request) const { return Engine::module_loaded_module(this, request.first, request.second); }
    void setImportedModule(ModuleMapKey request, AbstractModuleRecord* module) { Engine::module_set_imported_module(this, request.first, request.second, module); }
    // The keys of the requested modules that are being loaded.
    const Vector<RefPtr<UniquedStringImpl>, 8> resolvedRequests() const;
    // Good for as long as the module is being loaded.
    UniquedStringImpl* resolvedRequest(ModuleMapKey request) const { return Engine::module_resolved_request(this, request.first, request.second).impl(); }

    Resolution resolveExport(JSGlobalObject* globalObject, const Identifier& name)
    {
        Resolution resolution;
        if ((resolution.moduleRecord = Engine::module_resolve_export(this, globalObject, name, resolution.localName)))
            resolution.type = Resolution::Type::Resolved;
        return resolution;
    }
    // One that is made extensible can take an own property `__esModule`.
    JSModuleNamespaceObject* getModuleNamespace(JSGlobalObject* globalObject, bool shouldPreventExtensions = true) { return Engine::module_namespace(this, globalObject, !shouldPreventExtensions); }
    JSObject* moduleNamespaceObject(JSGlobalObject*);

    void link(JSGlobalObject* globalObject, std::nullptr_t) { Engine::module_link(this, globalObject); }
    JSPromise* evaluate(JSGlobalObject* globalObject) { return Engine::module_evaluate(this, globalObject); }

    bool hasLiveExports() const { return Engine::fieldAt<bool>(this, Engine::Layout::AbstractModuleRecord_has_live_exports); }
    JSObject* liveExportsSource() const { return Engine::module_live_exports_source(this); }
    void setLiveExportsSource(VM&, JSObject* source) { Engine::module_set_live_exports_source(this, source); }
};

class CyclicModuleRecord : public AbstractModuleRecord {
public:
    ENGINE_DECLARE_CLASS(CyclicModuleRecord)

    enum class Status : uint8_t {
        New = Engine::ModuleStatus::New,
        Unlinked = Engine::ModuleStatus::Unlinked,
        Linking = Engine::ModuleStatus::Linking,
        Linked = Engine::ModuleStatus::Linked,
        Evaluating = Engine::ModuleStatus::Evaluating,
        EvaluatingAsync = Engine::ModuleStatus::EvaluatingAsync,
        Evaluated = Engine::ModuleStatus::Evaluated,
    };

    Status status() const { return static_cast<Status>(Engine::cyclic_module_status(this)); }
    void setStatus(Status status) { Engine::cyclic_module_set_status(this, static_cast<uint8_t>(status)); }
    JSValue evaluationError() const { return Engine::cyclic_module_evaluation_error(this); }
    bool isSCCEvaluated() const { return Engine::cyclic_module_is_cycle_evaluated(this); }
    bool hasTLA() const { return Engine::cyclic_module_has_top_level_await(this); }
    void setHasTLA(bool value) { Engine::cyclic_module_set_has_top_level_await(this, value); }
    unsigned pendingAsyncDependencies() const { return Engine::cyclic_module_pending_async_dependencies(this); }
};

class JSModuleRecord final : public CyclicModuleRecord {
public:
    ENGINE_DECLARE_CLASS(SourceTextModuleRecord)

    // For a caller that adds the entries itself.
    static JSModuleRecord* create(JSGlobalObject* globalObject, JSModuleLoader* loader, const Identifier& key, const SourceCode& source) { return Engine::source_text_module_create(globalObject, loader, key, source); }
    // Parses the source, for the realm of the loader. Null with one of the errors if that fails.
    static JSModuleRecord* analyze(JSModuleLoader* loader, const Identifier& key, const SourceCode& source, ParserError& parserError, String& attributeError) { return Engine::source_text_module_analyze(loader, key, source, parserError, attributeError); }

    void setIsTypeScript(bool value) { Engine::fieldAt<bool>(this, Engine::Layout::AbstractModuleRecord_is_typescript) = value; }
    void reserveCapacity(unsigned requests, unsigned imports, unsigned exports) { Engine::module_reserve_entries(this, requests, imports, exports); }
    void appendRequestedModule(const Identifier& specifier, RefPtr<ScriptFetchParameters>&& attributes, ModulePhase phase) { Engine::module_add_request(this, specifier, WTF::move(attributes), phase == ModulePhase::Defer); }
    void addImportEntry(ImportEntryType type, ModulePhase phase, ModuleMapKey request, const Identifier& importName, const Identifier& localName) { Engine::module_add_import(this, static_cast<uint8_t>(type), phase == ModulePhase::Defer, request.first, request.second, importName, localName); }
    void addLocalExport(const Identifier& exportName, const Identifier& localName) { Engine::module_add_local_export(this, exportName, localName); }
    void addIndirectExport(const Identifier& exportName, const Identifier& importName, ModuleMapKey request) { Engine::module_add_indirect_export(this, exportName, importName, request.first, request.second); }
    void addNamespaceExport(const Identifier& exportName, ModuleMapKey request) { Engine::module_add_namespace_export(this, exportName, request.first, request.second); }
    void addStarExport(ModuleMapKey request) { Engine::module_add_star_export(this, request.first, request.second); }
    // The same for records that have the same entries, in whatever order.
    String describeEntries() const { return Engine::module_describe_entries(this); }

    // As they are in the first declaration with that request, from analyze() until the module is linked.
    const ScriptFetchParameters::Attributes declaredAttributes(ModuleMapKey request) const;
    // Null if the module is not linked or does not refer to it.
    JSObject* importMeta(JSGlobalObject* globalObject) { return Engine::source_text_module_import_meta(this, globalObject); }
};

class SyntheticModuleRecord final : public AbstractModuleRecord {
public:
    ENGINE_DECLARE_CLASS(SyntheticModuleRecord)

    static SyntheticModuleRecord* createWithUndefinedExports(JSGlobalObject* globalObject, JSModuleLoader* loader, const Identifier& key, std::span<const Identifier> names) { return Engine::synthetic_module_with_undefined_exports(globalObject, loader, key, names); }
};

class JSModuleNamespaceObject final : public JSDestructibleObject {
public:
    ENGINE_DECLARE_CLASS(ModuleNamespace)

    static Structure* createStructure(VM&, JSGlobalObject* globalObject, JSValue prototype) { return Engine::module_namespace_create_shape(globalObject, prototype); }

    AbstractModuleRecord* moduleRecord() const { return Engine::fieldAt<AbstractModuleRecord*>(this, Engine::Layout::ModuleNamespace_module); }
    bool overrideExportValue(JSGlobalObject* globalObject, PropertyName name, JSValue value) { return Engine::module_namespace_override_export(this, globalObject, name, value); }
    bool hasESModuleMarker() const { return Engine::fieldAt<bool>(this, Engine::Layout::ModuleNamespace_has_es_module_marker); }
    void setHasESModuleMarker(bool value) { Engine::fieldAt<bool>(this, Engine::Layout::ModuleNamespace_has_es_module_marker) = value; }
};
ENGINE_CLASS_HAS_TYPE(JSModuleNamespaceObject, ModuleNamespaceObjectType);

inline JSObject* AbstractModuleRecord::moduleNamespaceObject(JSGlobalObject* globalObject) { return getModuleNamespace(globalObject); }

class ModuleRegistryEntry final : public JSCell {
public:
    ENGINE_DECLARE_CLASS(ModuleRegistryEntry)

    enum class Status : uint8_t {
        New = Engine::RegistryStatus::New,
        Fetching = Engine::RegistryStatus::Fetching,
        Fetched = Engine::RegistryStatus::Fetched,
        FetchFailed = Engine::RegistryStatus::FetchFailed,
        InstantiationFailed = Engine::RegistryStatus::InstantiationFailed,
        EvaluationFailed = Engine::RegistryStatus::EvaluationFailed,
    };

    const Identifier& key() const { return Engine::fieldAt<Identifier>(this, Engine::Layout::ModuleRegistryEntry_key + Engine::Layout::ModuleKey_name); }
    ScriptFetchParameters::Type moduleType() const { return Engine::fieldAt<ScriptFetchParameters::Type>(this, Engine::Layout::ModuleRegistryEntry_key + Engine::Layout::ModuleKey_module_type); }
    Status status() const { return Engine::fieldAt<Status>(this, Engine::Layout::ModuleRegistryEntry_status); }
    void setStatus(Status status) { Engine::fieldAt<Status>(this, Engine::Layout::ModuleRegistryEntry_status) = status; }
    AbstractModuleRecord* record() const { return Engine::fieldAt<AbstractModuleRecord*>(this, Engine::Layout::ModuleRegistryEntry_module); }
    JSPromise* loadPromise() const { return Engine::fieldAt<JSPromise*>(this, Engine::Layout::ModuleRegistryEntry_promise_of_load); }

    JSPromise* ensureFetchPromise(JSGlobalObject* globalObject) { return Engine::registry_entry_ensure_fetch_promise(this, globalObject); }
    JSPromise* ensureModulePromise(JSGlobalObject* globalObject) { return Engine::registry_entry_ensure_module_promise(this, globalObject); }
    void setFetchError(JSGlobalObject* globalObject, JSValue error) { Engine::registry_entry_set_fetch_error(this, globalObject->vm(), error); }
    void provideModule(VM& vm, AbstractModuleRecord* module) { Engine::registry_entry_provide_module(this, vm, module); }
    bool isLoaded() const { return Engine::registry_entry_is_loaded(this); }
    void markLoaded() { Engine::registry_entry_mark_loaded(this); }
};

// The entries that a loader has at the time, which it keeps alive.
class ModuleRegistrySnapshot {
public:
    class Iterator {
    public:
        explicit Iterator(ModuleRegistryEntry** position)
            : m_position(position)
        {
        }

        const KeyValuePair<ModuleMapKey, NakedPtr<ModuleRegistryEntry>>& operator*()
        {
            auto* entry = *m_position;
            return m_current = { { entry->key().impl(), entry->moduleType() }, entry };
        }
        void operator++() { ++m_position; }
        bool operator==(const Iterator& other) const { return m_position == other.m_position; }

    private:
        ModuleRegistryEntry** m_position;
        KeyValuePair<ModuleMapKey, NakedPtr<ModuleRegistryEntry>> m_current;
    };

    explicit ModuleRegistrySnapshot(const JSModuleLoader* loader)
    {
        Engine::module_loader_for_each_entry(loader, &m_entries, [](void* entries, ModuleRegistryEntry* entry) { static_cast<Entries*>(entries)->append(entry); });
    }

    Iterator begin() const { return Iterator(m_entries.begin()); }
    Iterator end() const { return Iterator(m_entries.end()); }

private:
    using Entries = MarkedVector<ModuleRegistryEntry*, 32>;

    Entries m_entries;
};

enum class ModuleLoadFlag : uint8_t {
    Evaluate = 1 << 0,
    Dynamic = 1 << 1,
};

// An order of asynchronous evaluation is -1 where there is none.
class JSModuleLoader final : public JSCell {
public:
    ENGINE_DECLARE_CLASS(ModuleLoader)

    static JSModuleLoader* create(JSGlobalObject*, VM& vm, JSScope* moduleScope) { return Engine::module_loader_create(vm, moduleScope); }
    static void drainSynchronousModuleQueue(JSGlobalObject* globalObject) { Engine::drain_synchronous_module_queue(globalObject); }

    JSScope* moduleScope() const { return Engine::fieldAt<JSScope*>(this, Engine::Layout::ModuleLoader_module_scope); }
    JSValue asyncContext() const { return Engine::fieldAt<JSValue>(this, Engine::Layout::ModuleLoader_async_context); }
    void setAsyncContext(VM& vm, JSValue context) { Engine::fieldAt<WriteBarrier<Unknown>>(this, Engine::Layout::ModuleLoader_async_context).set(vm, this, context); }

    ModuleRegistrySnapshot moduleMap() const { return ModuleRegistrySnapshot(this); }
    size_t moduleCount() const { return Engine::module_loader_entry_count(this); }
    // Of any type.
    ModuleRegistryEntry* registryEntry(const Identifier& key) const { return Engine::module_loader_find_entry_of_any_type(this, key); }
    ModuleRegistryEntry* getRegisteredMayBeNull(const Identifier& key, ScriptFetchParameters::Type type) const { return Engine::module_loader_find_entry(this, key, type); }
    ModuleRegistryEntry* ensureRegistered(JSGlobalObject* globalObject, const Identifier& key, ScriptFetchParameters::Type type) { return Engine::module_loader_ensure_entry(this, globalObject->vm(), key, type); }
    bool removeEntry(const Identifier& key) { return Engine::module_loader_remove_entries(this, key); }
    void clearAll() { Engine::module_loader_clear(this); }
    int64_t asyncEvaluationOrderForKey(const Identifier& key) const { return Engine::module_loader_async_evaluation_order(this, key); }
    // While something keeps it alive, the records of later loaders run the code that it has.
    ModuleProgramExecutable* shareableExecutable(JSGlobalObject* globalObject, const Identifier& key) const { return Engine::module_loader_shareable_executable(this, globalObject, key); }

    void provideFetch(JSGlobalObject* globalObject, const Identifier& key, ScriptFetchParameters::Type type, JSValue data) { Engine::module_loader_provide_fetch(this, globalObject, key, type, data); }
    void provideFetch(JSGlobalObject* globalObject, const Identifier& key, ScriptFetchParameters::Type type, SourceCode&& source) { provideFetch(globalObject, key, type, JSSourceCode::create(globalObject->vm(), WTF::move(source))); }
    Identifier resolve(JSGlobalObject* globalObject, const Identifier& name, const Identifier& referrer, std::nullptr_t, bool useImportMap) { return Engine::module_loader_resolve(this, globalObject, name, referrer, useImportMap); }
    JSPromise* makeModule(JSGlobalObject* globalObject, const Identifier& key, JSValue data) { return Engine::module_loader_make_module(this, globalObject, key, data); }
    JSPromise* loadModule(JSGlobalObject* globalObject, const Identifier& key, RefPtr<ScriptFetchParameters> parameters, std::nullptr_t, OptionSet<ModuleLoadFlag> flags) { return Engine::module_loader_load(this, globalObject, key, WTF::move(parameters), flags.contains(ModuleLoadFlag::Evaluate), flags.contains(ModuleLoadFlag::Dynamic)); }
    JSPromise* loadModuleSync(JSGlobalObject* globalObject, const Identifier& key, RefPtr<ScriptFetchParameters>&& parameters, std::nullptr_t) { return Engine::module_loader_load_synchronously(this, globalObject, key, WTF::move(parameters)); }
    JSPromise* requestImportModule(JSGlobalObject* globalObject, const Identifier& specifier, const Identifier& referrer, RefPtr<ScriptFetchParameters> parameters, std::nullptr_t) { return Engine::module_loader_request_import(this, globalObject, specifier, referrer, WTF::move(parameters)); }
    JSPromise* requestImportModuleForKey(JSGlobalObject* globalObject, const Identifier& key, const Identifier& referrer, RefPtr<ScriptFetchParameters> parameters, std::nullptr_t, bool isDeferred, int64_t referrerAsyncOrder) { return Engine::module_loader_request_import_of_key(this, globalObject, key, referrer, WTF::move(parameters), isDeferred, referrerAsyncOrder); }

    JSModuleNamespaceObject* getModuleNamespaceObject(JSGlobalObject*, JSValue moduleRecord);
    // Runs the code of the module. Code that awaits returns a promise for its end.
    JSValue evaluateNonVirtual(JSGlobalObject* globalObject, JSValue, JSValue moduleRecord, RefPtr<ScriptFetcher>, JSValue, JSValue) { return Engine::source_text_module_run_code(downcast<JSModuleRecord>(moduleRecord), globalObject); }
};

class ModuleProgramExecutable final : public JSCell {
public:
    ENGINE_DECLARE_CLASS(ModuleExecutable)
};
ENGINE_CLASS_HAS_TYPE(ModuleProgramExecutable, ModuleProgramExecutableType);

inline JSPromise* importModule(JSGlobalObject* globalObject, const Identifier& specifier, const Identifier& referrer, RefPtr<ScriptFetchParameters> parameters, std::nullptr_t) { return globalObject->moduleLoader()->requestImportModule(globalObject, specifier, referrer, WTF::move(parameters), nullptr); }
inline JSPromise* loadAndEvaluateModule(JSGlobalObject* globalObject, const String& name, RefPtr<ScriptFetchParameters> parameters, std::nullptr_t) { return Engine::load_and_evaluate_module(globalObject, Identifier::fromString(globalObject->vm(), name), WTF::move(parameters)); }
// Throws the error that the text has, if any.
inline void checkModuleSyntax(JSGlobalObject* globalObject, const SourceCode& source) { Engine::check_module_syntax(globalObject, source); }

} // namespace JSC
