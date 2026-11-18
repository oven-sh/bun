#pragma once

// A global object and everything else that a realm has one of.

#include "engine/api/Lazy.h"

namespace Inspector {
class JSGlobalObjectInspectorController;
}

namespace JSC {

class JSModuleRecord;
class WebAssemblyCompileOptions;
enum class ArrayBufferSharingMode : bool;
enum TypedArrayType : uint8_t;
class ScriptFetchParameters;

namespace AOT {
struct ModuleHost;
}

enum class QueuedTaskResult : bool { Executed,
    Discard };

class RuntimeFlags {};
enum class CompilationType { Eval };

// What a realm asks of its embedder.
struct GlobalObjectMethodTable {
    bool (*supportsRichSourceInfo)(const JSGlobalObject*);
    bool (*shouldInterruptScript)(const JSGlobalObject*);
    RuntimeFlags (*javaScriptRuntimeFlags)(const JSGlobalObject*);
    bool (*shouldInterruptScriptBeforeTimeout)(const JSGlobalObject*);
    bool (*moduleTypeIsAllowed)(ScriptFetchParametersType);
    JSPromise* (*moduleLoaderImportModule)(JSGlobalObject*, JSModuleLoader*, JSString* specifier, RefPtr<ScriptFetchParameters>, const SourceOrigin&, bool isDeferred);
    Identifier (*moduleLoaderResolve)(JSGlobalObject*, JSModuleLoader*, JSValue specifier, JSValue referrer, RefPtr<ScriptFetcher>, bool useImportMap);
    JSPromise* (*moduleLoaderFetch)(JSGlobalObject*, JSModuleLoader*, JSValue key, const String& referrer, RefPtr<ScriptFetchParameters>, RefPtr<ScriptFetcher>);
    JSObject* (*moduleLoaderCreateImportMetaProperties)(JSGlobalObject*, JSModuleLoader*, JSValue key, JSModuleRecord*, RefPtr<ScriptFetcher>);
    JSValue (*moduleLoaderEvaluate)(JSGlobalObject*, JSModuleLoader*, JSValue key, JSValue moduleRecord, RefPtr<ScriptFetcher>, JSValue sentValue, JSValue resumeMode);
    void (*promiseRejectionTracker)(JSGlobalObject*, JSPromise*, JSPromiseRejectionOperation);
    void (*reportUncaughtExceptionAtEventLoop)(JSGlobalObject*, Exception*);
    JSObject* (*currentScriptExecutionOwner)(JSGlobalObject*);
    ScriptExecutionStatus (*scriptExecutionStatus)(JSGlobalObject*, JSObject* scriptExecutionOwner);
    void (*reportViolationForUnsafeEval)(JSGlobalObject*, const String&);
    String (*defaultLanguage)();
    void (*compileStreaming)(JSGlobalObject*, JSPromise*, JSValue source, std::optional<WebAssemblyCompileOptions>&&);
    void (*instantiateStreaming)(JSGlobalObject*, JSPromise*, JSValue source, JSObject* imports, std::optional<WebAssemblyCompileOptions>&&);
    JSGlobalObject* (*deriveShadowRealmGlobalObject)(JSGlobalObject*);
    String (*codeForEval)(JSGlobalObject*, JSValue);
    bool (*canCompileStrings)(JSGlobalObject*, CompilationType, String, const ArgList&);
    Structure* (*trustedScriptStructure)(JSGlobalObject*);
    JSValue (*requireBuiltinModule)(JSGlobalObject*, uint32_t id);
    JSValue (*nativeBinding)(JSGlobalObject*, uint32_t index);
    const AOT::ModuleHost* moduleHost { nullptr };
};

// The structure and the constructor of a class of the standard library.
template<uint16_t structureSlot, uint16_t constructorSlot> struct RealmClass {
    Structure* get(const JSGlobalObject*) const;
    JSObject* prototype(const JSGlobalObject* global) const { return get(global)->storedPrototypeObject(); }
    JSObject* constructor(const JSGlobalObject*) const;
    JSObject* constructorInitializedOnMainThread(const JSGlobalObject* global) const { return constructor(global); }
};

// Something that fast paths count on.
class InlineWatchpointSet {
public:
    InlineWatchpointSet(JSGlobalObject* globalObject, uint8_t which)
        : m_globalObject(globalObject)
        , m_which(which)
    {
    }

