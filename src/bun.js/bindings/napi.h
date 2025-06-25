#pragma once

#include "root.h"
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/VM.h>

#include "headers-handwritten.h"
#include "BunClientData.h"
#include <JavaScriptCore/CallFrame.h>
#include "node_api.h"
#include <JavaScriptCore/JSWeakValue.h>
#include "JSFFIFunction.h"
#include "ZigGlobalObject.h"
#include "napi_handle_scope.h"
#include "napi_finalizer.h"
#include "wtf/Assertions.h"
#include "napi_macros.h"

#include <list>
#include <unordered_set>

extern "C" void napi_internal_register_cleanup_zig(napi_env env);
extern "C" void napi_internal_crash_in_gc(napi_env);
extern "C" void Bun__crashHandler(const char* message, size_t message_len);

namespace Napi {
struct AsyncCleanupHook {
    napi_async_cleanup_hook function = nullptr;
    void* data = nullptr;
    napi_async_cleanup_hook_handle handle = nullptr;
};

void defineProperty(napi_env env, JSC::JSObject* to, const napi_property_descriptor& property, bool isInstance, JSC::ThrowScope& scope);
}

struct napi_async_cleanup_hook_handle__ {
    napi_env env;
    std::list<Napi::AsyncCleanupHook>::iterator iter;

    napi_async_cleanup_hook_handle__(napi_env env, decltype(iter) iter)
        : env(env)
        , iter(iter)
    {
    }
};

#define NAPI_ABORT(message) Bun__crashHandler(message "", sizeof(message "") - 1)

#define NAPI_PERISH(...)                                                      \
    do {                                                                      \
        WTFReportError(__FILE__, __LINE__, __PRETTY_FUNCTION__, __VA_ARGS__); \
        WTFReportBacktrace();                                                 \
        NAPI_ABORT("Aborted");                                                \
    } while (0)

