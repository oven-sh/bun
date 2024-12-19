#pragma once

#include "root.h"

#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include "JavaScriptCore/JSCast.h"
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <JavaScriptCore/Completion.h>
#include "DOMIsoSubspaces.h"
#include "BunClientData.h"

namespace Bun {

class JSWritableStreamDefaultController;
class JSWritableStreamDefaultWriter;
class UnderlyingSink;

using namespace JSC;

// Main WritableStream object implementation
class JSWritableStream final : public JSDestructibleObject {
public:
    using Base = JSDestructibleObject;
    static constexpr bool needsDestruction = true;

    static JSWritableStream* create(VM&, JSGlobalObject*, Structure*);

    DECLARE_INFO;
    template<typename CellType, SubspaceAccess mode>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        if constexpr (mode == SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSWritableStream, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForWritableStream.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForWritableStream = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForWritableStream.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForWritableStream = std::forward<decltype(space)>(space); });
    }

    static Structure* createStructure(VM&, JSGlobalObject*, JSValue prototype);

    // Internal state tracking
    enum class State : uint8_t {
        Writable,
        Erroring,
        Errored,
        Closing,
        Closed
    };

    JSWritableStreamDefaultController* controller() { return m_controller.get(); }
    JSPromise* closeRequest() { return m_closeRequest.get(); }
    JSPromise* inFlightWriteRequest() { return m_inFlightWriteRequest.get(); }
    JSValue storedError() const { return m_storedError.get(); }
    State state() const { return m_state; }
    bool backpressure() const { return m_backpressure; }
    JSWritableStreamDefaultWriter* writer() { return m_writer.get(); }

    // Public C++ API
    JSValue error(JSGlobalObject*, JSValue error);
    bool isLocked() const;
    JSValue abort(JSGlobalObject*, JSValue reason);
    JSValue close(JSGlobalObject*);
    void setController(JSC::VM& vm, JSWritableStreamDefaultController* controller)
    {
        m_controller.set(vm, this, controller);
    }
    void setWriter(JSC::VM& vm, JSWritableStreamDefaultWriter* writer)
    {
        m_writer.set(vm, this, writer);
    }

    static JSObject* createPrototype(VM&, JSGlobalObject*);
    static JSObject* createConstructor(VM&, JSGlobalObject*, JSValue);

    DECLARE_VISIT_CHILDREN;

    void setPendingAbortRequest(JSC::VM& vm, JSPromise* promise, JSValue reason, bool wasAlreadyErroring)
    {
        m_pendingAbortRequestPromise.set(vm, this, promise);
        m_pendingAbortRequestReason.set(vm, this, reason);
        m_wasAlreadyErroring = wasAlreadyErroring;
    }

    JSPromise* pendingAbortRequestPromise() { return m_pendingAbortRequestPromise.get(); }
    JSValue pendingAbortRequestReason() { return m_pendingAbortRequestReason.get(); }
    bool wasAlreadyErroring() { return m_wasAlreadyErroring; }

    void clearPendingAbortRequest()
    {
        m_pendingAbortRequestPromise.clear();
        m_pendingAbortRequestReason.clear();
        m_wasAlreadyErroring = false;
    }

    void setStoredError(JSC::VM& vm, JSValue error)
    {
        m_storedError.set(vm, this, error);
    }

    void clearStoredError()
    {
        m_storedError.clear();
    }

    void setState(State state)
    {
        m_state = state;
    }

    void setBackpressure(bool backpressure)
    {
        m_backpressure = backpressure;
    }

    bool hasOperationMarkedInFlight() const { return m_inFlightWriteRequest || m_inFlightCloseRequest; }

    void finishInFlightClose();
    void finishInFlightCloseWithError(JSValue error);

private:
    JSWritableStream(VM&, Structure*);
    void finishCreation(VM&);
    static void destroy(JSCell*);

    // Internal state tracking
    State m_state { State::Writable };
    bool m_backpressure { false };

    WriteBarrier<JSWritableStreamDefaultController> m_controller;
    WriteBarrier<JSWritableStreamDefaultWriter> m_writer;
    WriteBarrier<JSPromise> m_closeRequest;
    WriteBarrier<JSPromise> m_inFlightWriteRequest;
    WriteBarrier<JSPromise> m_inFlightCloseRequest;
    WriteBarrier<JSPromise> m_pendingAbortRequestPromise;
    WriteBarrier<Unknown> m_pendingAbortRequestReason;
    WriteBarrier<Unknown> m_storedError;

    bool m_wasAlreadyErroring { false };
};

}
