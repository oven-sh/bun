#include "Host.h"

#include "src/dawn/native/d3d12/DeviceD3D12.h"
#include "src/dawn/native/d3d12/QueueD3D12.h"
#include "src/dawn/native/d3d12/SharedFenceD3D12.h"

namespace Bun::Dawn {

using namespace dawn::native;

// The queue's fence counts serials and sets an event. The system's thread pool waits for the event.
class QueueWatcherD3D12 final : public QueueWatcher {
public:
    explicit QueueWatcherD3D12(DeviceBase* device)
        : QueueWatcher(device)
    {
    }

    ~QueueWatcherD3D12() override
    {
        if (m_event)
            CloseHandle(m_event);
    }

private:
    ID3D12Fence* fence() const { return d3d12::ToBackend(m_device->GetQueue())->GetSharedFence()->GetD3DFence(); }

    bool wakeAfter(ExecutionSerial serial) override
    {
        if (!m_event)
            m_event = CreateEventW(nullptr, false, false, nullptr);
        if (!m_wait)
            m_wait = CreateThreadpoolWait(signaled, m_host.Get(), nullptr);
        if (!m_event || !m_wait)
            return false;

        return SUCCEEDED(fence()->SetEventOnCompletion(static_cast<uint64_t>(serial), m_event));
    }

    // A wait ends with its first callback. The one that this replaces may have reset the event for the last time.
    bool resume(ExecutionSerial serial) override
    {
        SetThreadpoolWait(m_wait, m_event, nullptr);
        return fence()->GetCompletedValue() < static_cast<uint64_t>(serial);
    }

    void stop() override
    {
        if (!m_wait)
            return;
        SetThreadpoolWait(m_wait, nullptr, nullptr);
        WaitForThreadpoolWaitCallbacks(m_wait, true);
        CloseThreadpoolWait(m_wait);
    }

    static void CALLBACK signaled(PTP_CALLBACK_INSTANCE, void* host, PTP_WAIT, TP_WAIT_RESULT)
    {
        static_cast<Host*>(host)->wake();
    }

    HANDLE m_event { nullptr };
    PTP_WAIT m_wait { nullptr };
};

std::unique_ptr<QueueWatcher> QueueWatcher::create(DeviceBase* device)
{
    return std::make_unique<QueueWatcherD3D12>(device);
}

} // namespace Bun::Dawn
