#pragma once

#include "root.h"

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
    static void destroy(JSCell*);

    int32_t length() { return m_length; }
    void push(JSC::VM& vm, JSC::JSValue v)
    {
        Entry* entry = new Entry(vm, v, nullptr);
        if (m_length == 0) {
            m_head = entry;
        } else {
            m_tail->m_next = entry;
        }
        m_tail = entry;
        m_length++;
    }
    void unshift(JSC::VM& vm, JSC::JSValue v)
    {
        Entry* entry = new Entry(vm, v, m_head);
        if (m_length == 0) {
            m_tail = entry;
        }
        m_head = entry;
        m_length++;
    }
    JSC::JSValue shift()
    {
        if (m_length == 0) return JSC::jsUndefined();
        Entry* entry = m_head;
        if (m_length == 0) {
            m_head = nullptr;
            m_tail = nullptr;
        } else {
            m_head = m_head->m_next;
        }
        entry->m_next = nullptr;
        JSC::JSValue ret(entry->m_data.get());
        delete entry;
        m_length--;
        return ret;
    }
    void clear()
    {
        delete m_head;
        m_head = nullptr;
        m_tail = nullptr;
        m_length = 0;
    }
    JSC::JSValue first()
    {
        // should raise error?
        if (UNLIKELY(m_length == 0))
            return JSC::jsUndefined();
        return JSC::JSValue(m_head->m_data.get());
    }

    JSC::JSValue concat(JSC::VM&, JSC::JSGlobalObject*, int32_t);
    JSC::JSValue join(JSC::VM&, JSC::JSGlobalObject*, JSString*);
    JSC::JSValue consume(JSC::VM&, JSC::JSGlobalObject*, int32_t, bool);
    JSC::JSValue _getBuffer(JSC::VM&, JSC::JSGlobalObject*, int32_t);
    JSC::JSValue _getString(JSC::VM&, JSC::JSGlobalObject*, int32_t);

private:
    struct Entry {
        Entry(JSC::VM& vm, JSValue v, Entry* next) : m_data(vm, v.asCell()), m_next(next) {}
        ~Entry()
        {
            if (m_next != nullptr)
                delete m_next;
        }
        JSC::Strong<JSC::JSCell> m_data;
        Entry* m_next;
    };

    int32_t m_length = 0;
    Entry* m_head = nullptr;
    Entry* m_tail = nullptr;
};

EncodedJSValue constructJSBufferList(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame);

}
