#include "Host.h"

#include "src/dawn/native/Queue.h"

namespace Bun::Dawn {

using namespace dawn::native;

// Metal reports a finished command buffer on a thread of its own, where Dawn runs the tasks that wait for its serial.
class QueueWatcherMetal final : public QueueWatcher {
public:
    explicit QueueWatcherMetal(DeviceBase* device)
        : QueueWatcher(device)
    {
    }

private:
    bool wakeAfter(ExecutionSerial serial) override
    {
        m_device->GetQueue()->TrackSerialTask(QueuePriority::UserVisible, serial, [host = m_host] { host->wake(); });
        return true;
    }

    // That thread takes the tasks before it raises the serial. This waits until it has done both.
    Wake resume(ExecutionSerial serial) override
    {
        QueueBase* queue = m_device->GetQueue();
        IgnoreErrors(queue->UpdateCompletedSerial(QueuePriority::UserVisible));
        return serial > queue->GetCompletedCommandSerial() ? Wake::Follows : Wake::Missed;
    }
};

std::unique_ptr<QueueWatcher> QueueWatcher::create(DeviceBase* device)
{
    return std::make_unique<QueueWatcherMetal>(device);
}

} // namespace Bun::Dawn