    void fireAll(VM&, const char*) { Engine::global_invalidate_watchpoints(m_globalObject, m_which); }

private:
    JSGlobalObject* m_globalObject;
    uint8_t m_which;
};

class RealmRandom {
public:
    explicit RealmRandom(JSGlobalObject* globalObject)
        : m_globalObject(globalObject)
    {
    }

    unsigned seed() const { return Engine::global_random_seed(m_globalObject); }
    void setSeed(unsigned seed) { Engine::global_set_random_seed(m_globalObject, seed); }

private:
    JSGlobalObject* m_globalObject;
};

class JSGlobalObject : public JSScope {
public:
    using Base = JSScope;
    template<typename T> using Initializer = typename LazyProperty<JSGlobalObject, T>::Initializer;

    ENGINE_DECLARE_CLASS(GlobalObject)

    static constexpr unsigned StructureFlags = Engine::Layout::globalObjectFlags;

    struct GlobalPropertyInfo {
        GlobalPropertyInfo(const Identifier& identifier, JSValue value, unsigned attributes)
            : identifier(identifier)
            , value(value)
            , attributes(attributes)
        {
        }

        const Identifier identifier;
        JSValue value;
        unsigned attributes;
    };

    static void destroy(JSCell* cell) { static_cast<JSGlobalObject*>(cell)->~JSGlobalObject(); }
    static void analyzeHeap(JSCell*, HeapAnalyzer&) ENGINE_SYMBOL(engine_GlobalObject_analyze_heap);
    static bool put(JSCell*, JSGlobalObject*, PropertyName, JSValue, PutPropertySlot&) ENGINE_SYMBOL(engine_GlobalObject_put);
    static bool deleteProperty(JSCell*, JSGlobalObject*, PropertyName, DeletePropertySlot&) ENGINE_SYMBOL(engine_GlobalObject_delete_property);
    using JSObject::deleteProperty;
    static bool getOwnPropertySlot(JSObject*, JSGlobalObject*, PropertyName, PropertySlot&) ENGINE_SYMBOL(engine_GlobalObject_get_own_property_slot);
    static void getOwnSpecialPropertyNames(JSObject*, JSGlobalObject*, PropertyNameArrayBuilder&, DontEnumPropertiesMode) ENGINE_SYMBOL(engine_GlobalObject_own_special_property_names);
    static bool defineOwnProperty(JSObject*, JSGlobalObject*, PropertyName, const PropertyDescriptor&, bool shouldThrow) ENGINE_SYMBOL(engine_GlobalObject_define_own_property);
    ENGINE_DECLARE_VISIT_CHILDREN(GlobalObject);

    static bool supportsRichSourceInfo(const JSGlobalObject*) { return true; }
    static bool shouldInterruptScript(const JSGlobalObject*) { return true; }
    static RuntimeFlags javaScriptRuntimeFlags(const JSGlobalObject*) { return {}; }
    static void reportUncaughtExceptionAtEventLoop(JSGlobalObject*, Exception*);
    static JSObject* currentScriptExecutionOwner(JSGlobalObject* globalObject) { return globalObject; }
    static ScriptExecutionStatus scriptExecutionStatus(JSGlobalObject*, JSObject*) { return ScriptExecutionStatus::Running; }
    static String codeForEval(JSGlobalObject*, JSValue) { return {}; }
    static bool canCompileStrings(JSGlobalObject*, CompilationType, String, const ArgList&) { return true; }
    static Structure* trustedScriptStructure(JSGlobalObject*) { return nullptr; }

    ~JSGlobalObject();

    ALWAYS_INLINE VM& vm() const { return *m_vm; }
    const GlobalObjectMethodTable* globalObjectMethodTable() const { return m_methodTable; }

