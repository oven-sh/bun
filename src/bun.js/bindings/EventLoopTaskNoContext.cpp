#include "EventLoopTaskNoContext.h"

namespace Bun {

WTF_MAKE_ISO_ALLOCATED_IMPL(EventLoopTaskNoContext);

extern "C" void Bun__EventLoopTaskNoContext__performTask(EventLoopTaskNoContext* task)
{
    task->performTask();
}

} // namespace Bun
