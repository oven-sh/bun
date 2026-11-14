#include "Host.h"

#include <chrono>
#include <condition_variable>
#include <mutex>
#include <pthread.h>

#include "src/dawn/native/vulkan/DeviceVk.h"
#include "src/dawn/native/vulkan/QueueVk.h"

namespace Bun::Dawn {

using namespace dawn::native;

// A thread waits for one submit after the other, so that it can be asked for an earlier serial meanwhile.
class QueueWatcherVulkan final : public QueueWatcher {
public:
    explicit QueueWatcherVulkan(DeviceBase* device)
        : QueueWatcher(device)
    {
    }

private:
    bool wakeAfter(ExecutionSerial serial) override
    {
        if (!m_hasThread) {
            auto run = [](void* watcher) -> void* {
                static_cast<QueueWatcherVulkan*>(watcher)->run();
                return nullptr;
            };
            if (pthread_create(&m_thread, nullptr, run, this))
                return false;
            m_hasThread = true;
        }

        std::lock_guard lock(m_mutex);
        m_wanted = serial;
        m_changed.notify_one();
        return true;
    }

    bool resume(ExecutionSerial serial) override
    {
        std::lock_guard lock(m_mutex);
        return serial > m_passed;
    }

    void run()
    {
        pthread_setname_np(pthread_self(), "GPUQueue");

        vulkan::Device* device = vulkan::ToBackend(m_device);
        vulkan::Queue* queue = vulkan::ToBackend(device->GetQueue());

        std::unique_lock lock(m_mutex);
        while (true) {
            m_changed.wait(lock, [&] { return m_stopping || m_wanted > m_passed; });
            if (m_stopping)
                return;

            lock.unlock();
            auto [fence, serial] = queue->LendFenceAfter(m_passed);
            ::VkResult result = fence == VK_NULL_HANDLE ? VK_SUCCESS : VK_TIMEOUT;
            // A signal can end the wait early.
            while (result == VK_TIMEOUT)
                result = device->fn.WaitForFences(device->GetVkDevice(), 1, &*fence, true, UINT64_MAX);
            lock.lock();

            if (result == VK_SUCCESS)
                m_passed = serial;
            if (result != VK_SUCCESS || m_wanted <= m_passed) {
                lock.unlock();
                m_host->wake();
                lock.lock();
            }
            // Until Dawn has found the fence signaled or the device lost.
            if (result != VK_SUCCESS)
                m_changed.wait_for(lock, std::chrono::milliseconds(1), [&] { return m_stopping; });
        }
    }

    void stop() override
    {
        if (!m_hasThread)
            return;
        {
            std::lock_guard lock(m_mutex);
            m_stopping = true;
            m_changed.notify_one();
        }
        pthread_join(m_thread, nullptr);
    }

    pthread_t m_thread;
    bool m_hasThread { false };

    std::mutex m_mutex;
    std::condition_variable m_changed;
    ExecutionSerial m_wanted { kBeginningOfGPUTime };
    // Only the thread writes it.
    ExecutionSerial m_passed { kBeginningOfGPUTime };
    bool m_stopping { false };
};

std::unique_ptr<QueueWatcher> QueueWatcher::create(DeviceBase* device)
{
    return std::make_unique<QueueWatcherVulkan>(device);
}

} // namespace Bun::Dawn
