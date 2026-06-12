#include "EventLoopTaskNoContext.h"

namespace Bun {

extern "C" void Bun__EventLoopTaskNoContext__performTask(EventLoopTaskNoContext* task)
{
    task->performTask();
}

extern "C" void* Bun__EventLoopTaskNoContext__createdInBunVm(const EventLoopTaskNoContext* task)
{
    return task->createdInBunVm();
}

extern "C" uint64_t Bun__EventLoopTaskNoContext__createdInBunVmGeneration(const EventLoopTaskNoContext* task)
{
    return task->createdInBunVmGeneration();
}

} // namespace Bun
