#pragma once

#include "root.h"

#include "EventNames.h"
#include "EventTarget.h"
#include "EventTargetInterfaces.h"
#include "ContextDestructionObserver.h"
#include "ExceptionOr.h"
#include <wtf/URL.h>
#include <wtf/HashSet.h>
#include <wtf/Lock.h>

namespace WebCore {

class GlobalEventScope : public RefCounted<GlobalEventScope>, public EventTargetWithInlineData {
    WTF_MAKE_TZONE_ALLOCATED(GlobalEventScope);

    uint32_t m_messageEventCount { 0 };

public:
    GlobalEventScope(ScriptExecutionContext* context)
        : EventTargetWithInlineData()
        , m_context(context)
    {
    }

    using RefCounted::deref;
    using RefCounted::ref;

    static Ref<GlobalEventScope> create(ScriptExecutionContext* context)
    {
        return adoptRef(*new GlobalEventScope(context));
    }

    ~GlobalEventScope() = default;

    enum EventTargetInterfaceType eventTargetInterface() const final { return EventTargetInterfaceType::DOMWindow; }
    ScriptExecutionContext* scriptExecutionContext() const final { return m_context; }
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }
    void eventListenersDidChange() final {}

    bool addEventListener(const AtomString& eventType, Ref<EventListener>&&, const AddEventListenerOptions&) final;
    bool removeEventListener(const AtomString& eventType, EventListener&, const EventListenerOptions&) final;
    void removeAllEventListeners() final;

    ScriptExecutionContext* m_context;
};
}
