#include "root.h"

#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSArray.h>

namespace WebCore {
class JSAbortController;
}

namespace Bun {

class JSWritableStream;

class JSWritableStreamDefaultController final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr bool needsDestruction = true;

    static JSWritableStreamDefaultController* create(
        JSC::VM& vm,
        JSC::Structure* structure,
        JSWritableStream* stream,
        double highWaterMark,
        JSC::JSObject* underlyingSinkObj);

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype,
            JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    // JavaScript-facing methods
    JSC::JSValue error(JSC::JSGlobalObject* globalObject, JSC::JSValue reason);
    JSC::JSValue close(JSC::JSGlobalObject* globalObject);

    // C++-facing methods
    bool shouldCallWrite() const;
    double getDesiredSize() const;

    // For garbage collection
    DECLARE_VISIT_CHILDREN;

    JSC::JSValue abortSignal() const;

    template<typename Visitor> void visitAdditionalChildren(Visitor&);

    JSWritableStream* stream() const { return m_stream.get(); }
    JSC::JSPromise* abortAlgorithm() const { return m_abortAlgorithm.get(); }
    JSC::JSPromise* closeAlgorithm() const { return m_closeAlgorithm.get(); }
    JSC::JSPromise* writeAlgorithm() const { return m_writeAlgorithm.get(); }

    void setStream(JSC::VM& vm, JSWritableStream* stream) { m_stream.set(vm, this, stream); }
    void setAbortAlgorithm(JSC::VM& vm, JSC::JSPromise* abortAlgorithm) { m_abortAlgorithm.set(vm, this, abortAlgorithm); }
    void setCloseAlgorithm(JSC::VM& vm, JSC::JSPromise* closeAlgorithm) { m_closeAlgorithm.set(vm, this, closeAlgorithm); }
    void setWriteAlgorithm(JSC::VM& vm, JSC::JSPromise* writeAlgorithm) { m_writeAlgorithm.set(vm, this, writeAlgorithm); }

    void clearQueue() { m_queue.clear(); }

    ~JSWritableStreamDefaultController();
    static void destroy(JSC::JSCell* cell)
    {
        static_cast<JSWritableStreamDefaultController*>(cell)->JSWritableStreamDefaultController::~JSWritableStreamDefaultController();
    }

private:
    JSWritableStreamDefaultController(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);

    // Internal slots per spec
    JSC::WriteBarrier<JSWritableStream> m_stream;

    // Functions for us to call.
    JSC::WriteBarrier<JSC::JSObject> m_abortAlgorithm;
    JSC::WriteBarrier<JSC::JSObject> m_closeAlgorithm;
    JSC::WriteBarrier<JSC::JSObject> m_writeAlgorithm;

    double m_strategyHWM { 1.0 };
    JSC::WriteBarrier<JSC::JSObject> m_strategySizeAlgorithm;
    JSC::WriteBarrier<JSC::JSObject> m_queue;
    double m_queueTotalSize { 0.0 };
    bool m_started { false };
    bool m_writing { false };
    bool m_inFlightWriteRequest { false };
    bool m_closeRequested { false };
    JSC::LazyProperty<JSObject, WebCore::JSAbortController> m_abortController;
};

}
