#pragma once

#include "root.h"

#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/LazyProperty.h>

namespace Bun {

class JSWritableStream;

class JSWritableStreamDefaultWriter final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSWritableStreamDefaultWriter* create(JSC::VM&, JSC::Structure*, JSWritableStream*);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    // JavaScript-visible properties
    JSC::JSPromise* closed() { return m_closedPromise.get(this); }
    JSC::JSPromise* ready() { return m_readyPromise.get(this); }
    double desiredSize();

    void resolveClosedPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue value);
    void rejectClosedPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue error);
    void rejectWriteRequests(JSC::JSGlobalObject* globalObject, JSC::JSValue reason);
    void setReady(JSC::VM& vm, JSC::JSPromise* promise);
    void error(JSC::JSGlobalObject* globalObject, JSC::JSValue reason);

    // Internal APIs for C++ use
    JSWritableStream* stream() const { return m_stream.get(); }
    void release(); // For releaseLock()
    void write(JSC::JSGlobalObject*, JSC::JSValue chunk);
    void abort(JSC::JSGlobalObject*, JSC::JSValue reason = JSC::jsUndefined());
    void close(JSC::JSGlobalObject*);

protected:
    JSWritableStreamDefaultWriter(JSC::VM&, JSC::Structure*, JSWritableStream*);
    void finishCreation(JSC::VM&);

private:
    mutable JSC::WriteBarrier<JSWritableStream> m_stream;
    JSC::LazyProperty<JSC::JSObject, JSC::JSPromise> m_closedPromise;
    JSC::LazyProperty<JSC::JSObject, JSC::JSPromise> m_readyPromise;
    JSC::LazyProperty<JSC::JSObject, JSC::JSArray> m_writeRequests;
};

} // namespace Bun
