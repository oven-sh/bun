#include "root.h"

#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSArray.h>

namespace Bun {

class JSTransformStreamDefaultController;

class JSTransformStream final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    // For garbage collection
    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    static JSTransformStream* create(
        JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        JSC::Structure* structure);

    static JSC::Structure* createStructure(
        JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        JSC::JSValue prototype)
    {
        return JSC::Structure::create(
            vm,
            globalObject,
            prototype,
            JSC::TypeInfo(JSC::JSType::ObjectType, StructureFlags),
            info());
    }

    // Readable side operations
    JSC::JSValue readable() { return m_readable.get(); }
    JSC::JSValue writable() { return m_writable.get(); }
    JSTransformStreamDefaultController* controller() { return m_controller.get(); }
    // Direct C++ API
    void enqueue(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue chunk);
    void error(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue error);
    void terminate(JSC::VM&, JSC::JSGlobalObject*);

private:
    JSTransformStream(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);

    // The readable and writable sides of the transform stream
    JSC::WriteBarrier<JSC::JSObject> m_readable;
    JSC::WriteBarrier<JSC::JSObject> m_writable;
    JSC::WriteBarrier<JSTransformStreamDefaultController> m_controller;

    // State flags
    bool m_backpressure { false };
    JSC::WriteBarrier<JSC::JSPromise> m_backpressureChangePromise;
};

}