    JSObject* globalThis() const { return m_globalThis.get(); }
    JSScope* globalScope() { return this; }
    // Of a class with ENGINE_DECLARE_SANDBOX_METHODS. Set once, after finishCreation().
    JSObject* sandbox() const { return Engine::global_sandbox(this); }
    void setSandbox(JSObject* sandbox) { Engine::global_set_sandbox(this, sandbox); }
    void addStaticGlobals(std::span<GlobalPropertyInfo> globals)
    {
        for (auto& global : globals)
            Engine::global_add_static_global(this, global.identifier, global.value, global.attributes);
    }

    template<typename T> ALWAYS_INLINE T* eagerSlot(uint16_t index) const { return reinterpret_cast<T*>(slots()[index]); }
    template<typename T> ALWAYS_INLINE T* lazySlot(uint16_t index) const
    {
        if (JSCell* cell = slots()[index]) [[likely]]
            return reinterpret_cast<T*>(cell);
        return reinterpret_cast<T*>(Engine::global_slot(this, index));
    }

#define ENGINE_EAGER_SLOT(type, method, slot) \
    type* method() const { return eagerSlot<type>(Engine::RealmSlot::slot); }
#define ENGINE_LAZY_SLOT(type, method, slot) \
    type* method() const { return lazySlot<type>(Engine::RealmSlot::slot); }
    ENGINE_EAGER_SLOT(JSObject, objectPrototype, object_prototype)
    ENGINE_EAGER_SLOT(JSObject, functionPrototype, function_prototype)
    ENGINE_EAGER_SLOT(JSObject, stringPrototype, string_prototype)
    ENGINE_EAGER_SLOT(JSObject, iteratorPrototype, iterator_prototype)
    ENGINE_EAGER_SLOT(Structure, objectStructureForObjectConstructor, object_shape)
    ENGINE_EAGER_SLOT(Structure, nullPrototypeObjectStructure, null_prototype_object_shape)
    ENGINE_LAZY_SLOT(JSObject, objectConstructor, object_constructor)
    ENGINE_LAZY_SLOT(JSObject, arrayConstructor, array_constructor)
    ENGINE_LAZY_SLOT(JSObject, booleanObjectConstructor, boolean_constructor)
    ENGINE_LAZY_SLOT(JSObject, numberObjectConstructor, number_constructor)
    ENGINE_LAZY_SLOT(JSObject, errorConstructor, error_constructor)
    ENGINE_LAZY_SLOT(JSObject, promiseConstructor, promise_constructor)
    ENGINE_LAZY_SLOT(JSObject, asyncIteratorPrototype, async_iterator_prototype)
    ENGINE_LAZY_SLOT(JSObject, bigIntPrototype, bigint_prototype)
    ENGINE_LAZY_SLOT(JSObject, datePrototype, date_prototype)
    ENGINE_LAZY_SLOT(JSObject, errorPrototype, error_prototype)
    ENGINE_LAZY_SLOT(JSObject, regExpPrototype, regexp_prototype)
    ENGINE_LAZY_SLOT(JSObject, symbolPrototype, symbol_prototype)
    ENGINE_LAZY_SLOT(JSFunction, performPromiseThenFunction, private_perform_promise_then)
    ENGINE_LAZY_SLOT(JSFunction, rejectPromiseFunction, private_reject_promise)
    ENGINE_LAZY_SLOT(JSModuleLoader, moduleLoader, module_loader)
    ENGINE_LAZY_SLOT(Structure, booleanObjectStructure, boolean_object_shape)
    ENGINE_LAZY_SLOT(Structure, dateStructure, date_shape)
    ENGINE_LAZY_SLOT(Structure, errorStructure, error_shape)
    ENGINE_LAZY_SLOT(Structure, internalFieldTupleStructure, internal_field_tuple_shape)
    ENGINE_LAZY_SLOT(Structure, iteratorResultObjectStructure, iterator_result_shape)
    ENGINE_LAZY_SLOT(Structure, mapStructure, map_shape)
    ENGINE_LAZY_SLOT(Structure, mapIteratorStructure, map_iterator_shape)
    ENGINE_LAZY_SLOT(Structure, setStructure, set_shape)
    ENGINE_LAZY_SLOT(Structure, setIteratorStructure, set_iterator_shape)
    ENGINE_LAZY_SLOT(Structure, weakMapStructure, weak_map_shape)
    ENGINE_LAZY_SLOT(Structure, weakSetStructure, weak_set_shape)
    ENGINE_LAZY_SLOT(Structure, promiseStructure, promise_shape)
    ENGINE_LAZY_SLOT(Structure, regExpStructure, regexp_shape)
#undef ENGINE_EAGER_SLOT
#undef ENGINE_LAZY_SLOT

