#include "EventLoopTaskNoContext.h"

namespace Bun {

extern "C" WebCore::EventLoopTask* Bun__EventLoopTaskNoContext__performTask(EventLoopTaskNoContext* task)
{
    return task->performTask();
}

} // namespace Bun
