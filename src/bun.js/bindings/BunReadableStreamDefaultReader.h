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
    static constexpr bool needsDestruction = true;

    static JSReadableStreamDefaultReader* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure, JSReadableStream* stream);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static Structure* structure(JSC::VM& vm, JSGlobalObject* globalObject);
    static JSObject* prototype(JSC::VM& vm, JSGlobalObject* globalObject);
    static JSObject* constructor(JSC::VM& vm, JSGlobalObject* globalObject, JSValue prototype);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename CellType, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return &vm.plainObjectSpace();
    }

    // Public API for C++ usage
    JSC::JSPromise* readyPromise() { return m_readyPromise.get(); }
    JSC::JSPromise* closedPromise() { return m_closedPromise.get(); }
    JSReadableStream* stream() { return m_stream.get(); }

    JSC::JSPromise* read(JSC::VM&, JSGlobalObject*);

    bool isActive() const { return !!m_stream; }
    void detach();

    unsigned length() const { return m_readRequests.get()->length(); }

    // Implements ReadableStreamDefaultReader
    void releaseLock();

private:
    JSReadableStreamDefaultReader(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);

    // Internal slots defined by the spec
    JSC::WriteBarrier<JSReadableStream> m_stream;
    JSC::WriteBarrier<JSC::JSPromise> m_readyPromise;
    JSC::WriteBarrier<JSC::JSPromise> m_closedPromise;
    JSC::WriteBarrier<JSC::JSArray> m_readRequests;
};

} // namespace Bun
