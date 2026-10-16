#include "config.h"
#include "Document.h"

#include "DOMClientData.h"
#include "ScriptExecutionContext.h"
#include "Window.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/VM.h>

extern "C" void JSC__JSGlobalObject__queueMicrotaskCallback(Zig::GlobalObject*, void* context, void (*callback)(void*));

namespace WebCore {

unsigned& DOMClientData::documentTasksRunInLoopIteration(uint64_t iteration)
{
    if (m_documentTaskLoopIteration != iteration) {
        m_documentTaskLoopIteration = iteration;
        m_documentTasksRun = 0;
    }
    return m_documentTasksRun;
}

// postTask() also runs what is queued while it drains, so tasks that keep queuing tasks would starve timers and I/O.
static constexpr unsigned maxTasksPerLoopIteration = 1000;

// Bun has one event loop per VM, so a document's tasks go to its script execution context.
// Upstream uses the task source to throttle and suspend, which Bun doesn't do.
void Document::queueTask(TaskSource, Function<void()>&& task)
{
    auto run = [task = WTF::move(task), pendingTask = Window::PendingTask { m_window }](ScriptExecutionContext& context) mutable {
        ++domClientData(context.vm()).documentTasksRunInLoopIteration(context.loopIterationNumber());
        task();
    };
    // The loop looks at its timers after postTask()'s tasks, so a task runs before a timer that is set after it.
    if (domClientData(vm()).documentTasksRunInLoopIteration(m_scriptExecutionContext->loopIterationNumber()) < maxTasksPerLoopIteration)
        m_scriptExecutionContext->postTask(WTF::move(run));
    else
        m_scriptExecutionContext->postTaskAfterYield(WTF::move(run));
}

void Document::queueMicrotask(Function<void()>&& task)
{
    JSC__JSGlobalObject__queueMicrotaskCallback(defaultGlobalObject(globalObject()), new Function<void()>(WTF::move(task)), [](void* context) {
        std::unique_ptr<Function<void()>> task { static_cast<Function<void()>*>(context) };
        (*task)();
    });
}

void Document::performMicrotaskCheckpoint()
{
    vm().drainMicrotasks();
}

} // namespace WebCore
