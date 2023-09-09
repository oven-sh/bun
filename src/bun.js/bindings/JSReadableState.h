#pragma once

#include "root.h"
#include "BufferEncodingType.h"

namespace WebCore {
using namespace JSC;

class JSReadableState : public JSC::JSDestructibleObject {
    using Base = JSC::JSDestructibleObject;

public:
    JSReadableState(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
        , m_paused(0)
    {
    }

    DECLARE_VISIT_CHILDREN;
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

    enum Mask : uint32_t {
        objectMode = 1 << 0,
        emitClose = 1 << 1,
        autoDestroy = 1 << 2,
        ended = 1 << 3,
        endEmitted = 1 << 4,
        reading = 1 << 5,
        constructed = 1 << 6,
        sync = 1 << 7,
        needReadable = 1 << 8,
        emittedReadable = 1 << 9,
        readableListening = 1 << 10,
        resumeScheduled = 1 << 11,
        errorEmitted = 1 << 12,
        destroyed = 1 << 13,
        closed = 1 << 14,
        closeEmitted = 1 << 15,
        multiAwaitDrain = 1 << 16,
        readingMore = 1 << 17,
        dataEmitted = 1 << 18,
    };

    constexpr bool getBool(Mask mask) { return m_bools.contains(mask); }
    constexpr void setBool(Mask mask, bool val)
    {
        m_bools.set(mask, val);
    }

    // 0 for null, 1 for true, -1 for false
    int8_t m_paused = 0;
    int8_t m_flowing = 0;

    WTF::OptionSet<Mask> m_bools;

    int64_t m_length = 0;
    int64_t m_highWaterMark;

    mutable WriteBarrier<Unknown> m_buffer;
    mutable WriteBarrier<Unknown> m_pipes;
    mutable WriteBarrier<Unknown> m_errored;
    mutable WriteBarrier<Unknown> m_defaultEncoding;
    mutable WriteBarrier<Unknown> m_awaitDrainWriters;
    mutable WriteBarrier<Unknown> m_decoder;
    mutable WriteBarrier<Unknown> m_encoding;
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
