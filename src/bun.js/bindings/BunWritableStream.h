#pragma once

#include "root.h"

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

    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm);

    bool isLocked() const;
    JSValue error(JSGlobalObject*, JSValue error);
    JSValue abort(JSGlobalObject*, JSValue reason);
    JSValue close(JSGlobalObject*);
    void finishInFlightClose();
    void finishInFlightCloseWithError(JSValue error);

    State state() const { return m_state; }
    void setState(State state) { m_state = state; }
    JSWritableStreamDefaultController* controller() const { return m_controller.get(); }
    void setController(JSWritableStreamDefaultController* controller) { m_controller.set(vm(), this, controller); }
    JSWritableStreamDefaultWriter* writer() const { return m_writer.get(); }
    void setWriter(VM& vm, JSWritableStreamDefaultWriter* writer) { m_writer.set(vm, this, writer); }
    JSValue storedError() const { return m_storedError.get(); }
    void setStoredError(VM& vm, JSValue error) { m_storedError.set(vm, this, error); }
    JSPromise* pendingAbortRequestPromise() const { return m_pendingAbortRequestPromise.get(); }
    JSValue pendingAbortRequestReason() const { return m_pendingAbortRequestReason.get(); }
    bool wasAlreadyErroring() const { return m_wasAlreadyErroring; }
    void clearPendingAbortRequest()
    {
        m_pendingAbortRequestPromise.clear();
        m_pendingAbortRequestReason.clear();
        m_wasAlreadyErroring = false;
    }
    bool hasOperationMarkedInFlight() const { return m_inFlightWriteRequest || m_inFlightCloseRequest; }

private:
    JSWritableStream(VM&, Structure*);
    void finishCreation(VM&);

    State m_state { State::Writable };
    WriteBarrier<JSWritableStreamDefaultController> m_controller;
    WriteBarrier<JSWritableStreamDefaultWriter> m_writer;
    WriteBarrier<JSPromise> m_closeRequest;
    WriteBarrier<JSPromise> m_inFlightWriteRequest;
    WriteBarrier<JSPromise> m_inFlightCloseRequest;
    WriteBarrier<Unknown> m_storedError;
    WriteBarrier<JSPromise> m_pendingAbortRequestPromise;
    WriteBarrier<Unknown> m_pendingAbortRequestReason;
    bool m_wasAlreadyErroring { false };
};

JSC_DECLARE_HOST_FUNCTION(jsFunctionResolveAbortPromiseWithUndefined);
JSC_DECLARE_HOST_FUNCTION(jsFunctionRejectAbortPromiseWithReason);

} // namespace Bun
