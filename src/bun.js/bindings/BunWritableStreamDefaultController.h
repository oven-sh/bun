#pragma once

#include "root.h"

#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSArray.h>
#include "BunStreamQueue.h"

namespace WebCore {
class JSAbortController;
class JSAbortSignal;
class AbortSignal;
}

namespace Bun {

class JSWritableStream;

class JSWritableStreamDefaultController final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr bool needsDestruction = false;

    static JSWritableStreamDefaultController* create(
        JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        JSC::Structure* structure,
        JSWritableStream* stream,
        double highWaterMark,
        JSC::JSObject* abortAlgorithm,
        JSC::JSObject* closeAlgorithm,
        JSC::JSObject* writeAlgorithm,
        JSC::JSObject* sizeAlgorithm);

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode>
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
        return JSC::Structure::create(vm, globalObject, prototype,
            JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    // JavaScript-facing methods
    JSC::JSValue error(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue reason);
    JSC::JSValue error(JSC::JSGlobalObject* globalObject, JSC::JSValue reason) { return error(this->vm(), globalObject, reason); }

    JSC::JSValue close(JSC::JSGlobalObject* globalObject);
    void write(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue chunk);
    void write(JSC::JSGlobalObject* globalObject, JSC::JSValue chunk) { this->write(this->vm(), globalObject, chunk); }

    // C++-facing methods
    bool shouldCallWrite() const;
    double getDesiredSize() const { return m_queue.desiredSize(); }
    bool started() const { return m_started; }
    void errorSteps();
    JSC::JSValue performAbortAlgorithm(JSC::JSValue reason);

    // For garbage collection
    DECLARE_VISIT_CHILDREN;

    Ref<WebCore::AbortSignal> abortSignal() const;
    WebCore::AbortSignal& signal() const;

    JSWritableStream* stream() const;
    JSC::JSObject* abortAlgorithm() const { return m_abortAlgorithm.get(); }
    JSC::JSObject* closeAlgorithm() const { return m_closeAlgorithm.get(); }
    JSC::JSObject* writeAlgorithm() const { return m_writeAlgorithm.get(); }

    void setStream(JSC::VM& vm, JSWritableStream* stream);
    void setAbortAlgorithm(JSC::VM& vm, JSC::JSObject* abortAlgorithm);
    void setCloseAlgorithm(JSC::VM& vm, JSC::JSObject* closeAlgorithm);
    void setWriteAlgorithm(JSC::VM& vm, JSC::JSObject* writeAlgorithm);

    void resetQueue(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* owner) { m_queue.resetQueue(vm, globalObject, owner); }
    Bun::StreamQueue& queue() { return m_queue; }
    const Bun::StreamQueue& queue() const { return m_queue; }

private:
    JSWritableStreamDefaultController(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);

    // Internal slots per spec
    JSC::WriteBarrier<JSObject> m_stream;
    Bun::StreamQueue m_queue;

    // Functions for us to call.
    JSC::WriteBarrier<JSC::JSObject> m_abortAlgorithm;
    JSC::WriteBarrier<JSC::JSObject> m_closeAlgorithm;
    JSC::WriteBarrier<JSC::JSObject> m_writeAlgorithm;

    bool m_started { false };
    bool m_writing { false };
    bool m_inFlightWriteRequest { false };
    bool m_closeRequested { false };
    JSC::LazyProperty<JSObject, WebCore::JSAbortController> m_abortController;
};

}
