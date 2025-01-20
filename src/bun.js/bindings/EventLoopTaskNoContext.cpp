#include "EventLoopTaskNoContext.h"

namespace Bun {

WTF_MAKE_ISO_ALLOCATED_IMPL(EventLoopTaskNoContext);

extern "C" void Bun__EventLoopTaskNoContext__performTask(EventLoopTaskNoContext* task)
{
    task->performTask();
}

extern "C" void* Bun__EventLoopTaskNoContext__createdInBunVm(const EventLoopTaskNoContext* task)
{
    return task->createdInBunVm();
}

} // namespace Bun