    JSValue nullPrototype() const { return jsNull(); }
    Structure* errorStructure(ErrorType type) const { return lazySlot<Structure>(Engine::RealmSlot::error_shape + static_cast<uint16_t>(type)); }
    Structure* originalArrayStructureForIndexingType(IndexingType type) const { return m_originalArrayStructures[type >> 1]; }
    Structure* arrayStructureForIndexingTypeDuringAllocation(IndexingType type) const { return m_arrayStructuresForAllocation[type >> 1]; }
    StructureCache structureCache() { return {}; }

    Structure* arrayBufferStructure(ArrayBufferSharingMode mode = {}) const { return lazySlot<Structure>(static_cast<bool>(mode) ? Engine::RealmSlot::shared_array_buffer_shape : Engine::RealmSlot::array_buffer_shape); }
    template<ArrayBufferSharingMode mode> Structure* arrayBufferStructureWithSharingMode() const { return arrayBufferStructure(mode); }
    Structure* typedArrayStructure(TypedArrayType, bool isResizableOrGrowableShared) const;
    template<TypedArrayType type> Structure* typedArrayStructureWithTypedArrayType() const { return typedArrayStructure(type, false); }
    template<TypedArrayType type> Structure* resizableOrGrowableSharedTypedArrayStructureWithTypedArrayType() const { return typedArrayStructure(type, true); }

    InlineWatchpointSet promiseSpeciesWatchpointSet() { return { this, Engine::RealmWatchpoint::PromiseSpecies }; }
    InlineWatchpointSet promiseThenWatchpointSet() { return { this, Engine::RealmWatchpoint::PromiseThen }; }

    MicrotaskQueue& microtaskQueue() const;
    void setMicrotaskQueue(Ref<MicrotaskQueue>&&);
    QueuedTaskResult microtaskRunnability() const { return m_microtaskRunnability; }
    void setMicrotaskRunnability(QueuedTaskResult runnability) { m_microtaskRunnability = runnability; }
    bool isAsyncContextTrackingEnabled() const { return vm().isAsyncContextTrackingEnabled(); }
    void setAsyncContextTrackingEnabled(bool);

    void setEvalEnabled(bool enabled, const String& errorMessage = {}) { Engine::global_set_eval_enabled(this, enabled, errorMessage); }
    void setWebAssemblyEnabled(bool enabled, const String& errorMessage = {}) { Engine::global_set_webassembly_enabled(this, enabled, errorMessage); }
    std::optional<unsigned> stackTraceLimit() const
    {
        unsigned limit;
        return Engine::global_stack_trace_limit(this, limit) ? std::optional(limit) : std::nullopt;
    }
    double jsDateNow() const { return Engine::global_date_now(this); }
    RealmRandom weakRandom() { return RealmRandom(this); }

    ConsoleClient* consoleClient() const { return m_consoleClient; }
    void setConsoleClient(ConsoleClient* client) { m_consoleClient = client; }
    bool hasDebugger() const { return m_inspectorController && Engine::global_has_debugger(this); }
    bool inspectable() const { return m_isInspectable; }
    void setInspectable(bool isInspectable) { m_isInspectable = isInspectable; }
    bool hasInspectorController() const { return !!m_inspectorController; }
    Inspector::JSGlobalObjectInspectorController& inspectorController();

