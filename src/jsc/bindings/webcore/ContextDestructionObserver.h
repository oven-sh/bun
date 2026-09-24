

#pragma once

#include "root.h"
#include "ScriptExecutionContext.h"
#include <wtf/AbstractRefCountedAndCanMakeWeakPtr.h>

namespace WebCore {

class ContextDestructionObserver : public AbstractRefCountedAndCanMakeWeakPtr<ContextDestructionObserver> {

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
