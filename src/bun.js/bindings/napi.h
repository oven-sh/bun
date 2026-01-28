#pragma once

#include "root.h"
#include <JavaScriptCore/DeferGC.h>
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

#include <optional>
#include <unordered_set>
#include <variant>

extern "C" void napi_internal_register_cleanup_zig(napi_env env);
extern "C" void napi_internal_suppress_crash_on_abort_if_desired();
extern "C" void Bun__crashHandler(const char* message, size_t message_len);

static bool equal(napi_async_cleanup_hook_handle, napi_async_cleanup_hook_handle);

namespace Napi {

static constexpr int DEFAULT_NAPI_VERSION = 10;

struct CleanupHook {
    void* data;
    size_t insertionCounter;

    CleanupHook(void* data, size_t insertionCounter)
        : data(data)
        , insertionCounter(insertionCounter)
    {
    }

    size_t hash() const
    {
        return std::hash<void*> {}(data);
    }
};

struct SyncCleanupHook : CleanupHook {
    void (*function)(void*);

    SyncCleanupHook(void (*function)(void*), void* data, size_t insertionCounter)
        : CleanupHook(data, insertionCounter)
        , function(function)
    {
    }

    bool operator==(const SyncCleanupHook& other) const
    {
        return this == &other || (function == other.function && data == other.data);
    }
};

struct AsyncCleanupHook : CleanupHook {
    napi_async_cleanup_hook function;
    napi_async_cleanup_hook_handle handle = nullptr;

    AsyncCleanupHook(napi_async_cleanup_hook function, napi_async_cleanup_hook_handle handle, void* data, size_t insertionCounter)
        : CleanupHook(data, insertionCounter)
        , function(function)
        , handle(handle)
    {
    }

    bool operator==(const AsyncCleanupHook& other) const
    {
        if (this == &other || (function == other.function && data == other.data)) {
            if (handle && other.handle) {
                return equal(handle, other.handle);
            }

            return !handle && !other.handle;
        }

        return false;
    }
};

struct EitherCleanupHook : std::variant<SyncCleanupHook, AsyncCleanupHook> {
    template<typename Self>
    auto& get(this Self& self)
    {
        using Hook = MatchConst<Self, CleanupHook>::type;

        if (auto* sync = std::get_if<SyncCleanupHook>(&self)) {
            return static_cast<Hook&>(*sync);
        }

        return static_cast<Hook&>(std::get<AsyncCleanupHook>(self));
    }

    struct Hash {
        static size_t operator()(const EitherCleanupHook& hook)
        {
            return hook.get().hash();
        }
    };

private:
    template<typename T, typename U>
    struct MatchConst {
        using type = U;
    };

    template<typename T, typename U>
    struct MatchConst<const T, U> {
        using type = const U;
    };
};

using HookSet = std::unordered_set<EitherCleanupHook, EitherCleanupHook::Hash>;

void defineProperty(napi_env env, JSC::JSObject* to, const napi_property_descriptor& property, bool isInstance, JSC::ThrowScope& scope);
}

struct napi_async_cleanup_hook_handle__ {
    napi_env env;
    Napi::HookSet::iterator iter;

    napi_async_cleanup_hook_handle__(napi_env env, decltype(iter) iter)
        : env(env)
        , iter(iter)
    {
    }

    bool operator==(const napi_async_cleanup_hook_handle__& other) const
    {
        return this == &other || (env == other.env && iter == other.iter);
    }
};

static bool equal(napi_async_cleanup_hook_handle one, napi_async_cleanup_hook_handle two)
{
    return one == two || *one == *two;
}

#define NAPI_ABORT(message)                                    \
    do {                                                       \
        napi_internal_suppress_crash_on_abort_if_desired();    \
        Bun__crashHandler(message "", sizeof(message "") - 1); \
    } while (0)

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
struct NapiEnv : public WTF::RefCounted<NapiEnv> {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(NapiEnv);

public:
    NapiEnv(Zig::GlobalObject* globalObject, const napi_module& napiModule)
        : m_globalObject(globalObject)
        , m_napiModule(napiModule)
        , m_vm(JSC::getVM(globalObject))
    {
        napi_internal_register_cleanup_zig(this);
    }

