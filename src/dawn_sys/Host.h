#pragma once

#include <memory>

#include "dawn/platform/DawnPlatform.h"
#include "src/dawn/common/RefCounted.h"
#include "src/dawn/native/Device.h"

// Every function may be called on any thread.
struct BunDawnHost {
    void* context;
    // Asks the thread that owns the instance to call wgpuInstanceProcessEvents().
    void (*wake)(void* context);
    // Calls run(task) on a worker thread, then wakes.
    void (*postWorkerTask)(void* context, void (*run)(void*), void* task);
    void (*release)(void* context);
    WGPULoggingCallback log;
};

namespace Bun::Dawn {

class Host final : public dawn::RefCounted, public dawn::platform::Platform {
public:
    explicit Host(const BunDawnHost& host)
        : m_host(host)
    {
    }

    static Host* from(dawn::native::DeviceBase* device) { return static_cast<Host*>(device->GetPlatform()); }

    void wake() const { m_host.wake(m_host.context); }
    void postWorkerTask(dawn::platform::PostWorkerTaskCallback run, void* task) const { m_host.postWorkerTask(m_host.context, run, task); }

private:
    ~Host() override { m_host.release(m_host.context); }

    std::unique_ptr<dawn::platform::WorkerTaskPool> CreateWorkerTaskPool() override;

    const BunDawnHost m_host;
};

enum class Wake : uint8_t {
    None,
    Follows,
    Missed,
};

// Wakes the host when the GPU has finished what a device submitted. Dawn's own wait holds a lock that the next submit needs.
class QueueWatcher {
public:
    static std::unique_ptr<QueueWatcher> create(dawn::native::DeviceBase*);
    virtual ~QueueWatcher() = default;

    // Asks for a wake at this serial, or at the last one submitted if that comes first. Wakes that were asked for before need not come.
    Wake arm(dawn::native::ExecutionSerial);

    // Dawn frees memory once the GPU has finished the next submit. arm() makes one if the queue runs dry before.
    void willReleaseMemory();

    // Called before the device is destroyed. The watcher is deleted after.
    virtual void stop() {}

protected:
    explicit QueueWatcher(dawn::native::DeviceBase* device)
        : m_device(device)
        , m_host(Host::from(device))
    {
    }

    // Called when the serial changes.
    virtual bool wakeAfter(dawn::native::ExecutionSerial) = 0;
    // Called last by every arm() that finds the serial in flight.
    virtual Wake resume(dawn::native::ExecutionSerial) = 0;

    dawn::native::DeviceBase* const m_device;
    const dawn::Ref<Host> m_host;

private:
    dawn::native::ExecutionSerial m_armedSerial { dawn::native::kBeginningOfGPUTime };
    dawn::native::ExecutionSerial m_serialThatFreesMemory { dawn::native::kBeginningOfGPUTime };
};

} // namespace Bun::Dawn
