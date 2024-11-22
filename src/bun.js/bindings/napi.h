#pragma once

#include "root.h"
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/VM.h>

#include "headers-handwritten.h"
#include "BunClientData.h"
#include <JavaScriptCore/CallFrame.h>
#include "js_native_api.h"
#include <JavaScriptCore/JSWeakValue.h>
#include "JSFFIFunction.h"
#include "ZigGlobalObject.h"
#include "napi_handle_scope.h"

namespace JSC {
class JSGlobalObject;
class JSSourceCode;
}

namespace Napi {
JSC::SourceCode generateSourceCode(WTF::String keyString, JSC::VM& vm, JSC::JSObject* object, JSC::JSGlobalObject* globalObject);
}

namespace Zig {

using namespace JSC;

static inline JSValue toJS(napi_value val)
{
    return JSC::JSValue::decode(reinterpret_cast<JSC::EncodedJSValue>(val));
}

static inline Zig::GlobalObject* toJS(napi_env val)
{
    return reinterpret_cast<Zig::GlobalObject*>(val);
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

static inline napi_env toNapi(JSC::JSGlobalObject* val)
{
    return reinterpret_cast<napi_env>(val);
}

class NapiFinalizer {
public:
    void* finalize_hint = nullptr;
    napi_finalize finalize_cb;

    void call(JSC::JSGlobalObject* globalObject, void* data);
};

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

    NapiRef(JSC::JSGlobalObject* global, uint32_t count)
    {
        globalObject = JSC::Weak<JSC::JSGlobalObject>(global);
        strongRef = {};
        weakValueRef.clear();
        refCount = count;
    }

    JSC::JSValue value() const
    {
        if (refCount == 0) {
            return weakValueRef.get();
        }

        return strongRef.get();
    }

    ~NapiRef()
    {
        strongRef.clear();
        // The weak ref can lead to calling the destructor
        // so we must first clear the weak ref before we call the finalizer
        weakValueRef.clear();
    }

    JSC::Weak<JSC::JSGlobalObject> globalObject;
    NapiWeakValue weakValueRef;
    JSC::Strong<JSC::Unknown> strongRef;
    NapiFinalizer finalizer;
    void* data = nullptr;
    uint32_t refCount = 0;
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

    JS_EXPORT_PRIVATE static NapiClass* create(VM&, Zig::GlobalObject*, const char* utf8name,
        size_t length,
        napi_callback constructor,
        void* data,
        size_t property_count,
        const napi_property_descriptor* properties);

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        ASSERT(globalObject);
        return Structure::create(vm, globalObject, prototype, TypeInfo(JSFunctionType, StructureFlags), info());
    }

    CFFIFunction constructor()
    {
        return m_constructor;
    }

    void* dataPtr = nullptr;
    CFFIFunction m_constructor = nullptr;
    NapiRef* napiRef = nullptr;

private:
    NapiClass(VM& vm, NativeExecutable* executable, JSC::JSGlobalObject* global, Structure* structure)
        : Base(vm, executable, global, structure)
    {
    }
    void finishCreation(VM&, NativeExecutable*, unsigned length, const String& name, napi_callback constructor,
        void* data,
        size_t property_count,
        const napi_property_descriptor* properties);

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
        auto& vm = this->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto* targetFunction = jsCast<JSFunction*>(newTarget);
        FunctionRareData* rareData = targetFunction->ensureRareData(vm);
        auto* prototype = newTarget->get(globalObject, vm.propertyNames->prototype).getObject();
        RETURN_IF_EXCEPTION(scope, nullptr);

        // This must be kept in-sync with InternalFunction::createSubclassStructure
        Structure* structure = rareData->internalFunctionAllocationStructure();
        if (UNLIKELY(!(structure && structure->classInfoForCells() == this->structure()->classInfoForCells() && structure->globalObject() == globalObject))) {
            structure = rareData->createInternalFunctionAllocationStructureFromBase(vm, globalObject, prototype, this->structure());
        }

        RETURN_IF_EXCEPTION(scope, nullptr);
        NapiPrototype* footprint = new (NotNull, allocateCell<NapiPrototype>(vm)) NapiPrototype(vm, structure);
        footprint->finishCreation(vm);
        RELEASE_AND_RETURN(scope, footprint);
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

Structure* createNAPIFunctionStructure(VM& vm, JSC::JSGlobalObject* globalObject);

}
