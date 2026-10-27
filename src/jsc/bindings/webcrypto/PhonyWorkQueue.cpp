#include "PhonyWorkQueue.h"

#include "ScriptExecutionContext.h"
#include <wtf/text/ASCIILiteral.h>

namespace Bun {

Ref<PhonyWorkQueue> PhonyWorkQueue::create(WTF::ASCIILiteral name)
{
    (void)name;
    return adoptRef(*new PhonyWorkQueue);
}

extern "C" void Bun__WorkQueueTask__schedule(JSC::JSGlobalObject*, WorkQueueTask*);

void PhonyWorkQueue::schedule(WebCore::ScriptExecutionContext& context, WorkQueueTask& task)
{
    Bun__WorkQueueTask__schedule(context.globalObject(), &task);
}

extern "C" void Bun__WorkQueueTask__run(WorkQueueTask* task)
{
    task->run();
}

extern "C" void Bun__WorkQueueTask__complete(WorkQueueTask* task)
{
    task->complete();
}

extern "C" void Bun__WorkQueueTask__destroy(WorkQueueTask* task)
{
    delete task;
}

} // namespace Bun
