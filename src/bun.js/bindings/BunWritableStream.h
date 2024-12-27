#pragma once

#include "root.h"
#include "JavaScriptCore/JSObject.h"

namespace Bun {

using namespace JSC;

class JSWritableStreamDefaultController;
class JSWritableStreamDefaultWriter;

class JSWritableStream final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;

    enum class State {
        Writable,
        Erroring,
        Errored,
        Closed
    };

    static JSWritableStream* create(VM&, JSGlobalObject*, Structure*);
    static Structure* createStructure(VM&, JSGlobalObject*, JSValue prototype);

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

    bool isLocked() const;
    JSValue error(JSC::VM& vm, JSC::JSGlobalObject*, JSC::JSValue error);
    JSValue error(JSC::JSGlobalObject* globalObject, JSC::JSValue error) { return this->error(this->vm(), globalObject, error); }
    JSValue abort(JSC::VM& vm, JSC::JSGlobalObject*, JSC::JSValue reason);
    JSValue abort(JSC::JSGlobalObject* globalObject, JSC::JSValue reason) { return abort(this->vm(), globalObject, reason); }
    JSValue close(JSC::VM& vm, JSC::JSGlobalObject*);
    JSValue close(JSC::JSGlobalObject* globalObject) { return close(this->vm(), globalObject); }
    void write(JSC::VM& vm, JSC::JSGlobalObject*, JSC::JSValue chunk);
    void write(JSC::JSGlobalObject* globalObject, JSC::JSValue chunk) { return write(this->vm(), globalObject, chunk); }
    void finishInFlightClose();
    void finishInFlightCloseWithError(JSValue error);

    bool isCloseQueuedOrInFlight() const { return m_closeRequest || m_inFlightCloseRequest; }
    bool isCloseQueued() const { return !!m_closeRequest; }
    bool isInFlightClose() const { return !!m_inFlightCloseRequest; }
    State state() const { return m_state; }
    void setState(State state) { m_state = state; }
    JSWritableStreamDefaultController* controller() const;
    void setController(JSC::VM& vm, JSWritableStreamDefaultController* controller);
    void setController(JSWritableStreamDefaultController* controller) { setController(this->vm(), controller); }
    JSWritableStreamDefaultWriter* writer() const;
    void setWriter(JSC::VM& vm, JSWritableStreamDefaultWriter* writer);
    void setWriter(JSWritableStreamDefaultWriter* writer) { setWriter(this->vm(), writer); }
    JSValue storedError() const { return m_storedError.get(); }
    void setStoredError(JSC::VM& vm, JSC::JSValue error);
    void setStoredError(JSC::JSValue error) { setStoredError(this->vm(), error); }
    JSPromise* pendingAbortRequestPromise() const { return m_pendingAbortRequestPromise.get(); }
    JSValue pendingAbortRequestReason() const { return m_pendingAbortRequestReason.get(); }
    bool wasAlreadyErroring() const { return m_wasAlreadyErroring; }
    void clearPendingAbortRequest()
    {
        m_pendingAbortRequestPromise.clear();
        m_pendingAbortRequestReason.clear();
        m_wasAlreadyErroring = false;
    }
    void updateBackpressure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, bool backpressure);
    bool backpressure() const { return m_backpressure; }
    bool hasOperationMarkedInFlight() const { return m_inFlightWriteRequest || m_inFlightCloseRequest; }
    void setBackpressure(bool backpressure) { m_backpressure = backpressure; }

private:
    JSWritableStream(VM&, Structure*);
    void finishCreation(VM&);

    State m_state { State::Writable };
    mutable WriteBarrier<JSObject> m_controller;
    mutable WriteBarrier<JSObject> m_writer;
    mutable WriteBarrier<JSPromise> m_closeRequest;
    mutable WriteBarrier<JSPromise> m_inFlightWriteRequest;
    mutable WriteBarrier<JSPromise> m_inFlightCloseRequest;
    mutable WriteBarrier<Unknown> m_storedError;
    mutable WriteBarrier<JSPromise> m_pendingAbortRequestPromise;
    mutable WriteBarrier<Unknown> m_pendingAbortRequestReason;
    bool m_wasAlreadyErroring { false };
    bool m_backpressure { false };
};

JSC_DECLARE_HOST_FUNCTION(jsFunctionResolveAbortPromiseWithUndefined);
JSC_DECLARE_HOST_FUNCTION(jsFunctionRejectAbortPromiseWithReason);

} // namespace Bun
