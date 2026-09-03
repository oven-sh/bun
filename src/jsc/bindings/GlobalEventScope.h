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

class GlobalEventScope : public RefCounted<GlobalEventScope>, public EventTargetWithInlineData {
    WTF_MAKE_TZONE_ALLOCATED(GlobalEventScope);

    uint32_t m_messageEventCount { 0 };

    static void onDidChangeListenerImpl(EventTarget&, const AtomString&, OnDidChangeListenerKind);

public:
    GlobalEventScope(ScriptExecutionContext* context)
        : EventTargetWithInlineData()
        , m_context(context)
    {
        this->onDidChangeListener = &onDidChangeListenerImpl;
    }

    using RefCounted::deref;
    using RefCounted::ref;

    ~GlobalEventScope() = default;

    EventTargetInterface eventTargetInterface() const final { return EventTargetInterface::DOMWindowEventTargetInterfaceType; }
    ScriptExecutionContext* scriptExecutionContext() const final { return m_context; }
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }
    void eventListenersDidChange() final {}

    ScriptExecutionContext* m_context;
};
}
