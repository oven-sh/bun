#pragma once

#include "ZigGlobalObject.h"
#include "ScriptExecutionContext.h"
#include "root.h"

namespace Bun {

// Just like WebCore::EventLoopTask but does not take a ScriptExecutionContext
class EventLoopTaskNoContext {
    WTF_MAKE_TZONE_ALLOCATED(EventLoopTaskNoContext);

public:
    EventLoopTaskNoContext(JSC::JSGlobalObject* globalObject, Function<void()>&& task)
        : m_createdInBunVm(defaultGlobalObject(globalObject)->bunVM())
        , m_contextIdentifier(defaultGlobalObject(globalObject)->scriptExecutionContext()->identifier())
        , m_task(WTF::move(task))
    {
    }

    void performTask()
    {
        m_task();
        delete this;
    }

    void* createdInBunVm() const { return m_createdInBunVm; }
    WebCore::ScriptExecutionContextIdentifier contextIdentifier() const { return m_contextIdentifier; }

private:
    void* m_createdInBunVm;
    // Captured for the pool-thread completion: the creating VM may be a worker
    // freed by terminate() while the task ran, so the unref goes through the
    // contexts-map lock instead of dereferencing m_createdInBunVm.
    WebCore::ScriptExecutionContextIdentifier m_contextIdentifier;
    Function<void()> m_task;
};

extern "C" void Bun__EventLoopTaskNoContext__performTask(EventLoopTaskNoContext* task);
extern "C" void* Bun__EventLoopTaskNoContext__createdInBunVm(const EventLoopTaskNoContext* task);
extern "C" WebCore::ScriptExecutionContextIdentifier Bun__EventLoopTaskNoContext__contextIdentifier(const EventLoopTaskNoContext* task);

} // namespace Bun