#define NAPI_RELEASE_ASSERT(assertion, ...)                                                                         \
    do {                                                                                                            \
        if (!(assertion)) [[unlikely]] {                                                                            \
            WTFReportAssertionFailureWithMessage(__FILE__, __LINE__, __PRETTY_FUNCTION__, #assertion, __VA_ARGS__); \
            WTFReportBacktrace();                                                                                   \
            NAPI_ABORT("Aborted");                                                                                  \
        }                                                                                                           \
    } while (0)

// Named this way so we can manipulate napi_env values directly (since napi_env is defined as a pointer to struct napi_env__)
struct napi_env__ {
public:
    napi_env__(Zig::GlobalObject* globalObject, const napi_module& napiModule)
        : m_globalObject(globalObject)
        , m_napiModule(napiModule)
        , m_vm(JSC::getVM(globalObject))
    {
        napi_internal_register_cleanup_zig(this);
    }

    ~napi_env__()
    {
        delete[] filename;
    }

    void cleanup()
    {
        while (!m_cleanupHooks.empty()) {
            auto [function, data] = m_cleanupHooks.back();
            m_cleanupHooks.pop_back();
            ASSERT(function != nullptr);
            function(data);
        }

        while (!m_asyncCleanupHooks.empty()) {
            auto [function, data, handle] = m_asyncCleanupHooks.back();
            ASSERT(function != nullptr);
            function(handle, data);
            delete handle;
            m_asyncCleanupHooks.pop_back();
        }

        m_isFinishingFinalizers = true;
        for (const BoundFinalizer& boundFinalizer : m_finalizers) {
            Bun::NapiHandleScope handle_scope(m_globalObject);
            boundFinalizer.call(this);
        }
        m_finalizers.clear();
        m_isFinishingFinalizers = false;

        instanceDataFinalizer.call(this, instanceData, true);
        instanceDataFinalizer.clear();
    }

    void removeFinalizer(napi_finalize callback, void* hint, void* data)
    {
        m_finalizers.erase({ callback, hint, data });
    }

    struct BoundFinalizer;

    void removeFinalizer(const BoundFinalizer& finalizer)
    {
        m_finalizers.erase(finalizer);
    }

    const auto& addFinalizer(napi_finalize callback, void* hint, void* data)
    {
        return *m_finalizers.emplace(callback, hint, data).first;
    }

    bool hasFinalizers() const
    {
        return !m_finalizers.empty();
    }

    /// Will abort the process if a duplicate entry would be added.
    void addCleanupHook(void (*function)(void*), void* data)
    {
        for (const auto& [existing_function, existing_data] : m_cleanupHooks) {
            NAPI_RELEASE_ASSERT(function != existing_function || data != existing_data, "Attempted to add a duplicate NAPI environment cleanup hook");
        }

        m_cleanupHooks.emplace_back(function, data);
    }

    void removeCleanupHook(void (*function)(void*), void* data)
    {
        for (auto iter = m_cleanupHooks.begin(), end = m_cleanupHooks.end(); iter != end; ++iter) {
            if (iter->first == function && iter->second == data) {
                m_cleanupHooks.erase(iter);
                return;
            }
        }

        NAPI_PERISH("Attempted to remove a NAPI environment cleanup hook that had never been added");
    }

    napi_async_cleanup_hook_handle addAsyncCleanupHook(napi_async_cleanup_hook function, void* data)
    {
        for (const auto& [existing_function, existing_data, existing_handle] : m_asyncCleanupHooks) {
            NAPI_RELEASE_ASSERT(function != existing_function || data != existing_data, "Attempted to add a duplicate async NAPI environment cleanup hook");
        }

        auto iter = m_asyncCleanupHooks.emplace(m_asyncCleanupHooks.end(), function, data);
        iter->handle = new napi_async_cleanup_hook_handle__(this, iter);
        return iter->handle;
    }

    void removeAsyncCleanupHook(napi_async_cleanup_hook_handle handle)
    {
        for (const auto& [existing_function, existing_data, existing_handle] : m_asyncCleanupHooks) {
            if (existing_handle == handle) {
                m_asyncCleanupHooks.erase(handle->iter);
                delete handle;
                return;
            }
        }

        NAPI_PERISH("Attempted to remove an async NAPI environment cleanup hook that had never been added");
    }

    bool inGC() const
    {
        return this->vm().isCollectorBusyOnCurrentThread();
    }

    void checkGC() const
    {
        NAPI_RELEASE_ASSERT(!inGC(),
            "Attempted to call a non-GC-safe function inside a NAPI finalizer from a NAPI module with version %d.\n"
            "Finalizers must not create new objects during garbage collection. Use the `node_api_post_finalizer` function\n"
            "inside the finalizer to defer the code to the next event loop tick.\n",
            m_napiModule.nm_version);
    }

    bool isVMTerminating() const
    {
        return this->vm().hasTerminationRequest();
    }

    void doFinalizer(napi_finalize finalize_cb, void* data, void* finalize_hint)
    {
        if (!finalize_cb) {
            return;
        }

        if (mustDeferFinalizers() && inGC()) {
            napi_internal_enqueue_finalizer(this, finalize_cb, data, finalize_hint);
        } else {
            finalize_cb(this, data, finalize_hint);
        }
    }

    inline Zig::GlobalObject* globalObject() const { return m_globalObject; }
    inline const napi_module& napiModule() const { return m_napiModule; }
    inline JSC::VM& vm() const { return m_vm; }

    // Returns true if finalizers from this module need to be scheduled for the next tick after garbage collection, instead of running during garbage collection
    inline bool mustDeferFinalizers() const
    {
        // Even when we'd normally have to defer the finalizer, if this is happening during the VM's last chance to finalize,
        // we can't defer the finalizer and have to call it now.
        return m_napiModule.nm_version != NAPI_VERSION_EXPERIMENTAL && !isVMTerminating();
    }

    inline bool isFinishingFinalizers() const { return m_isFinishingFinalizers; }

    // Almost all NAPI functions should set error_code to the status they're returning right before
    // they return it
    napi_extended_error_info m_lastNapiErrorInfo = {
        .error_message = "",
        // Not currently used by Bun -- always nullptr
        .engine_reserved = nullptr,
        // Not currently used by Bun -- always zero
        .engine_error_code = 0,
        .error_code = napi_ok,
    };

    void* instanceData = nullptr;
    Bun::NapiFinalizer instanceDataFinalizer;
    char* filename = nullptr;

    struct BoundFinalizer {
        napi_finalize callback = nullptr;
        void* hint = nullptr;
        void* data = nullptr;
        // Allows bound finalizers to effectively remove themselves during cleanup without breaking iteration.
        // Safe to be mutable because it's not included in the hash.
        mutable bool active = true;

        BoundFinalizer() = default;

        BoundFinalizer(const Bun::NapiFinalizer& finalizer, void* data)
            : callback(finalizer.callback())
            , hint(finalizer.hint())
            , data(data)
        {
        }

        BoundFinalizer(napi_finalize callback, void* hint, void* data)
            : callback(callback)
            , hint(hint)
            , data(data)
        {
        }

        void call(napi_env env) const
        {
            if (callback && active) {
                callback(env, data, hint);
            }
        }

        void deactivate(napi_env env) const
        {
            if (env->isFinishingFinalizers()) {
                active = false;
            } else {
                env->removeFinalizer(*this);
                // At this point the BoundFinalizer has been destroyed, but because we're not doing anything else here it's safe.
                // https://isocpp.org/wiki/faq/freestore-mgmt#delete-this
            }
        }

        bool operator==(const BoundFinalizer& other) const
        {
            return this == &other || (callback == other.callback && hint == other.hint && data == other.data);
        }

        struct Hash {
            std::size_t operator()(const napi_env__::BoundFinalizer& bound) const
            {
                constexpr std::hash<void*> hasher;
                constexpr std::ptrdiff_t magic = 0x9e3779b9;
                return (hasher(reinterpret_cast<void*>(bound.callback)) + magic) ^ (hasher(bound.hint) + magic) ^ (hasher(bound.data) + magic);
            }
        };
    };

private:
    Zig::GlobalObject* m_globalObject = nullptr;
    napi_module m_napiModule;
    // TODO(@heimskr): Use WTF::HashSet
    std::unordered_set<BoundFinalizer, BoundFinalizer::Hash> m_finalizers;
    bool m_isFinishingFinalizers = false;
    JSC::VM& m_vm;
    std::list<std::pair<void (*)(void*), void*>> m_cleanupHooks;
    std::list<Napi::AsyncCleanupHook> m_asyncCleanupHooks;
};

extern "C" void napi_internal_cleanup_env_cpp(napi_env);
extern "C" void napi_internal_remove_finalizer(napi_env, napi_finalize callback, void* hint, void* data);

namespace JSC {
class JSGlobalObject;
class JSSourceCode;
}

namespace Napi {
JSC::SourceCode generateSourceCode(WTF::String keyString, JSC::VM& vm, JSC::JSObject* object, JSC::JSGlobalObject* globalObject);

class NapiRefWeakHandleOwner final : public JSC::WeakHandleOwner {
public:
    // Equivalent to v8impl::Ownership::kUserland
    void finalize(JSC::Handle<JSC::Unknown>, void* context) final;

    static NapiRefWeakHandleOwner& weakValueHandleOwner()
    {
        static NeverDestroyed<NapiRefWeakHandleOwner> jscWeakValueHandleOwner;
        return jscWeakValueHandleOwner;
    }
};

class NapiRefSelfDeletingWeakHandleOwner final : public JSC::WeakHandleOwner {
public:
    // Equivalent to v8impl::Ownership::kRuntime
    void finalize(JSC::Handle<JSC::Unknown>, void* context) final;

    static NapiRefSelfDeletingWeakHandleOwner& weakValueHandleOwner()
    {
        static NeverDestroyed<NapiRefSelfDeletingWeakHandleOwner> jscWeakValueHandleOwner;
        return jscWeakValueHandleOwner;
    }
};
}

namespace Zig {
using namespace JSC;

static inline JSValue toJS(napi_value val)
{
    return JSC::JSValue::decode(reinterpret_cast<JSC::EncodedJSValue>(val));
}

static inline Zig::GlobalObject* toJS(napi_env val)
{
    return val->globalObject();
}

static inline napi_value toNapi(JSC::JSValue val, Zig::GlobalObject* globalObject)
{
    if (val.isCell()) {
        if (auto* scope = globalObject->m_currentNapiHandleScopeImpl.get()) {
            scope->append(val);
        }
    }
    return reinterpret_cast<napi_value>(JSC::JSValue::encode(val));
}

// This is essentially JSC::JSWeakValue, except with a JSCell* instead of a
// JSObject*. Sometimes, a napi embedder might want to store a JSC::Exception, a
// JSC::HeapBigInt, JSC::Symbol, etc inside of a NapiRef. So we can't limit it
// to just JSObject*. It has to be JSCell*. It's not clear that we benefit from
// not simply making this JSC::Unknown.
class NapiWeakValue {
public:
    NapiWeakValue() = default;
    ~NapiWeakValue();

    void clear();
    bool isClear() const;

    bool isSet() const { return m_tag != WeakTypeTag::NotSet; }
    bool isPrimitive() const { return m_tag == WeakTypeTag::Primitive; }
    bool isCell() const { return m_tag == WeakTypeTag::Cell; }
    bool isString() const { return m_tag == WeakTypeTag::String; }

    void setPrimitive(JSValue);
    void setCell(JSCell*, WeakHandleOwner&, void* context);
    void setString(JSString*, WeakHandleOwner&, void* context);
    void set(JSValue, WeakHandleOwner&, void* context);

    JSValue get() const
    {
        switch (m_tag) {
        case WeakTypeTag::Primitive:
            return m_value.primitive;
        case WeakTypeTag::Cell:
            return JSC::JSValue(m_value.cell.get());
        case WeakTypeTag::String:
            return JSC::JSValue(m_value.string.get());
        default:
            return JSC::JSValue();
        }
    }

    JSCell* cell() const
    {
        ASSERT(isCell());
        return m_value.cell.get();
    }

    JSValue primitive() const
    {
        ASSERT(isPrimitive());
        return m_value.primitive;
    }

    JSString* string() const
    {
        ASSERT(isString());
        return m_value.string.get();
    }

private:
    enum class WeakTypeTag { NotSet,
        Primitive,
        Cell,
        String };

    WeakTypeTag m_tag { WeakTypeTag::NotSet };

    union WeakValueUnion {
        WeakValueUnion()
            : primitive(JSValue())
        {
        }

        ~WeakValueUnion()
        {
            ASSERT(!primitive);
        }

        JSValue primitive;
        JSC::Weak<JSCell> cell;
        JSC::Weak<JSString> string;
    } m_value;
};

class NapiRef {
    WTF_MAKE_TZONE_ALLOCATED(NapiRef);

public:
    void ref();
    void unref();
    void clear();

    NapiRef(napi_env env, uint32_t count, Bun::NapiFinalizer finalizer)
        : env(env)
        , globalObject(JSC::Weak<JSC::JSGlobalObject>(env->globalObject()))
        , finalizer(WTFMove(finalizer))
        , refCount(count)
    {
    }

    JSC::JSValue value() const
    {
        if (refCount == 0 && !m_isEternal) {
            return weakValueRef.get();
        }

        return strongRef.get();
    }

    void setValueInitial(JSC::JSValue value, bool can_be_weak)
    {
        if (refCount > 0) {
            strongRef.set(globalObject->vm(), value);
        }

        // In NAPI non-experimental, types other than object, function and symbol can't be used as values for references.
        // In NAPI experimental, they can be, but we must not store weak references to them.
        if (can_be_weak) {
            weakValueRef.set(value, Napi::NapiRefWeakHandleOwner::weakValueHandleOwner(), this);
        }

        if (value.isSymbol()) {
            auto* symbol = jsDynamicCast<JSC::Symbol*>(value);
            ASSERT(symbol != nullptr);
            if (symbol->uid().isRegistered()) {
                // Global symbols must always be retrievable,
                // even if garbage collection happens while the ref count is 0.
                m_isEternal = true;
                if (refCount == 0) {
                    strongRef.set(globalObject->vm(), symbol);
                }
            }
        }
    }

    void callFinalizer()
    {
        // Calling the finalizer may delete `this`, so we have to do state changes on `this` before
        // calling the finalizer
        Bun::NapiFinalizer saved_finalizer = this->finalizer;
        this->finalizer.clear();
        saved_finalizer.call(env, nativeObject, !env->mustDeferFinalizers() || !env->inGC());
    }

    ~NapiRef()
    {
        NAPI_LOG("destruct napi ref %p", this);
        if (boundCleanup) {
            boundCleanup->deactivate(env);
            boundCleanup = nullptr;
        }

        if (!m_isEternal) {
            strongRef.clear();
        }

        // The weak ref can lead to calling the destructor
        // so we must first clear the weak ref before we call the finalizer
        weakValueRef.clear();
    }

    napi_env env = nullptr;
    JSC::Weak<JSC::JSGlobalObject> globalObject;
    NapiWeakValue weakValueRef;
    JSC::Strong<JSC::Unknown> strongRef;
    Bun::NapiFinalizer finalizer;
    const napi_env__::BoundFinalizer* boundCleanup = nullptr;
    void* nativeObject = nullptr;
    uint32_t refCount = 0;
    bool releaseOnWeaken = false;

private:
    bool m_isEternal = false;
};

static inline napi_ref toNapi(NapiRef* val)
{
    return reinterpret_cast<napi_ref>(val);
}

class NapiClass final : public JSC::JSFunction {
public:
    using Base = JSFunction;

    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = DoesNotNeedDestruction;
    static void destroy(JSCell* cell)
    {
        static_cast<NapiClass*>(cell)->NapiClass::~NapiClass();
    }

    template<typename, SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<NapiClass, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForNapiClass.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNapiClass = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForNapiClass.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForNapiClass = std::forward<decltype(space)>(space); });
    }

    DECLARE_EXPORT_INFO;

    JS_EXPORT_PRIVATE static NapiClass* create(VM&, napi_env, WTF::String name,
        napi_callback constructor,
        void* data,
        size_t property_count,
        const napi_property_descriptor* properties);

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        ASSERT(globalObject);
        return Structure::create(vm, globalObject, prototype, TypeInfo(JSFunctionType, StructureFlags), info());
    }

    inline napi_callback constructor() const { return m_constructor; }
    inline void*& dataPtr() { return m_dataPtr; }
    inline void* const& dataPtr() const { return m_dataPtr; }
    inline napi_env env() const { return m_env; }

