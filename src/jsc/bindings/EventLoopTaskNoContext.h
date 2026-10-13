#pragma once

#include "ZigGlobalObject.h"
#include "root.h"

namespace Bun {

// Just like WebCore::EventLoopTask but does not take a ScriptExecutionContext.
// The Rust `ConcurrentCppTask` that carries one to the work pool holds the
// creating VM's ticket, so that VM outlives the task.
class EventLoopTaskNoContext {
    WTF_MAKE_TZONE_ALLOCATED(EventLoopTaskNoContext);

public:
    EventLoopTaskNoContext(Function<void()>&& task)
        : m_task(WTF::move(task))
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
