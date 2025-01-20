#pragma once

#include "ZigGlobalObject.h"
#include "root.h"

namespace Bun {

// Just like WebCore::EventLoopTask but does not take a ScriptExecutionContext
class EventLoopTaskNoContext {
    WTF_MAKE_ISO_ALLOCATED(EventLoopTaskNoContext);

public:
    EventLoopTaskNoContext(JSC::JSGlobalObject* globalObject, Function<void()>&& task)
        : m_createdInBunVm(defaultGlobalObject(globalObject)->bunVM())
        , m_task(WTFMove(task))
    {
    }

    void performTask()
    {
        m_task();
        delete this;
    }

    void* createdInBunVm() const { return m_createdInBunVm; }

private:
    void* m_createdInBunVm;
    Function<void()> m_task;
};

extern "C" void Bun__EventLoopTaskNoContext__performTask(EventLoopTaskNoContext* task);
extern "C" void* Bun__EventLoopTaskNoContext__createdInBunVm(const EventLoopTaskNoContext* task);

} // namespace Bun
