#pragma once

#include "root.h"
#include "BufferEncodingType.h"

namespace WebCore {
using namespace JSC;

class JSReadableState : public JSC::JSDestructibleObject {
    using Base = JSC::JSDestructibleObject;

public:
    JSReadableState(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure), m_paused(0)
    {
    }

    DECLARE_INFO;

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }

    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject,
        JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype,
            JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSReadableState* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, bool isDuplex, JSObject* options)
    {
        JSReadableState* accessor = new (NotNull, JSC::allocateCell<JSReadableState>(vm)) JSReadableState(vm, structure);
        accessor->finishCreation(vm, globalObject, isDuplex, options);
        return accessor;
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, bool isDuplex, JSObject* options);
    static void destroy(JSCell*) {}

    // 0 for null, 1 for true, -1 for false
    int8_t m_paused = 0;
    int8_t m_flowing = 0;
    // These 3 are initialized from options
    bool m_objectMode;
    bool m_emitClose;
    bool m_autoDestroy;
    bool m_ended = false;
    bool m_endEmitted = false;
    bool m_reading = false;
    bool m_constructed = true;
    bool m_sync = true;
    bool m_needReadable = false;
    bool m_emittedReadable = false;
    bool m_readableListening = false;
    bool m_resumeScheduled = false;
    bool m_errorEmitted = false;
    bool m_destroyed = false;
    bool m_closed = false;
    bool m_closeEmitted = false;
    bool m_multiAwaitDrain = false;
    bool m_readingMore = false;
    bool m_dataEmitted = false;

    int64_t m_length = 0;
    int64_t m_highWaterMark;
};

class JSReadableStatePrototype : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSReadableStatePrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSReadableStatePrototype* ptr = new (NotNull, JSC::allocateCell<JSReadableStatePrototype>(vm)) JSReadableStatePrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSReadableStatePrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

class JSReadableStateConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static JSReadableStateConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSReadableStatePrototype* prototype);

    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr bool needsDestruction = false;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    void initializeProperties(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSReadableStatePrototype* prototype);

    // Must be defined for each specialization class.
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
    DECLARE_EXPORT_INFO;

private:
    JSReadableStateConstructor(JSC::VM& vm, JSC::Structure* structure, JSC::NativeFunction nativeFunction)
        : Base(vm, structure, nativeFunction, nativeFunction)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject* globalObject, JSReadableStatePrototype* prototype);
};

}
