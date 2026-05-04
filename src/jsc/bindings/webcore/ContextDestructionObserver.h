

#pragma once

#include "root.h"
#include "ScriptExecutionContext.h"

namespace WebCore {

class ContextDestructionObserver {

public:
    WEBCORE_EXPORT virtual void contextDestroyed();

    ScriptExecutionContext* scriptExecutionContext() const { return m_context.get(); }
    RefPtr<ScriptExecutionContext> protectedScriptExecutionContext() const;

protected:
    WEBCORE_EXPORT ContextDestructionObserver(ScriptExecutionContext*);
    WEBCORE_EXPORT virtual ~ContextDestructionObserver();
    void observeContext(ScriptExecutionContext*);

private:
    WeakPtr<ScriptExecutionContext> m_context;
};

}
