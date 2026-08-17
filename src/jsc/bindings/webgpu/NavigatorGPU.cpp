#include "config.h"
#include "NavigatorGPU.h"

#include "BunClientData.h"
#include "GPU.h"
#include "ScriptExecutionContext.h"
#include "WebGPUCreateImpl.h"
#include "ZigGlobalObject.h"

#include "JSGPU.h"
#include "JSGPUAdapter.h"
#include "JSGPUAdapterInfo.h"
#include "JSGPUBindGroup.h"
#include "JSGPUBindGroupLayout.h"
#include "JSGPUBuffer.h"
#include "JSGPUBufferUsage.h"
#include "JSGPUColorWrite.h"
#include "JSGPUCommandBuffer.h"
#include "JSGPUCommandEncoder.h"
#include "JSGPUCompilationInfo.h"
#include "JSGPUCompilationMessage.h"
#include "JSGPUComputePassEncoder.h"
#include "JSGPUComputePipeline.h"
#include "JSGPUDevice.h"
#include "JSGPUDeviceLostInfo.h"
#include "JSGPUInternalError.h"
#include "JSGPUMapMode.h"
#include "JSGPUOutOfMemoryError.h"
#include "JSGPUPipelineError.h"
#include "JSGPUPipelineLayout.h"
#include "JSGPUQuerySet.h"
#include "JSGPUQueue.h"
#include "JSGPURenderBundle.h"
#include "JSGPURenderBundleEncoder.h"
#include "JSGPURenderPassEncoder.h"
#include "JSGPURenderPipeline.h"
#include "JSGPUSampler.h"
#include "JSGPUShaderModule.h"
#include "JSGPUShaderStage.h"
#include "JSGPUSupportedFeatures.h"
#include "JSGPUSupportedLimits.h"
#include "JSGPUTexture.h"
#include "JSGPUTextureUsage.h"
#include "JSGPUTextureView.h"
#include "JSGPUUncapturedErrorEvent.h"
#include "JSGPUValidationError.h"
#include "JSWGSLLanguageFeatures.h"

namespace Bun {

using namespace JSC;

#define DEFINE_WEBGPU_CONSTRUCTOR_CALLBACK(name)                                               \
    JSValue name##ConstructorCallback(VM& vm, JSObject* globalObject)                          \
    {                                                                                          \
        return WebCore::JS##name::getConstructor(vm, uncheckedDowncast<Zig::GlobalObject>(globalObject)); \
    }
FOR_EACH_WEBGPU_GLOBAL_CONSTRUCTOR(DEFINE_WEBGPU_CONSTRUCTOR_CALLBACK)
#undef DEFINE_WEBGPU_CONSTRUCTOR_CALLBACK

// The backend reports completions (adapter and device requests, buffer maps,
// pipeline compilations, submitted work) by handing work items to this
// function, frequently from one of Metal's threads. Everything WebGPU for a
// given global runs on that global's thread, so the items are posted to its
// event loop; postTaskTo() is safe to call from any thread and simply drops
// the item once the context is gone.
static RefPtr<WebCore::GPU> createGPU(WebCore::ScriptExecutionContext& context)
{
    auto identifier = context.identifier();
    RefPtr backing = WebCore::WebGPU::create([identifier](WebCore::WebGPU::WorkItem&& workItem) {
        WebCore::ScriptExecutionContext::postTaskTo(identifier, [workItem = WTF::move(workItem)](WebCore::ScriptExecutionContext&) mutable {
            workItem();
        });
    });
    if (!backing)
        return nullptr;
    return WebCore::GPU::create(backing.releaseNonNull());
}

JSC_DEFINE_HOST_FUNCTION(jsNavigatorGetGPU, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto* navigator = callFrame->thisValue().getObject();
    if (!navigator)
        return JSValue::encode(jsUndefined());

    auto& slot = WebCore::builtinNames(vm).gpuPrivateName();
    if (JSValue existing = navigator->getDirect(vm, slot))
        return JSValue::encode(existing);

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* context = globalObject->scriptExecutionContext();
    if (!context)
        return JSValue::encode(jsUndefined());
    RefPtr gpu = createGPU(*context);
    if (!gpu)
        return JSValue::encode(jsUndefined());

    JSValue wrapper = WebCore::toJS(lexicalGlobalObject, globalObject, gpu.get());
    navigator->putDirect(vm, slot, wrapper, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    return JSValue::encode(wrapper);
}

} // namespace Bun
