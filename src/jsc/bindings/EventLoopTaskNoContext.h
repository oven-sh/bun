#pragma once

#include "root.h"
#include "EventLoopTask.h"
#include "ZigGlobalObject.h"

namespace Bun {

// Work for the thread pool that hands back what to run on the JS thread it
// came from. The Rust `ConcurrentCppTask` that carries it holds the creating
// VM's ticket, so that VM outlives the task, and posts the reply through that
// ticket: to the loop that was current when the work was dispatched.
class EventLoopTaskNoContext {
    WTF_MAKE_TZONE_ALLOCATED(EventLoopTaskNoContext);

public:
    using Reply = Function<void(WebCore::ScriptExecutionContext&)>;

    EventLoopTaskNoContext(Function<Reply()>&& task)
        : m_task(WTF::move(task))
    {
    }

    WebCore::EventLoopTask* performTask()
    {
        Reply reply = m_task();
        delete this;
        return reply ? new WebCore::EventLoopTask(WTF::move(reply)) : nullptr;
    }

private:
    Function<Reply()> m_task;
};

extern "C" WebCore::EventLoopTask* Bun__EventLoopTaskNoContext__performTask(EventLoopTaskNoContext* task);

} // namespace Bun
