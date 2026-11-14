#include "Host.h"

#include <algorithm>
#include <utility>

#include "dawn/native/DawnNative.h"
#include "src/dawn/native/Adapter.h"
#include "src/dawn/native/Buffer.h"
#include "src/dawn/native/Instance.h"
#include "src/dawn/native/PhysicalDevice.h"
#include "src/dawn/native/Queue.h"
#include "src/dawn/native/Texture.h"

namespace Bun::Dawn {

using namespace dawn::native;

class WorkerTaskPool final : public dawn::platform::WorkerTaskPool {
public:
    explicit WorkerTaskPool(Host* host)
        : m_host(host)
    {
    }

private:
    // AsyncTaskManager, the only caller, waits for its tasks by itself and drops the event.
    std::unique_ptr<dawn::platform::WaitableEvent> PostWorkerTask(dawn::platform::PostWorkerTaskCallback run, void* task) override
    {
        m_host->postWorkerTask(run, task);
        return nullptr;
    }

    const dawn::Ref<Host> m_host;
};

std::unique_ptr<dawn::platform::WorkerTaskPool> Host::CreateWorkerTaskPool()
{
    return std::make_unique<WorkerTaskPool>(this);
}

Wake QueueWatcher::arm(ExecutionSerial serial)
{
    QueueBase* queue = m_device->GetQueue();
    ExecutionSerial submitted = queue->GetLastSubmittedCommandSerial();
    ExecutionSerial completed = queue->GetCompletedCommandSerial();

    // Another thread found the device lost, and the next tick reports it.
    DeviceBase::State state = m_device->GetState();
    if (state == DeviceBase::State::Disconnecting)
        return Wake::Missed;
    if (state != DeviceBase::State::Alive)
        return Wake::None;

    if (submitted <= completed) {
        if (std::exchange(m_serialThatFreesMemory, kBeginningOfGPUTime) <= submitted)
            return Wake::None;
        wgpuQueueSubmit(ToAPI(queue), 0, nullptr);
        return arm(serial);
    }

    serial = std::min(serial, submitted);
    if (serial <= completed)
        return Wake::Missed;

    if (serial != m_armedSerial) {
        if (!wakeAfter(serial))
            return Wake::None;
        m_armedSerial = serial;
    }
    return resume(serial);
}

void QueueWatcher::willReleaseMemory()
{
    m_serialThatFreesMemory = m_device->GetQueue()->GetPendingCommandSerial();
}

extern "C" WGPUInstance BunDawn__createInstance(const BunDawnHost* descriptor)
{
    dawn::Ref<Host> host = dawn::AcquireRef(new Host(*descriptor));

    // Allows the structures that only Dawn has, like these two.
    const char* enabledToggle = "allow_experimental_apis";
    wgpu::DawnTogglesDescriptor toggles;
    toggles.enabledToggleCount = 1;
    toggles.enabledToggles = &enabledToggle;

    DawnInstanceDescriptor dawnDescriptor;
    dawnDescriptor.nextInChain = &toggles;
    dawnDescriptor.platform = host.Get();
    dawnDescriptor.loggingCallbackInfo.callback = descriptor->log;

    WGPUInstanceDescriptor instanceDescriptor = WGPU_INSTANCE_DESCRIPTOR_INIT;
    instanceDescriptor.nextInChain = reinterpret_cast<WGPUChainedStruct*>(&dawnDescriptor);

    WGPUInstance instance = wgpuCreateInstance(&instanceDescriptor);
    if (instance)
        static_cast<void>(host.Detach());
    return instance;
}

// Every device of the instance has been destroyed. Their objects may keep the instance alive for longer than the host.
extern "C" void BunDawn__releaseInstance(WGPUInstance instance)
{
    dawn::Ref<Host> host = dawn::AcquireRef(static_cast<Host*>(FromAPI(instance)->GetPlatform()));
    FromAPI(instance)->DisconnectDawnPlatform();
    wgpuInstanceRelease(instance);
}

// To Dawn only SwiftShader is a fallback adapter. Here every adapter that runs on the CPU is (lavapipe, WARP).
extern "C" WGPUAdapter BunDawn__requestAdapter(WGPUInstance instance, WGPUFeatureLevel featureLevel, WGPUPowerPreference powerPreference, bool forceFallbackAdapter)
{
    RequestAdapterOptions options;
    options.featureLevel = static_cast<wgpu::FeatureLevel>(featureLevel);
    options.powerPreference = static_cast<wgpu::PowerPreference>(powerPreference);
#if defined(DAWN_ENABLE_BACKEND_D3D12)
    // Keeps the adapters in DXGI's order, which follows the user's graphics settings.
    options.backendType = wgpu::BackendType::D3D12;
#endif

    std::vector<dawn::Ref<AdapterBase>> adapters = FromAPI(instance)->EnumerateAdapters(&options);
    auto find = [&](bool fallback) {
        return std::ranges::find_if(adapters, [&](const auto& adapter) {
            return (adapter->GetPhysicalDevice()->GetAdapterType() == wgpu::AdapterType::CPU) == fallback;
        });
    };
    auto adapter = find(forceFallbackAdapter);
    if (adapter == adapters.end())
        adapter = find(true);
    return adapter == adapters.end() ? nullptr : ToAPI(ReturnToAPI(std::move(*adapter)));
}

// Calls back before it returns.
extern "C" void BunDawn__requestDevice(WGPUAdapter adapter, WGPUDeviceDescriptor* descriptor, WGPURequestDeviceCallback callback, void* context)
{
    // Rounds timestamps so that a web page cannot time a side channel with them.
    const char* disabledToggle = "timestamp_quantization";
    WGPUDawnTogglesDescriptor toggles = WGPU_DAWN_TOGGLES_DESCRIPTOR_INIT;
    toggles.disabledToggleCount = 1;
    toggles.disabledToggles = &disabledToggle;
    descriptor->nextInChain = &toggles.chain;

    wgpuAdapterRequestDevice(adapter, descriptor, { nullptr, WGPUCallbackMode_AllowSpontaneous, callback, context, nullptr });
}

extern "C" uint64_t BunDawn__bufferMemorySize(WGPUBuffer buffer)
{
    return FromAPI(buffer)->IsError() ? 0 : FromAPI(buffer)->GetAllocatedSize();
}

extern "C" uint64_t BunDawn__textureMemorySize(WGPUTexture handle)
{
    TextureBase* texture = FromAPI(handle);
    if (texture->IsError() || !texture->IsAlive())
        return 0;
    // The estimate counts one slice of a 3D texture.
    uint64_t slices = texture->GetDimension() == wgpu::TextureDimension::e3D ? texture->GetBaseSize().depthOrArrayLayers : 1;
    return texture->ComputeEstimatedByteSize() * slices;
}

extern "C" QueueWatcher* BunDawn__createQueueWatcher(WGPUDevice device)
{
    return QueueWatcher::create(FromAPI(device)).release();
}

extern "C" Wake BunDawn__armQueueWatcher(QueueWatcher* watcher, uint64_t serial)
{
    return watcher->arm(ExecutionSerial(serial));
}

extern "C" void BunDawn__willReleaseMemory(QueueWatcher* watcher)
{
    watcher->willReleaseMemory();
}

extern "C" uint64_t BunDawn__serialOfLastUse(WGPUBuffer buffer)
{
    return static_cast<uint64_t>(FromAPI(buffer)->GetLastUsageSerial());
}

extern "C" uint64_t BunDawn__serialOfScheduledWork(WGPUQueue queue)
{
    return static_cast<uint64_t>(FromAPI(queue)->GetScheduledWorkDoneSerial());
}

extern "C" void BunDawn__destroyDevice(WGPUDevice device, QueueWatcher* watcher)
{
    watcher->stop();
    wgpuDeviceDestroy(device);
    delete watcher;
}

} // namespace Bun::Dawn
