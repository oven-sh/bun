#pragma once

#include "ZigGlobalObject.h"
#include "root.h"
#include "BunClientData.h"

namespace Bun {

// Just like WebCore::EventLoopTask but does not take a ScriptExecutionContext
class EventLoopTaskNoContext {
    WTF_MAKE_TZONE_ALLOCATED(EventLoopTaskNoContext);

public:
    EventLoopTaskNoContext(JSC::JSGlobalObject* globalObject, Function<void()>&& task)
        : m_vmHandle(WebCore::clientData(JSC::getVM(globalObject))->vmHandle)
        , m_task(WTF::move(task))
    {
    }

    void performTask()
    {
        m_task();
        delete this;
    }

    // The creating VM's handle (owned by its JSVMClientData, which outlives
    // every task it hands to the pool).
    ::BunVmHandle* vmHandle() const { return m_vmHandle; }

private:
    ::BunVmHandle* m_vmHandle;
    Function<void()> m_task;
};

extern "C" void Bun__EventLoopTaskNoContext__performTask(EventLoopTaskNoContext* task);
extern "C" ::BunVmHandle* Bun__EventLoopTaskNoContext__vmHandle(const EventLoopTaskNoContext* task);

} // namespace Bun
