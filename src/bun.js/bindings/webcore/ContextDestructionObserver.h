

#pragma once

#include "root.h"

namespace WebCore {

class ScriptExecutionContext;

class ContextDestructionObserver {

public:
    WEBCORE_EXPORT virtual void contextDestroyed();

    ScriptExecutionContext* scriptExecutionContext() const { return m_context; }

protected:
    WEBCORE_EXPORT ContextDestructionObserver(ScriptExecutionContext*);
    WEBCORE_EXPORT virtual ~ContextDestructionObserver();
    void observeContext(ScriptExecutionContext*);

private:
    ScriptExecutionContext* m_context;
};

}