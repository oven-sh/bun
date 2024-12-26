#pragma once

#include "root.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/WriteBarrier.h>

namespace Bun {

using namespace JSC;

class JSReadableStream;

class JSReadableStreamDefaultReader final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr bool needsDestruction = false;

    static JSReadableStreamDefaultReader* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure, JSReadableStream* stream);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSObject* prototype(JSC::VM& vm, JSGlobalObject* globalObject);
    static JSObject* constructor(JSC::VM& vm, JSGlobalObject* globalObject, JSValue prototype);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    // Public API for C++ usage
    JSC::JSPromise* readyPromise() { return m_readyPromise.get(this); }
    JSC::JSPromise* closedPromise() { return m_closedPromise.get(this); }
    JSReadableStream* stream() const;

    JSC::JSPromise* read(JSC::VM&, JSGlobalObject*);
    JSC::JSPromise* cancel(JSC::VM&, JSGlobalObject*, JSValue reason);
    bool isActive() const { return !!m_stream; }
    void detach();

    unsigned length() const { return m_readRequests.isInitialized() ? m_readRequests.get(this)->length() : 0; }

    // Implements ReadableStreamDefaultReader
    void releaseLock();

private:
    JSReadableStreamDefaultReader(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);

    // Internal slots defined by the spec
    mutable JSC::WriteBarrier<JSObject> m_stream;
    JSC::LazyProperty<JSObject, JSC::JSPromise> m_readyPromise;
    JSC::LazyProperty<JSObject, JSC::JSPromise> m_closedPromise;
    JSC::LazyProperty<JSObject, JSC::JSArray> m_readRequests;
};

} // namespace Bun