private:
    NapiClass(VM& vm, NativeExecutable* executable, napi_env env, Structure* structure, void* data)
        : Base(vm, executable, env->globalObject(), structure)
        , m_dataPtr(data)
        , m_env(env)
    {
    }

    void finishCreation(VM&, NativeExecutable*, const String& name, napi_callback constructor,
        void* data,
        size_t property_count,
        const napi_property_descriptor* properties);

    void* m_dataPtr = nullptr;
    napi_callback m_constructor = nullptr;
    napi_env m_env = nullptr;

    DECLARE_VISIT_CHILDREN;
};

class NapiPrototype : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;

    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;

    template<typename CellType, SubspaceAccess>
    static CompleteSubspace* subspaceFor(VM& vm)
    {
        return &vm.destructibleObjectSpace();
    }

    DECLARE_INFO;

    static NapiPrototype* create(VM& vm, Structure* structure)
    {
        NapiPrototype* footprint = new (NotNull, allocateCell<NapiPrototype>(vm)) NapiPrototype(vm, structure);
        footprint->finishCreation(vm);
        return footprint;
    }

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        ASSERT(globalObject);
        return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
    }

    NapiPrototype* subclass(JSC::JSGlobalObject* globalObject, JSC::JSObject* newTarget)
    {
        VM& vm = globalObject->vm();
        Structure* structure = JSC::InternalFunction::createSubclassStructure(globalObject, newTarget, this->structure());
        if (!structure) {
            return nullptr;
        }
        return NapiPrototype::create(vm, structure);
    }

    NapiRef* napiRef = nullptr;

