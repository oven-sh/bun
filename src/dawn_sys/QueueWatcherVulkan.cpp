#include "Host.h"

#include <condition_variable>
#include <deque>
#include <mutex>
#include <pthread.h>
#include <vector>

#include "src/dawn/native/vulkan/DeviceVk.h"
#include "src/dawn/native/vulkan/QueueVk.h"

namespace Bun::Dawn {

using namespace dawn::native;

// A submit without commands signals its fence once everything before it has finished. A thread waits for the fences.
class QueueWatcherVulkan final : public QueueWatcher {
public:
    explicit QueueWatcherVulkan(DeviceBase* device)
        : QueueWatcher(device)
    {
    }

private:
    vulkan::Device* device() const { return vulkan::ToBackend(m_device); }

    bool wakeAfter(ExecutionSerial) override
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

        vulkan::VkFence fence = takeUnusedFence();
        if (fence == VK_NULL_HANDLE)
            return false;

        VkQueue queue = vulkan::ToBackend(m_device->GetQueue())->GetVkQueue();
        bool submitted = device()->fn.QueueSubmit(queue, 0, nullptr, fence) == VK_SUCCESS;

        std::lock_guard lock(m_mutex);
        if (submitted) {
            m_pending.push_back(fence);
            m_changed.notify_one();
        } else
            m_signaled.push_back(fence);
        return submitted;
    }

    // Nothing orders our fence after the one Dawn polls.
    bool resume() override
    {
        std::lock_guard lock(m_mutex);
        return !m_pending.empty();
    }

    vulkan::VkFence takeUnusedFence()
    {
        vulkan::VkFence fence = VK_NULL_HANDLE;
        {
            std::lock_guard lock(m_mutex);
            if (!m_signaled.empty()) {
                fence = m_signaled.back();
                m_signaled.pop_back();
            }
        }
        if (fence != VK_NULL_HANDLE) {
            if (device()->fn.ResetFences(device()->GetVkDevice(), 1, &*fence) == VK_SUCCESS)
                return fence;
            device()->fn.DestroyFence(device()->GetVkDevice(), fence, nullptr);
        }

        VkFenceCreateInfo createInfo {};
        createInfo.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
        if (device()->fn.CreateFence(device()->GetVkDevice(), &createInfo, nullptr, &*fence) != VK_SUCCESS)
            return VK_NULL_HANDLE;
        return fence;
    }

    void run()
    {
        pthread_setname_np(pthread_self(), "GPUQueue");

        std::unique_lock lock(m_mutex);
        while (true) {
            m_changed.wait(lock, [&] { return m_stopping || !m_pending.empty(); });
            if (m_pending.empty())
                return;

            vulkan::VkFence fence = m_pending.front();
            lock.unlock();
            // A signal can end the wait early. An error means that the device is lost, which Dawn finds out when woken.
            while (device()->fn.WaitForFences(device()->GetVkDevice(), 1, &*fence, true, UINT64_MAX) == VK_TIMEOUT) {
            }
            lock.lock();
            m_pending.pop_front();
            m_signaled.push_back(fence);
            lock.unlock();
            m_host->wake();
            lock.lock();
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
        for (vulkan::VkFence fence : m_signaled)
            device()->fn.DestroyFence(device()->GetVkDevice(), fence, nullptr);
    }

    pthread_t m_thread;
    bool m_hasThread { false };

    std::mutex m_mutex;
    std::condition_variable m_changed;
    std::deque<vulkan::VkFence> m_pending;
    std::vector<vulkan::VkFence> m_signaled;
    bool m_stopping { false };
};

std::unique_ptr<QueueWatcher> QueueWatcher::create(DeviceBase* device)
{
    return std::make_unique<QueueWatcherVulkan>(device);
}

} // namespace Bun::Dawn
