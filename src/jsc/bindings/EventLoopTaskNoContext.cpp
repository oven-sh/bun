#include "EventLoopTaskNoContext.h"

namespace Bun {

extern "C" void Bun__EventLoopTaskNoContext__performTask(EventLoopTaskNoContext* task)
{
    task->performTask();
}

extern "C" const ::BunVmHandleRef* Bun__EventLoopTaskNoContext__vmHandle(const EventLoopTaskNoContext* task)
{
    return task->vmHandle();
}

} // namespace Bun
