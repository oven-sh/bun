#include "PhonyWorkQueue.h"

#include <wtf/text/ASCIILiteral.h>
#include "EventLoopTaskNoContext.h"
#include "ncrypto.h"

namespace Bun {

Ref<PhonyWorkQueue> PhonyWorkQueue::create(WTF::ASCIILiteral name)
{
    (void)name;
    return adoptRef(*new PhonyWorkQueue);
}

extern "C" void ConcurrentCppTask__createAndRun(JSC::JSGlobalObject*, EventLoopTaskNoContext* task);

void PhonyWorkQueue::dispatch(JSC::JSGlobalObject* globalObject, WTF::Function<void()>&& function)
{
    ConcurrentCppTask__createAndRun(globalObject, new EventLoopTaskNoContext([function = WTF::move(function)]() mutable {
        // node:crypto jobs share these pool threads and report whatever the error queue holds.
        ncrypto::ClearErrorOnReturn clearErrorOnReturn;
        function();
    }));
}

} // namespace Bun
