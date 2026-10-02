#include "EventLoopTaskNoContext.h"

namespace Bun {

extern "C" void Bun__EventLoopTaskNoContext__performTask(EventLoopTaskNoContext* task)
{
    task->performTask();
}

extern "C" WebCore::EventLoopTask* Bun__EventLoopTaskNoContext__intoUnrunTask(EventLoopTaskNoContext* task)
{
    return task->intoUnrunTask();
}

} // namespace Bun
