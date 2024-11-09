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

#include <unordered_set>

extern "C" void napi_internal_register_cleanup_zig(napi_env env);
extern "C" void napi_internal_crash_in_gc(napi_env);

struct napi_env__ {
public:
    napi_env__(Zig::GlobalObject* globalObject, const napi_module& napiModule)
        : m_globalObject(globalObject)
        , m_napiModule(napiModule)
    {
        napi_internal_register_cleanup_zig(this);
    }

    ~napi_env__()
    {
        delete[] filename;
    }

    void cleanup()
    {
        for (const BoundFinalizer& boundFinalizer : m_finalizers) {
            Bun::NapiHandleScope handle_scope(m_globalObject);
            if (boundFinalizer.callback) {
                boundFinalizer.callback(this, boundFinalizer.hint, boundFinalizer.data);
            }
        }

        m_finalizers.clear();
    }

    void removeFinalizer(napi_finalize callback, void* hint, void* data)
    {
        m_finalizers.erase({ callback, hint, data });
    }

    void addFinalizer(napi_finalize callback, void* hint, void* data)
    {
        m_finalizers.emplace(callback, hint, data);
    }

    void checkGC()
    {
        if (UNLIKELY(!mustAlwaysDefer() && m_globalObject->vm().heap.mutatorState() == JSC::MutatorState::Sweeping)) {
            RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE(
                "Attempted to call a non-GC-safe function inside a NAPI finalizer from a NAPI module with version %d.\n"
                "Finalizers must not create new objects during garbage collection. Use the `node_api_post_finalizer` function\n"
                "inside the finalizer to defer the code to the next event loop tick.\n",
                m_napiModule.nm_version);
        }
    }

    void doFinalizer(napi_finalize finalize_cb, void* data, void* finalize_hint)
    {
        if (!finalize_cb) {
            return;
        }

        if (mustAlwaysDefer()) {
            napi_internal_enqueue_finalizer(this, finalize_cb, data, finalize_hint);
        } else {
            finalize_cb(this, data, finalize_hint);
        }
    }

    inline Zig::GlobalObject* globalObject() const { return m_globalObject; }
    inline const napi_module& napiModule() const { return m_napiModule; }

    inline bool mustAlwaysDefer() const { return m_napiModule.nm_version <= 8; }

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
    WTF::RefPtr<Bun::NapiFinalizer> instanceDataFinalizer;
    char* filename = nullptr;

private:
    struct BoundFinalizer {
        napi_finalize callback = nullptr;
        void* hint = nullptr;
        void* data = nullptr;

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

    Zig::GlobalObject* m_globalObject = nullptr;
    napi_module m_napiModule;
    // TODO(@heimskr): Use WTF::HashSet
    std::unordered_set<BoundFinalizer, BoundFinalizer::Hash> m_finalizers;
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
    WTF_MAKE_ISO_ALLOCATED(NapiRef);

public:
    void ref();
    void unref();
    void clear();

    NapiRef(napi_env env, uint32_t count, WTF::RefPtr<Bun::NapiFinalizer> finalizer, bool defer)
        : env(env)
        , globalObject(JSC::Weak<JSC::JSGlobalObject>(env->globalObject()))
        , finalizer(std::move(finalizer))
        , refCount(count)
        , defer(defer)
    {
    }

    JSC::JSValue value() const
    {
        if (isEternal) {
            return eternalGlobalSymbolRef.get();
        }

        if (refCount == 0) {
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
                eternalGlobalSymbolRef.set(globalObject->vm(), symbol);
                isEternal = true;
            }
        }
    }

    void handleFinalizer()
    {
        if (finalizer) {
            if (defer) {
                napi_internal_enqueue_finalizer(env, finalizer->callback(), data, finalizer->hint());
            } else {
                finalizer->call(env, data, true);
            }
        }
    }

    ~NapiRef()
    {
        strongRef.clear();
        // The weak ref can lead to calling the destructor
        // so we must first clear the weak ref before we call the finalizer
        weakValueRef.clear();
    }

    napi_env env = nullptr;
    JSC::Weak<JSC::JSGlobalObject> globalObject;
    NapiWeakValue weakValueRef;
    JSC::Strong<JSC::Unknown> strongRef;
    WTF::RefPtr<Bun::NapiFinalizer> finalizer;
    void* data = nullptr;
    uint32_t refCount = 0;
    bool isOwnedByRuntime = false;
    bool defer = false;
    bool releaseOnWeaken = false;

private:
    JSC::Strong<JSC::Symbol> eternalGlobalSymbolRef;
    bool isEternal = false;
};

static inline napi_ref toNapi(NapiRef* val)
{
    return reinterpret_cast<napi_ref>(val);
}

class NapiClass final : public JSC::JSFunction {
public:
    using Base = JSFunction;

    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr bool needsDestruction = false;
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
    static constexpr bool needsDestruction = true;

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

}
