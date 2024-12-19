#pragma once

#include "root.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/Strong.h>
#include <JavaScriptCore/WriteBarrier.h>

namespace Bun {

class JSReadableStream;

class JSReadableStreamBYOBReader : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr bool needsDestruction = true;

    template<typename CellType, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    static JSReadableStreamBYOBReader* create(JSC::VM&, JSC::JSGlobalObject*, JSC::Structure*, JSReadableStream*);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::HasStaticPropertyTable;

    JSReadableStream* stream() const { return m_stream.get(); }
    JSC::JSPromise* closedPromise() const { return m_closedPromise.get(); }
    JSC::JSPromise* readyPromise() const { return m_readyPromise.get(); }
    JSC::JSArray* readRequests() const { return m_readRequests.get(); }

    void setStream(JSC::VM& vm, JSReadableStream* stream) { m_stream.set(vm, this, stream); }
    void setClosedPromise(JSC::VM& vm, JSC::JSPromise* promise) { m_closedPromise.set(vm, this, promise); }
    void setReadyPromise(JSC::VM& vm, JSC::JSPromise* promise) { m_readyPromise.set(vm, this, promise); }
    void setReadRequests(JSC::VM& vm, JSC::JSArray* requests) { m_readRequests.set(vm, this, requests); }

    void clearStream() { m_stream.clear(); }

protected:
    JSReadableStreamBYOBReader(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);

private:
    JSC::WriteBarrier<JSReadableStream> m_stream;
    JSC::WriteBarrier<JSC::JSPromise> m_closedPromise;
    JSC::WriteBarrier<JSC::JSPromise> m_readyPromise;
    JSC::WriteBarrier<JSC::JSArray> m_readRequests;
};

} // namespace Bun
