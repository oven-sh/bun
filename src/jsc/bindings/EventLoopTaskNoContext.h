#pragma once

#include "EventLoopTask.h"
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

    // The closure is not run. The returned task only destroys it, on the JS thread that owns what it captured.
    WebCore::EventLoopTask* intoUnrunTask()
    {
        auto* unrun = new WebCore::EventLoopTask([task = WTF::move(m_task)](WebCore::ScriptExecutionContext&) {});
        delete this;
        return unrun;
    }

private:
    Function<void()> m_task;
};

extern "C" void Bun__EventLoopTaskNoContext__performTask(EventLoopTaskNoContext* task);
extern "C" WebCore::EventLoopTask* Bun__EventLoopTaskNoContext__intoUnrunTask(EventLoopTaskNoContext* task);

} // namespace Bun
