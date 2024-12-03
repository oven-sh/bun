#include "PhonyWorkQueue.h"

#include <wtf/text/ASCIILiteral.h>
#include "EventLoopTask.h"

using WebCore::EventLoopTask;

namespace Bun {

Ref<PhonyWorkQueue> PhonyWorkQueue::create(WTF::ASCIILiteral name)
{
    (void)name;
    return adoptRef(*new PhonyWorkQueue);
}

extern "C" void ConcurrentCppTask__createAndRun(EventLoopTask*);

void PhonyWorkQueue::dispatch(WTF::Function<void()>&& function)
{
    ConcurrentCppTask__createAndRun(new EventLoopTask(WTFMove(function)));
}

} // namespace Bun