    static constexpr RealmClass<Engine::RealmSlot::error_shape, Engine::RealmSlot::error_constructor> m_errorStructure {};
    static constexpr RealmClass<Engine::RealmSlot::eval_error_shape, Engine::RealmSlot::eval_error_constructor> m_evalErrorStructure {};
    static constexpr RealmClass<Engine::RealmSlot::range_error_shape, Engine::RealmSlot::range_error_constructor> m_rangeErrorStructure {};
    static constexpr RealmClass<Engine::RealmSlot::reference_error_shape, Engine::RealmSlot::reference_error_constructor> m_referenceErrorStructure {};
    static constexpr RealmClass<Engine::RealmSlot::syntax_error_shape, Engine::RealmSlot::syntax_error_constructor> m_syntaxErrorStructure {};
    static constexpr RealmClass<Engine::RealmSlot::type_error_shape, Engine::RealmSlot::type_error_constructor> m_typeErrorStructure {};
    static constexpr RealmClass<Engine::RealmSlot::uri_error_shape, Engine::RealmSlot::uri_error_constructor> m_URIErrorStructure {};
    static constexpr RealmClass<Engine::RealmSlot::aggregate_error_shape, Engine::RealmSlot::aggregate_error_constructor> m_aggregateErrorStructure {};
    static constexpr RealmClass<Engine::RealmSlot::suppressed_error_shape, Engine::RealmSlot::suppressed_error_constructor> m_suppressedErrorStructure {};
    static constexpr RealmClass<Engine::RealmSlot::uint8_array_shape, Engine::RealmSlot::uint8_array_constructor> m_typedArrayUint8 {};

protected:
    JSGlobalObject(VM&, Structure*, const GlobalObjectMethodTable* = nullptr);

    void finishCreation(VM& vm)
    {
        Base::finishCreation(vm);
        Engine::global_finish_creation(this, vm);
    }

private:
    static constexpr size_t namedSlotCount = 4;
    static void checkLayout();

    JSCell* const* slots() const { return reinterpret_cast<JSCell* const*>(&m_globalThis); }

