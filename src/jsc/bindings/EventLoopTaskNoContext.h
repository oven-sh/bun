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
        : m_vmHandle(Bun__VmHandle__retainRef(WebCore::clientData(JSC::getVM(globalObject))->vmHandle))
        , m_task(WTF::move(task))
    {
    }

    ~EventLoopTaskNoContext()
    {
        Bun__VmHandle__release(m_vmHandle);
    }

    void performTask()
    {
        m_task();
        delete this;
    }

    // A reference to the creating VM's handle, since a pool task can outlive that VM.
    const ::BunVmHandleRef* vmHandle() const { return m_vmHandle; }

private:
    const ::BunVmHandleRef* m_vmHandle;
    Function<void()> m_task;
};

extern "C" void Bun__EventLoopTaskNoContext__performTask(EventLoopTaskNoContext* task);
extern "C" const ::BunVmHandleRef* Bun__EventLoopTaskNoContext__vmHandle(const EventLoopTaskNoContext* task);

} // namespace Bun
