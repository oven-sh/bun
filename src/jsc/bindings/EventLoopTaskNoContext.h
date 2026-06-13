#pragma once

#include "ZigGlobalObject.h"
#include "root.h"

namespace Bun {

// Just like WebCore::EventLoopTask but does not take a ScriptExecutionContext
class EventLoopTaskNoContext {
    WTF_MAKE_TZONE_ALLOCATED(EventLoopTaskNoContext);

public:
    EventLoopTaskNoContext(JSC::JSGlobalObject* globalObject, Function<void()>&& task)
        : m_createdInBunVm(defaultGlobalObject(globalObject)->bunVM())
        , m_createdInBunVmGeneration(defaultGlobalObject(globalObject)->bunVMGeneration())
        , m_task(WTF::move(task))
    {
    }

    void performTask()
    {
        m_task();
        delete this;
    }

    void* createdInBunVm() const { return m_createdInBunVm; }
    uint64_t createdInBunVmGeneration() const { return m_createdInBunVmGeneration; }

private:
    void* m_createdInBunVm;
    uint64_t m_createdInBunVmGeneration;
    Function<void()> m_task;
};

extern "C" void Bun__EventLoopTaskNoContext__performTask(EventLoopTaskNoContext* task);
extern "C" void* Bun__EventLoopTaskNoContext__createdInBunVm(const EventLoopTaskNoContext* task);
extern "C" uint64_t Bun__EventLoopTaskNoContext__createdInBunVmGeneration(const EventLoopTaskNoContext* task);

} // namespace Bun