    static Ref<NapiEnv> create(Zig::GlobalObject* globalObject, const napi_module& napiModule)
    {
        return adoptRef(*new NapiEnv(globalObject, napiModule));
    }

    ~NapiEnv()
    {
        delete[] filename;
    }

    void cleanup()
    {
        while (!m_cleanupHooks.empty()) {
            drain();
        }

        // Defer GC during entire finalizer cleanup to prevent iterator invalidation.
        // This prevents any GC-triggered finalizer execution while m_finalizers is being iterated.
        JSC::DeferGCForAWhile deferGC(m_vm);

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
    /// This matches Node.js behavior which always crashes on duplicates.
    void addCleanupHook(void (*function)(void*), void* data)
    {
        // Always check for duplicates like Node.js CHECK_EQ
        // See: node/src/cleanup_queue-inl.h:24 (CHECK_EQ runs in all builds)
        for (const auto& hook : m_cleanupHooks) {
            if (auto* sync = std::get_if<Napi::SyncCleanupHook>(&hook)) {
                NAPI_RELEASE_ASSERT(function != sync->function || data != sync->data, "Attempted to add a duplicate NAPI environment cleanup hook");
            }
        }

        m_cleanupHooks.emplace(Napi::SyncCleanupHook(function, data, ++m_cleanupHookCounter));
    }

    void removeCleanupHook(void (*function)(void*), void* data)
    {
        for (auto iter = m_cleanupHooks.begin(), end = m_cleanupHooks.end(); iter != end; ++iter) {
            if (auto* sync = std::get_if<Napi::SyncCleanupHook>(&*iter)) {
                if (sync->function == function && sync->data == data) {
                    m_cleanupHooks.erase(iter);
                    return;
                }
            }
        }

        // Node.js silently ignores removal of non-existent hooks
        // See: node/src/cleanup_queue-inl.h:27-30
    }

    napi_async_cleanup_hook_handle addAsyncCleanupHook(napi_async_cleanup_hook function, void* data)
    {
        // Always check for duplicates like Node.js CHECK_EQ
        // Node.js async cleanup hooks also use the same CleanupQueue with CHECK_EQ
        for (const auto& hook : m_cleanupHooks) {
            if (auto* async = std::get_if<Napi::AsyncCleanupHook>(&hook)) {
                NAPI_RELEASE_ASSERT(function != async->function || data != async->data, "Attempted to add a duplicate async NAPI environment cleanup hook");
            }
        }

        auto handle = std::make_unique<napi_async_cleanup_hook_handle__>(this, m_cleanupHooks.end());

        auto [iter, inserted] = m_cleanupHooks.emplace(Napi::AsyncCleanupHook(function, handle.get(), data, ++m_cleanupHookCounter));
        NAPI_RELEASE_ASSERT(inserted, "Attempted to add a duplicate async NAPI environment cleanup hook");
        handle->iter = iter;
        return handle.release();
    }

    bool removeAsyncCleanupHook(napi_async_cleanup_hook_handle handle)
    {
        if (handle == nullptr) {
            return false; // Invalid handle
        }

        for (const auto& hook : m_cleanupHooks) {
            if (auto* async = std::get_if<Napi::AsyncCleanupHook>(&hook)) {
                if (async->handle == handle) {
                    m_cleanupHooks.erase(handle->iter);
                    delete handle;
                    return true;
                }
            }
        }

        // Node.js silently ignores removal of non-existent handles
        // See: node/src/node_api.cc:849-855
        return false;
    }

    bool inGC() const
    {
        return this->vm().isCollectorBusyOnCurrentThread();
    }

    void checkGC() const
    {
        // Only enforce GC checks for experimental NAPI versions, matching Node.js behavior
        // See: https://github.com/nodejs/node/blob/main/src/js_native_api_v8.h#L132-L143
        if (m_napiModule.nm_version == NAPI_VERSION_EXPERIMENTAL) {
            if (inGC()) {
                fprintf(stderr, "FATAL ERROR: Finalizer is calling a function that may affect GC state.\n");
                fprintf(stderr, "The finalizers are run directly from GC and must not affect GC state.\n");
                fprintf(stderr, "Use `node_api_post_finalizer` from inside of the finalizer to work around this issue.\n");
                fprintf(stderr, "It schedules the call as a new task in the event loop.\n");
                fflush(stderr);
                NAPI_ABORT("napi_reference_unref");
            }
        }
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
            throwPendingException();
        }
    }

