
#pragma once

#include "root.h"

#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSArray.h>

namespace Bun {

class JSWritableStream;

class JSWritableStreamDefaultWriter final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr bool needsDestruction = true;

    static JSWritableStreamDefaultWriter* create(JSC::VM&, JSC::Structure*, JSWritableStream*);
    static JSWritableStreamDefaultWriter* createForSubclass(JSC::VM&, JSC::Structure*, JSWritableStream*);

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype,
            JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    DECLARE_INFO;

    // JavaScript-visible properties
    JSC::JSPromise* closed() { return m_closedPromise.get(); }
    JSC::JSPromise* ready() { return m_readyPromise.get(); }
    double desiredSize();

    // Internal APIs for C++ use
    JSWritableStream* stream() { return m_stream.get(); }
    void release(); // For releaseLock()
    bool write(JSC::JSGlobalObject*, JSC::JSValue chunk, JSC::JSValue* error = nullptr);
    bool abort(JSC::JSGlobalObject*, JSC::JSValue reason = JSC::JSValue(), JSC::JSValue* error = nullptr);
    bool close(JSC::JSGlobalObject*, JSC::JSValue* error = nullptr);

    void visitAdditionalChildren(JSC::SlotVisitor&);

protected:
    JSWritableStreamDefaultWriter(JSC::VM&, JSC::Structure*, JSWritableStream*);
    void finishCreation(JSC::VM&);
    static void destroy(JSC::JSCell*);

private:
    JSC::WriteBarrier<JSWritableStream> m_stream;
    JSC::WriteBarrier<JSC::JSPromise> m_closedPromise;
    JSC::WriteBarrier<JSC::JSPromise> m_readyPromise;
};

} // namespace Bun
