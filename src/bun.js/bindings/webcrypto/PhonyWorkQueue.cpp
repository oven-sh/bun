#include "PhonyWorkQueue.h"

#include <wtf/text/ASCIILiteral.h>
#include "EventLoopTaskNoContext.h"

namespace Bun {

Ref<PhonyWorkQueue> PhonyWorkQueue::create(WTF::ASCIILiteral name)
{
    (void)name;
    return adoptRef(*new PhonyWorkQueue);
}

extern "C" void ConcurrentCppTask__createAndRun(EventLoopTaskNoContext* task);

void PhonyWorkQueue::dispatch(JSC::JSGlobalObject* globalObject, WTF::Function<void()>&& function)
{
    ConcurrentCppTask__createAndRun(new EventLoopTaskNoContext(globalObject, WTF::move(function)));
}

} // namespace Bun
