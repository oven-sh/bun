#pragma once

#include "root.h"

namespace Bun {

class JSTransformStream;

class JSTransformStreamDefaultController final : public JSC::JSNonFinalObject {
    using Base = JSC::JSNonFinalObject;

public:
    static JSTransformStreamDefaultController* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSTransformStream* transformStream);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;
    template<typename CellType, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if (mode == JSC::SubspaceAccess::Concurrently) {
            return nullptr;
        }

        return subspaceForImpl(vm);
    }

    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    bool enqueue(JSC::JSGlobalObject* globalObject, JSC::JSValue chunk);
    void error(JSC::JSGlobalObject* globalObject, JSC::JSValue error);
    void terminate(JSC::JSGlobalObject* globalObject);

private:
    JSTransformStreamDefaultController(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSTransformStream* transformStream);

    JSC::WriteBarrier<JSTransformStream> m_stream;
    JSC::WriteBarrier<JSC::JSObject> m_flushPromise;
    JSC::WriteBarrier<JSC::JSObject> m_transformAlgorithm;
    JSC::WriteBarrier<JSC::JSObject> m_flushAlgorithm;
};

} // namespace Bun
