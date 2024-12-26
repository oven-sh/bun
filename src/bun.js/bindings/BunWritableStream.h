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
    void write(JSGlobalObject*, JSValue chunk);
    void finishInFlightClose();
    void finishInFlightCloseWithError(JSValue error);

    State state() const { return m_state; }
    void setState(State state) { m_state = state; }
    JSWritableStreamDefaultController* controller() const;
    void setController(JSWritableStreamDefaultController* controller);
    JSWritableStreamDefaultWriter* writer() const;
    void setWriter(VM& vm, JSWritableStreamDefaultWriter* writer);
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
    mutable WriteBarrier<JSObject> m_controller;
    mutable WriteBarrier<JSObject> m_writer;
    mutable WriteBarrier<JSPromise> m_closeRequest;
    mutable WriteBarrier<JSPromise> m_inFlightWriteRequest;
    mutable WriteBarrier<JSPromise> m_inFlightCloseRequest;
    mutable WriteBarrier<Unknown> m_storedError;
    mutable WriteBarrier<JSPromise> m_pendingAbortRequestPromise;
    mutable WriteBarrier<Unknown> m_pendingAbortRequestReason;
    bool m_wasAlreadyErroring { false };
};

JSC_DECLARE_HOST_FUNCTION(jsFunctionResolveAbortPromiseWithUndefined);
JSC_DECLARE_HOST_FUNCTION(jsFunctionRejectAbortPromiseWithReason);

} // namespace Bun
