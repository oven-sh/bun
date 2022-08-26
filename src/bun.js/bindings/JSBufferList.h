#pragma once

#include "root.h"
#include "wtf/Deque.h"

namespace WebCore {
using namespace JSC;

class JSBufferList : public JSC::JSNonFinalObject {
    using Base = JSC::JSNonFinalObject;

public:
    JSBufferList(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
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

    static JSBufferList* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSBufferList* accessor = new (NotNull, JSC::allocateCell<JSBufferList>(vm)) JSBufferList(vm, structure);
        accessor->finishCreation(vm, globalObject);
        return accessor;
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
    static void destroy(JSCell*) {}

    size_t length() { return m_deque.size(); }
    void push(JSC::VM& vm, JSC::JSValue v)
    {
        m_deque.append(WriteBarrier<Unknown>());
        m_deque.last().set(vm, this, v);
    }
    void unshift(JSC::VM& vm, JSC::JSValue v)
    {
        m_deque.prepend(WriteBarrier<Unknown>());
        m_deque.first().set(vm, this, v);
    }
    JSC::JSValue shift()
    {
        if (UNLIKELY(length() == 0))
            return JSC::jsUndefined();
        auto v = m_deque.first().get();
        m_deque.removeFirst();
        return v;
    }
    void clear()
    {
        m_deque.clear();
    }
    JSC::JSValue first()
    {
        if (UNLIKELY(length() == 0))
            return JSC::jsUndefined();
        return JSC::JSValue(m_deque.first().get());
    }

    JSC::JSValue concat(JSC::VM&, JSC::JSGlobalObject*, int32_t);
    JSC::JSValue join(JSC::VM&, JSC::JSGlobalObject*, JSString*);
    JSC::JSValue consume(JSC::VM&, JSC::JSGlobalObject*, int32_t, bool);
    JSC::JSValue _getBuffer(JSC::VM&, JSC::JSGlobalObject*, int32_t);
    JSC::JSValue _getString(JSC::VM&, JSC::JSGlobalObject*, int32_t);

private:
    Deque<WriteBarrier<Unknown>> m_deque;
};

EncodedJSValue constructJSBufferList(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame);

}
