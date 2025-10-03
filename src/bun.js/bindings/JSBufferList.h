#pragma once

#include "root.h"
#include <wtf/Deque.h>
#include "ZigGlobalObject.h"

namespace WebCore {
using namespace JSC;

class JSBufferList : public JSC::JSNonFinalObject {
    using Base = JSC::JSNonFinalObject;

public:
    JSBufferList(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
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

    static JSBufferList* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSBufferList* accessor = new (NotNull, JSC::allocateCell<JSBufferList>(vm)) JSBufferList(vm, structure);
        accessor->finishCreation(vm, globalObject);
        return accessor;
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
    static void destroy(JSCell*) {}

    inline size_t length() { return m_deque.size(); }
    void push(JSC::VM& vm, JSC::JSValue v)
    {
        this->lock();
        m_deque.append(WriteBarrier<JSC::Unknown>());
        this->unlock();

        m_deque.last().set(vm, this, v);
    }
    void unshift(JSC::VM& vm, JSC::JSValue v)
    {
        this->lock();
        m_deque.prepend(WriteBarrier<JSC::Unknown>());
        this->unlock();

        m_deque.first().set(vm, this, v);
    }
    void removeFirst()
    {
        this->lock();
        m_deque.removeFirst();
        this->unlock();
    }
    JSC::JSValue shift()
    {
        if (length() == 0) [[unlikely]]
            return JSC::jsUndefined();
        auto v = m_deque.first().get();

        this->lock();
        m_deque.removeFirst();
        this->unlock();

        return v;
    }
    void clear()
    {
        this->lock();
        m_deque.clear();
        this->unlock();
    }
    JSC::JSValue first()
    {
        if (length() == 0) [[unlikely]]
            return JSC::jsUndefined();
        return m_deque.first().get();
    }

    JSC::JSValue concat(JSC::VM&, JSC::JSGlobalObject*, size_t);
    JSC::JSValue join(JSC::VM&, JSC::JSGlobalObject*, JSString*);
    JSC::JSValue consume(JSC::VM&, JSC::JSGlobalObject*, size_t, bool);
    JSC::JSValue _getBuffer(JSC::VM&, JSC::JSGlobalObject*, size_t);
    JSC::JSValue _getString(JSC::VM&, JSC::JSGlobalObject*, size_t);

    void lock() { m_lock.lock(); }
    void unlock() { m_lock.unlock(); }

private:
    Deque<WriteBarrier<JSC::Unknown>> m_deque;
    WTF::Lock m_lock;
};

class JSBufferListPrototype : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSBufferListPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSBufferListPrototype* ptr = new (NotNull, JSC::allocateCell<JSBufferListPrototype>(vm)) JSBufferListPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSBufferListPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSBufferListPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

class JSBufferListConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static JSBufferListConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSBufferListPrototype* prototype);

    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = DoesNotNeedDestruction;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    void initializeProperties(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSBufferListPrototype* prototype);

    // Must be defined for each specialization class.
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
    DECLARE_EXPORT_INFO;

private:
    JSBufferListConstructor(JSC::VM& vm, JSC::Structure* structure, JSC::NativeFunction nativeFunction)
        : Base(vm, structure, nativeFunction, nativeFunction)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject* globalObject, JSBufferListPrototype* prototype);
};

JSValue getBufferList(Zig::GlobalObject* globalObject);

}
