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

extern "C" WebCore::ScriptExecutionContextIdentifier Bun__EventLoopTaskNoContext__contextIdentifier(const EventLoopTaskNoContext* task)
{
    return task->contextIdentifier();
}

} // namespace Bun
