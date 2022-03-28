

#pragma once

#include "root.h"

#include "ScriptExecutionContext.h"

namespace WebCore {

// TODO:
class ContextDestructionObserver {

public:
    WEBCORE_EXPORT void contextDestroyed() {}

    ScriptExecutionContext* scriptExecutionContext() const { return m_context; }

    ContextDestructionObserver(ScriptExecutionContext* context)
        : m_context(context)
    {
    }
    ContextDestructionObserver(ContextDestructionObserver& context)
        : m_context(context.m_context)
    {
    }

private:
    int m_junk = 0;
    ScriptExecutionContext* m_context;
};

}