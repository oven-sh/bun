// MessagePort is a thin EventTarget wrapper over MessagePortPipe.
//
// The pipe owns the cross-thread queue and wakeup coalescing; this class
// owns the JS-facing state (started/closed/detached, listener bookkeeping,
// event-loop ref) and translates between pipe callbacks and DOM events.

#pragma once

#include "ContextDestructionObserver.h"
#include "EventTarget.h"
#include "ExceptionOr.h"
#include "MessagePortPipe.h"
#include "MessageWithMessagePorts.h"
#include <wtf/WeakPtr.h>

namespace JSC {
class CallFrame;
class JSObject;
class JSValue;
}

namespace WebCore {

class WebCoreOpaqueRoot;

struct StructuredSerializeOptions;

DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(MessagePort);

class MessagePort final : public ContextDestructionObserver, public EventTarget, public ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr<MessagePort> {
    WTF_MAKE_NONCOPYABLE(MessagePort);
    WTF_MAKE_TZONE_ALLOCATED(MessagePort);

public:
    static Ref<MessagePort> create(ScriptExecutionContext&, Ref<MessagePortPipe>&&, uint8_t side);
    virtual ~MessagePort();

    ExceptionOr<void> postMessage(JSC::JSGlobalObject&, JSC::JSValue message, StructuredSerializeOptions&&);

    void start();
    void close();

    // Transfer machinery.
    static ExceptionOr<Vector<TransferredMessagePort>> disentanglePorts(Vector<RefPtr<MessagePort>>&&);
    static Vector<RefPtr<MessagePort>> entanglePorts(ScriptExecutionContext&, Vector<TransferredMessagePort>&&);
    static Ref<MessagePort> entangle(ScriptExecutionContext&, TransferredMessagePort&&);
    TransferredMessagePort disentangle();

    bool started() const { return m_started; }
    bool isDetached() const { return m_isDetached; }

    // Called by the pipe on this port's context thread when messages are ready.
    void drainAndDispatch();
    void dispatchOneMessage(ScriptExecutionContext&, MessageWithMessagePorts&&);

    // Only here for JSMessagePortCustom's GC optimization; always null.
    MessagePort* locallyEntangledPort() { return nullptr; }

    MessagePortPipe* pipe() const { return m_pipe.get(); }
    uint8_t side() const { return m_side; }

    void ref() const { ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr::ref(); }
    void deref() const { ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr::deref(); }

    // EventTarget.
    EventTargetInterface eventTargetInterface() const final { return MessagePortEventTargetInterfaceType; }
    ScriptExecutionContext* scriptExecutionContext() const final { return this->ContextDestructionObserver::scriptExecutionContext(); }
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }
    void dispatchEvent(Event&) final;

    // node:worker_threads receiveMessageOnPort — synchronous single pop.
    JSValue tryTakeMessage(JSGlobalObject*);

    bool hasPendingActivity() const;

    void jsRef(JSGlobalObject*);
    void jsUnref(JSGlobalObject*);
    bool jsHasRef() { return m_hasRef; }

private:
    MessagePort(ScriptExecutionContext&, Ref<MessagePortPipe>&&, uint8_t side);

    bool addEventListener(const AtomString& eventType, Ref<EventListener>&&, const AddEventListenerOptions&) final;
    bool removeEventListener(const AtomString& eventType, EventListener&, const EventListenerOptions&) final;

    void contextDestroyed() final;

    // A port gives up its pipe on transfer or close; until then it "is entangled".
    bool isEntangled() const { return m_pipe && !m_isDetached; }

    RefPtr<MessagePortPipe> m_pipe;
    uint8_t m_side { 0 };

    bool m_started { false };
    bool m_isDetached { false };
    bool m_hasMessageEventListener { false };
    bool m_hasRef { false };

    uint32_t m_messageEventCount { 0 };
    static void onDidChangeListenerImpl(EventTarget& self, const AtomString& eventType, OnDidChangeListenerKind kind);
};

WebCoreOpaqueRoot root(MessagePort*);

} // namespace WebCore
