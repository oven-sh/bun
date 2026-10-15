

#pragma once

#include "root.h"
#include "ScriptExecutionContext.h"
#include <wtf/AbstractRefCountedAndCanMakeWeakPtr.h>
#include <wtf/SentinelLinkedList.h>

namespace WebCore {

// Linked into its context's observer list (ScriptExecutionContext::m_destructionObservers)
// from observeContext() until contextDestroyed() or the destructor: two pointer stores each
// way, and the context's destructor unlinks the head N times instead of draining a hash set.
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
