#pragma once
#include "root.h"

namespace Bun {

// Just like WebCore::EventLoopTask but does not take a ScriptExecutionContext
class EventLoopTaskNoContext {
    WTF_MAKE_ISO_ALLOCATED(EventLoopTaskNoContext);

public:
    EventLoopTaskNoContext(Function<void()>&& task)
        : m_task(WTFMove(task))
    {
    }

    void performTask()
    {
        m_task();
        delete this;
    }

private:
    Function<void()> m_task;
};

extern "C" void Bun__EventLoopTaskNoContext__performTask(EventLoopTaskNoContext* task);

} // namespace Bun