private:
    NapiPrototype(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }
};

static inline NapiRef* toJS(napi_ref val)
{
    return reinterpret_cast<NapiRef*>(val);
}

extern "C" napi_status napi_set_last_error(napi_env env, napi_status status);
class NAPICallFrame {
public:
    NAPICallFrame(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame, void* dataPtr, JSValue storedNewTarget)
        : NAPICallFrame(globalObject, callFrame, dataPtr)
    {
        m_storedNewTarget = storedNewTarget;
        m_isConstructorCall = !m_storedNewTarget.isEmpty();
    }

    NAPICallFrame(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame, void* dataPtr)
        : m_callFrame(callFrame)
        , m_dataPtr(dataPtr)
    {
        // Node-API function calls always run in "sloppy mode," even if the JS side is in strict
        // mode. So if `this` is null or undefined, we use globalThis instead; otherwise, we convert
        // `this` to an object.
        // TODO change to global? or find another way to avoid JSGlobalProxy
        JSC::JSObject* jscThis = globalObject->globalThis();
        if (!m_callFrame->thisValue().isUndefinedOrNull()) {
            auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
            jscThis = m_callFrame->thisValue().toObject(globalObject);
            // https://tc39.es/ecma262/#sec-toobject
            // toObject only throws for undefined and null, which we checked for
            scope.assertNoException();
        }
        m_callFrame->setThisValue(jscThis);
    }

    JSValue thisValue() const
    {
        return m_callFrame->thisValue();
    }

    napi_callback_info toNapi()
    {
        return reinterpret_cast<napi_callback_info>(this);
    }

    ALWAYS_INLINE void* dataPtr() const
    {
        return m_dataPtr;
    }

    void extract(size_t* argc, // [in-out] Specifies the size of the provided argv array
                               // and receives the actual count of args.
        napi_value* argv, // [out] Array of values
        napi_value* this_arg, // [out] Receives the JS 'this' arg for the call
        void** data, Zig::GlobalObject* globalObject);

    JSValue newTarget()
    {
        if (!m_isConstructorCall) {
            return JSValue();
        }

        if (m_storedNewTarget.isUndefined()) {
            // napi_get_new_target:
            // "This API returns the new.target of the constructor call. If the current callback
            // is not a constructor call, the result is NULL."
            // they mean a null pointer, not JavaScript null
            return JSValue();
        } else {
            return m_storedNewTarget;
        }
    }

private:
    JSC::CallFrame* m_callFrame;
    void* m_dataPtr;
    JSValue m_storedNewTarget;
    bool m_isConstructorCall = false;
};

}
