#pragma once

#include "root.h"

#include "EventNames.h"
#include "EventTarget.h"
#include "ContextDestructionObserver.h"
#include "ExceptionOr.h"
#include <wtf/URL.h>
#include <wtf/HashSet.h>
#include <wtf/Lock.h>

namespace WebCore {

class MessagePortChannelProvider;
class MessagePortChannelProviderImpl;

class WorkerGlobalScope : public RefCounted<WorkerGlobalScope>, public EventTargetWithInlineData {
    WTF_MAKE_ISO_ALLOCATED(WorkerGlobalScope);

    uint32_t m_messageEventCount { 0 };

    static void onDidChangeListenerImpl(EventTarget&, const AtomString&, OnDidChangeListenerKind);

public:
    WorkerGlobalScope(ScriptExecutionContext* context)
        : EventTargetWithInlineData()
        , m_context(context)
    {
        this->onDidChangeListener = &onDidChangeListenerImpl;
    }

    using RefCounted::deref;
    using RefCounted::ref;

    static Ref<WorkerGlobalScope> create(ScriptExecutionContext* context)
    {
        return adoptRef(*new WorkerGlobalScope(context));
    }

    ~WorkerGlobalScope() = default;

    EventTargetInterface eventTargetInterface() const final { return EventTargetInterface::DOMWindowEventTargetInterfaceType; }
    ScriptExecutionContext* scriptExecutionContext() const final { return m_context; }
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }
    void eventListenersDidChange() final {}

    MessagePortChannelProvider& messagePortChannelProvider();

    ScriptExecutionContext* m_context;

private:
    MessagePortChannelProviderImpl* m_messagePortChannelProvider;
};
}