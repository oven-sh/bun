#include "EventLoopTaskNoContext.h"

namespace Bun {

extern "C" void Bun__EventLoopTaskNoContext__performTask(EventLoopTaskNoContext* task)
{
    std::unique_ptr<EventLoopTaskNoContext> { task }->performTask();
}

} // namespace Bun
