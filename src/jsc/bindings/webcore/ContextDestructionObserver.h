

#pragma once

#include "root.h"
#include "ScriptExecutionContext.h"
#include <wtf/AbstractRefCountedAndCanMakeWeakPtr.h>
#include <wtf/SentinelLinkedList.h>

namespace WebCore {

// A node of ScriptExecutionContext::m_destructionObservers while it observes a context.
class ContextDestructionObserver : public AbstractRefCountedAndCanMakeWeakPtr<ContextDestructionObserver>, public BasicRawSentinelNode<ContextDestructionObserver> {

public:
    WEBCORE_EXPORT virtual void contextDestroyed();

    ScriptExecutionContext* scriptExecutionContext() const { return m_context.get(); }

protected:
    WEBCORE_EXPORT explicit ContextDestructionObserver(ScriptExecutionContext*);
    WEBCORE_EXPORT virtual ~ContextDestructionObserver();
    void observeContext(ScriptExecutionContext*);

private:
    WeakPtr<ScriptExecutionContext> m_context;
};

}