    VM* m_vm;
    void* m_hooks;
    const GlobalObjectMethodTable* m_methodTable;

public:
    // NaN if it is not.
    double overridenDateNow;

private:
    ConsoleClient* m_consoleClient;
    QueuedTaskResult m_microtaskRunnability;
    WriteBarrier<JSScope> m_scopeExtension;
    Structure* m_originalArrayStructures[16];
    Structure* m_arrayStructuresForAllocation[16];

public:
    WriteBarrier<JSObject> m_globalThis;
    WriteBarrier<InternalFieldTuple> m_asyncContextData;
    WriteBarrier<JSObject> m_objectPrototype;
    WriteBarrier<JSObject> m_functionPrototype;

private:
    Engine::Opaque<(Engine::RealmSlot::COUNT - namedSlotCount) * sizeof(JSCell*) + Engine::Layout::globalObjectSizeAfterSlots> m_rest;

public:
    // From here on, what only C++ has.
    // For a class that wants another than the default.
    LazyProperty<JSGlobalObject, Structure> m_moduleNamespaceObjectStructure;

private:
    std::unique_ptr<Inspector::JSGlobalObjectInspectorController> m_inspectorController;
    bool m_isInspectable { false };
};
ENGINE_CLASS_HAS_TYPE(JSGlobalObject, GlobalObjectType);

inline void JSGlobalObject::checkLayout()
{
    ENGINE_CHECK_OFFSET(JSGlobalObject, m_vm, GlobalObject_vm);
    ENGINE_CHECK_OFFSET(JSGlobalObject, m_methodTable, GlobalObject_embedder_methods);
    ENGINE_CHECK_OFFSET(JSGlobalObject, overridenDateNow, GlobalObject_overridden_date_now);
    ENGINE_CHECK_OFFSET(JSGlobalObject, m_consoleClient, GlobalObject_console_client);
    ENGINE_CHECK_OFFSET(JSGlobalObject, m_microtaskRunnability, GlobalObject_discards_microtasks);
    ENGINE_CHECK_OFFSET(JSGlobalObject, m_scopeExtension, GlobalObject_scope_extension);
    ENGINE_CHECK_OFFSET(JSGlobalObject, m_originalArrayStructures, GlobalObject_original_array_shapes);
    ENGINE_CHECK_OFFSET(JSGlobalObject, m_arrayStructuresForAllocation, GlobalObject_array_shapes_for_allocation);
    ENGINE_CHECK_OFFSET(JSGlobalObject, m_globalThis, GlobalObject_slots + Engine::RealmSlot::global_this * sizeof(JSCell*));
    ENGINE_CHECK_OFFSET(JSGlobalObject, m_asyncContextData, GlobalObject_slots + Engine::RealmSlot::async_context * sizeof(JSCell*));
    ENGINE_CHECK_OFFSET(JSGlobalObject, m_objectPrototype, GlobalObject_slots + Engine::RealmSlot::object_prototype * sizeof(JSCell*));
    ENGINE_CHECK_OFFSET(JSGlobalObject, m_functionPrototype, GlobalObject_slots + Engine::RealmSlot::function_prototype * sizeof(JSCell*));
    static_assert(Engine::RealmSlot::suppressed_error_shape - Engine::RealmSlot::error_shape == Engine::ErrorType::SuppressedError);
    ENGINE_CHECK_OFFSET(JSGlobalObject, m_rest, GlobalObject_slots + namedSlotCount * sizeof(JSCell*));
}

ALWAYS_INLINE VM& getVM(JSGlobalObject* globalObject) { return globalObject->vm(); }

template<uint16_t structureSlot, uint16_t constructorSlot>
Structure* RealmClass<structureSlot, constructorSlot>::get(const JSGlobalObject* global) const { return global->lazySlot<Structure>(structureSlot); }
template<uint16_t structureSlot, uint16_t constructorSlot>
JSObject* RealmClass<structureSlot, constructorSlot>::constructor(const JSGlobalObject* global) const { return global->lazySlot<JSObject>(constructorSlot); }

ALWAYS_INLINE Structure* LazyClassStructure::get(const JSGlobalObject* global) const { return m_structure.getInitializedOnMainThread(global); }

inline JSFinalObject* constructEmptyObject(JSGlobalObject* globalObject) { return JSFinalObject::create(globalObject->vm(), globalObject->objectStructureForObjectConstructor()); }

// In the class of a global object that asks another object first.
#define ENGINE_DECLARE_SANDBOX_METHODS                                                                                                                                                                                       \
    static constexpr unsigned StructureFlags = Engine::Layout::sandboxedGlobalObjectFlags;                                                                                                                                   \
    static bool put(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::JSValue, JSC::PutPropertySlot&) ENGINE_SYMBOL(engine_SandboxedGlobalObject_put);                                                             \
    static bool deleteProperty(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::DeletePropertySlot&) ENGINE_SYMBOL(engine_SandboxedGlobalObject_delete_property);                                                 \
    static bool getOwnPropertySlot(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&) ENGINE_SYMBOL(engine_SandboxedGlobalObject_get_own_property_slot);                                           \
    static bool getOwnPropertySlotByIndex(JSC::JSObject*, JSC::JSGlobalObject*, unsigned, JSC::PropertySlot&) ENGINE_SYMBOL(engine_SandboxedGlobalObject_get_own_property_slot_by_index);                                    \
    static void getOwnPropertyNames(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyNameArrayBuilder&, JSC::DontEnumPropertiesMode) ENGINE_SYMBOL(engine_SandboxedGlobalObject_own_property_names);                       \
    static bool defineOwnProperty(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, const JSC::PropertyDescriptor&, bool shouldThrow) ENGINE_SYMBOL(engine_SandboxedGlobalObject_define_own_property)

// What scripts see as `globalThis`.
class JSGlobalProxy final : public JSNonFinalObject {
public:
    ENGINE_DECLARE_CLASS(GlobalProxy)

    JSGlobalObject* target() const { return Engine::fieldAt<JSGlobalObject*>(this, Engine::Layout::GlobalProxy_target); }
};
ENGINE_CLASS_HAS_TYPE(JSGlobalProxy, GlobalProxyType);

} // namespace JSC