    void scheduleException(JSC::JSValue exception)
    {
        if (exception.isEmpty()) {
            m_pendingException.clear();
        }

        m_pendingException.set(m_vm, exception);
    }

    bool throwPendingException()
    {
        if (!m_pendingException) {
            return false;
        }

        auto scope = DECLARE_THROW_SCOPE(m_vm);
        JSC::throwException(globalObject(), scope, m_pendingException.get());
        m_pendingException.clear();
        return true;
    }

    void clearPendingException()
    {
        m_pendingException.clear();
    }

    bool hasPendingException() const
    {
        return static_cast<bool>(m_pendingException);
    }

    inline Zig::GlobalObject* globalObject() const { return m_globalObject; }
    inline const napi_module& napiModule() const { return m_napiModule; }
    inline JSC::VM& vm() const { return m_vm; }
    inline std::optional<JSC::JSValue> pendingException() const
    {
        if (!m_pendingException) {
            return std::nullopt;
        }
        return m_pendingException.get();
    }

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

        void deactivate(NapiEnv& env) const
        {
            if (env.isFinishingFinalizers()) {
                active = false;
            } else {
                env.removeFinalizer(*this);
                // At this point the BoundFinalizer has been destroyed, but because we're not doing anything else here it's safe.
                // https://isocpp.org/wiki/faq/freestore-mgmt#delete-this
            }
        }

        bool operator==(const BoundFinalizer& other) const
        {
            return this == &other || (callback == other.callback && hint == other.hint && data == other.data);
        }

        struct Hash {
            std::size_t operator()(const NapiEnv::BoundFinalizer& bound) const
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
    Napi::HookSet m_cleanupHooks;
    JSC::Strong<JSC::Unknown> m_pendingException;
    size_t m_cleanupHookCounter = 0;

    // Returns a vector of hooks in reverse order of insertion.
    std::vector<Napi::EitherCleanupHook> getHooks() const
    {
        std::vector<Napi::EitherCleanupHook> hooks(m_cleanupHooks.begin(), m_cleanupHooks.end());
        std::sort(hooks.begin(), hooks.end(), [](const Napi::EitherCleanupHook& left, const Napi::EitherCleanupHook& right) {
            return left.get().insertionCounter > right.get().insertionCounter;
        });
        return hooks;
    }

    void drain()
    {
        std::vector<Napi::EitherCleanupHook> hooks = getHooks();

        for (const Napi::EitherCleanupHook& hook : hooks) {
            if (auto set_iter = m_cleanupHooks.find(hook); set_iter != m_cleanupHooks.end()) {
                m_cleanupHooks.erase(set_iter);
            } else {
                // Already removed during removal of a different cleanup hook
                continue;
            }

            if (auto* sync = std::get_if<Napi::SyncCleanupHook>(&hook)) {
                ASSERT(sync->function != nullptr);
                sync->function(sync->data);
            } else {
                auto& async = std::get<Napi::AsyncCleanupHook>(hook);
                ASSERT(async.function != nullptr);
                async.function(async.handle, async.data);
                delete async.handle;
            }
        }
    }
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

// If a module registered itself by calling napi_module_register in a static constructor, run this
// to run the module's entrypoint.
void executePendingNapiModule(Zig::GlobalObject* globalObject);

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
            return m_value.cell.get();
        case WeakTypeTag::String:
            return m_value.string.get();
        default:
            return {};
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

    NapiRef(Ref<NapiEnv>&& env, uint32_t count, Bun::NapiFinalizer finalizer)
        : env(env)
        , globalObject(JSC::Weak<JSC::JSGlobalObject>(env->globalObject()))
        , finalizer(WTF::move(finalizer))
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
        saved_finalizer.call(env.ptr(), nativeObject, !env->mustDeferFinalizers() || !env->inGC());
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

    WTF::Ref<NapiEnv> env;
    JSC::Weak<JSC::JSGlobalObject> globalObject;
    NapiWeakValue weakValueRef;
    JSC::Strong<JSC::Unknown> strongRef;
    Bun::NapiFinalizer finalizer;
    const NapiEnv::BoundFinalizer* boundCleanup = nullptr;
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
