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
        , m_contextId(defaultGlobalObject(globalObject)->scriptExecutionContext()->identifier())
        , m_task(WTF::move(task))
    {
    }

    void performTask()
    {
        m_task();
        delete this;
    }

    void* createdInBunVm() const { return m_createdInBunVm; }
    WebCore::ScriptExecutionContextIdentifier contextId() const { return m_contextId; }

private:
    void* m_createdInBunVm;
    WebCore::ScriptExecutionContextIdentifier m_contextId;
    Function<void()> m_task;
};

extern "C" void Bun__EventLoopTaskNoContext__performTask(EventLoopTaskNoContext* task);
extern "C" void* Bun__EventLoopTaskNoContext__createdInBunVm(const EventLoopTaskNoContext* task);
extern "C" uint32_t Bun__EventLoopTaskNoContext__contextId(const EventLoopTaskNoContext* task);

} // namespace Bun
