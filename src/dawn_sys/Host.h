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

// Wakes the host when the GPU has finished what a device submitted. Dawn's own wait holds a lock that the next submit needs.
class QueueWatcher {
public:
    static std::unique_ptr<QueueWatcher> create(dawn::native::DeviceBase*);
    virtual ~QueueWatcher() = default;

    // Returns whether a wake follows once everything submitted so far has finished.
    bool arm();

    // Called before the device is destroyed. The watcher is deleted after.
    virtual void stop() {}

protected:
    explicit QueueWatcher(dawn::native::DeviceBase* device)
        : m_device(device)
        , m_host(Host::from(device))
    {
    }

    // Called once per serial, in increasing order.
    virtual bool wakeAfter(dawn::native::ExecutionSerial) = 0;
    // Called on every arm() that finds work in flight, after wakeAfter(). False if the last wake has come already.
    virtual bool resume() { return true; }

    dawn::native::DeviceBase* const m_device;
    const dawn::Ref<Host> m_host;

private:
    dawn::native::ExecutionSerial m_armedSerial { dawn::native::kBeginningOfGPUTime };
};

} // namespace Bun::Dawn
