#include "Host.h"

#include <chrono>
#include <cstdlib>
#include <mutex>
#include <thread>
#include <vector>

#include "src/dawn/native/AsyncTask.h"
#include "src/dawn/native/PhysicalDevice.h"
#include "src/dawn/native/Queue.h"

namespace Bun::Dawn {

using namespace dawn::native;

static constinit std::mutex s_paravirtualDevicesLock;
static constinit std::vector<DeviceBase*> s_paravirtualDevices;

// The GPU of a virtual machine hangs, for all processes, if one ends with work under way.
static void waitForParavirtualDevices()
{
    std::lock_guard lock(s_paravirtualDevicesLock);
    const auto end = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    for (DeviceBase* device : s_paravirtualDevices) {
        QueueBase* queue = device->GetQueue();
        auto isBusy = [&] {
            return queue->GetLastSubmittedCommandSerial() > queue->GetCompletedCommandSerial() || device->GetAsyncTaskManager()->HasPendingTasks();
        };
        while (isBusy() && std::chrono::steady_clock::now() < end)
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
}

// Metal reports a finished command buffer on a thread of its own, where Dawn runs the tasks that wait for its serial.
class QueueWatcherMetal final : public QueueWatcher {
public:
    explicit QueueWatcherMetal(DeviceBase* device)
        : QueueWatcher(device)
    {
        if (device->GetPhysicalDevice()->GetName() != "Apple Paravirtual device")
            return;
        [[maybe_unused]] static int once = std::atexit(waitForParavirtualDevices);
        std::lock_guard lock(s_paravirtualDevicesLock);
        s_paravirtualDevices.push_back(device);
    }

    ~QueueWatcherMetal() override
    {
        std::lock_guard lock(s_paravirtualDevicesLock);
        std::erase(s_paravirtualDevices, m_device);
    }

private:
    bool wakeAfter(ExecutionSerial serial) override
    {
        m_device->GetQueue()->TrackSerialTask(QueuePriority::UserVisible, serial, [host = m_host] { host->wake(); });
        return true;
    }

    // That thread takes the tasks before it raises the serial. This waits until it has done both.
    bool resume(ExecutionSerial serial) override
    {
        QueueBase* queue = m_device->GetQueue();
        IgnoreErrors(queue->UpdateCompletedSerial(QueuePriority::UserVisible));
        return serial > queue->GetCompletedCommandSerial();
    }
};

std::unique_ptr<QueueWatcher> QueueWatcher::create(DeviceBase* device)
{
    return std::make_unique<QueueWatcherMetal>(device);
}

} // namespace Bun::Dawn
