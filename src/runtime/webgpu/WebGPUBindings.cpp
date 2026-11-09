// What src/runtime/webgpu/*.rs asks of JavaScriptCore.

#include "root.h"

#if BUN_WEBGPU

#include "BunBuiltinNames.h"
#include "BunString.h"
#include "GeneratedWebgpu.h"
#include "WebGPUBindings.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSSet.h>
#include <JavaScriptCore/JSSetIterator.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <dawn/native/DawnNative.h>
#include <wtf/SharedTask.h>

// What says where an instance logs is a struct of C++. Without it Dawn writes to stderr, for one why there is no adapter.
extern "C" WGPUInstance Bun__WebGPU__createInstance(WGPULoggingCallback log)
{
    dawn::native::DawnInstanceDescriptor dawnDescriptor;
    dawnDescriptor.loggingCallbackInfo.callback = log;
    WGPUInstanceDescriptor descriptor = WGPU_INSTANCE_DESCRIPTOR_INIT;
    descriptor.nextInChain = reinterpret_cast<WGPUChainedStruct*>(&dawnDescriptor);
    return wgpuCreateInstance(&descriptor);
}

extern "C" void Bun__WebGPU__mappedRangeReleased(void* buffer, uint64_t id);

// What `GPUBuffer.getMappedRange()` returns: the memory is Dawn's. `buffer`, a ref on the Rust `GPUBuffer`, is handed back
// once nothing reads the memory through this ArrayBuffer: it was detached or collected. Pinned, so that nothing else detaches it.
extern "C" JSC::EncodedJSValue Bun__WebGPU__createMappedRange(JSC::JSGlobalObject* globalObject, void* data, size_t size, void* buffer, uint64_t id, JSC::ArrayBuffer** arrayBuffer)
{
    auto& vm = JSC::getVM(globalObject);
    Ref created = JSC::ArrayBuffer::createFromBytes({ static_cast<const uint8_t*>(data), size }, createSharedTask<void(void*)>([buffer, id](void*) {
        Bun__WebGPU__mappedRangeReleased(buffer, id);
    }));
    created->pin();
    *arrayBuffer = created.ptr();
    auto* wrapper = JSC::JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(JSC::ArrayBufferSharingMode::Default), WTF::move(created));
    // A structured clone refuses to transfer it, as the specification says. Whatever else would detach it copies it.
    wrapper->putDirect(vm, WebCore::builtinNames(vm).arrayBufferDetachKeyPrivateName(), JSC::jsBoolean(true), JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete);
    return JSC::JSValue::encode(wrapper);
}

// Something else has pinned it too: an operation that has not finished reads or writes the memory, maybe on another thread.
extern "C" bool Bun__WebGPU__isMappedRangeInUse(JSC::ArrayBuffer* arrayBuffer)
{
    arrayBuffer->unpin();
    bool isInUse = !arrayBuffer->isDetachable();
    arrayBuffer->pin();
    return isInUse;
}

extern "C" void Bun__WebGPU__detachMappedRange(JSC::JSGlobalObject* globalObject, JSC::ArrayBuffer* arrayBuffer)
{
    Ref protect { *arrayBuffer };
    arrayBuffer->unpin();
    arrayBuffer->detach(JSC::getVM(globalObject));
}

extern "C" JSC::EncodedJSValue Bun__WebGPU__createSet(JSC::JSGlobalObject* globalObject, const BunString* values, size_t count)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* set = JSC::JSSet::create(vm, globalObject->setStructure());
    for (const auto& value : std::span { values, count }) {
        set->add(globalObject, JSC::jsString(vm, value.toWTFString()));
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSC::JSValue::encode(set);
}

extern "C" JSC::EncodedJSValue Bun__WebGPU__createSetIterator(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue set, bool entries)
{
    return JSC::JSValue::encode(JSC::JSSetIterator::create(JSC::getVM(globalObject), globalObject->setIteratorStructure(), uncheckedDowncast<JSC::JSSet>(JSC::JSValue::decode(set)), entries ? JSC::IterationKind::Entries : JSC::IterationKind::Values));
}

// For a `FrozenArray`. `array` is a new array of ours, so this runs no JavaScript.
extern "C" void Bun__WebGPU__freeze(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue array)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::objectConstructorFreeze(globalObject, JSC::asObject(JSC::JSValue::decode(array)));
    scope.assertNoException();
}

// ───────────────────────────── globals ─────────────────────────────

extern "C" SYSV_ABI JSC::EncodedJSValue js2native_bindgen_webgpu_createGPU(Zig::GlobalObject*);

namespace Bun {

using namespace Bun::Bindgen::Generated::Webgpu;

static JSC::JSValue createNavigatorGPU(JSC::VM&, JSC::JSObject* navigator)
{
    return JSC::JSValue::decode(js2native_bindgen_webgpu_createGPU(defaultGlobalObject(navigator->globalObject())));
}

struct LazyWebGPUProperty {
    ASCIILiteral name;
    JSC::JSValue (*create)(JSC::VM&, JSC::JSObject* owner);
};

static constexpr LazyWebGPUProperty webGPUGlobals[] = {
    { "GPU"_s, getGPUConstructor },
    { "GPUAdapter"_s, getGPUAdapterConstructor },
    { "GPUAdapterInfo"_s, getGPUAdapterInfoConstructor },
    { "GPUBindGroup"_s, getGPUBindGroupConstructor },
    { "GPUBindGroupLayout"_s, getGPUBindGroupLayoutConstructor },
    { "GPUBuffer"_s, getGPUBufferConstructor },
    { "GPUBufferUsage"_s, createGPUBufferUsage },
    { "GPUColorWrite"_s, createGPUColorWrite },
    { "GPUCommandBuffer"_s, getGPUCommandBufferConstructor },
    { "GPUCommandEncoder"_s, getGPUCommandEncoderConstructor },
    { "GPUCompilationInfo"_s, getGPUCompilationInfoConstructor },
    { "GPUCompilationMessage"_s, getGPUCompilationMessageConstructor },
    { "GPUComputePassEncoder"_s, getGPUComputePassEncoderConstructor },
    { "GPUComputePipeline"_s, getGPUComputePipelineConstructor },
    { "GPUDevice"_s, getGPUDeviceConstructor },
    { "GPUDeviceLostInfo"_s, getGPUDeviceLostInfoConstructor },
    { "GPUError"_s, getGPUErrorConstructor },
    { "GPUInternalError"_s, getGPUInternalErrorConstructor },
    { "GPUMapMode"_s, createGPUMapMode },
    { "GPUOutOfMemoryError"_s, getGPUOutOfMemoryErrorConstructor },
    { "GPUPipelineError"_s, getGPUPipelineErrorConstructor },
    { "GPUPipelineLayout"_s, getGPUPipelineLayoutConstructor },
    { "GPUQuerySet"_s, getGPUQuerySetConstructor },
    { "GPUQueue"_s, getGPUQueueConstructor },
    { "GPURenderBundle"_s, getGPURenderBundleConstructor },
    { "GPURenderBundleEncoder"_s, getGPURenderBundleEncoderConstructor },
    { "GPURenderPassEncoder"_s, getGPURenderPassEncoderConstructor },
    { "GPURenderPipeline"_s, getGPURenderPipelineConstructor },
    { "GPUSampler"_s, getGPUSamplerConstructor },
    { "GPUShaderModule"_s, getGPUShaderModuleConstructor },
    { "GPUShaderStage"_s, createGPUShaderStage },
    { "GPUSupportedFeatures"_s, getGPUSupportedFeaturesConstructor },
    { "GPUSupportedLimits"_s, getGPUSupportedLimitsConstructor },
    { "GPUTexture"_s, getGPUTextureConstructor },
    { "GPUTextureUsage"_s, createGPUTextureUsage },
    { "GPUTextureView"_s, getGPUTextureViewConstructor },
    { "GPUUncapturedErrorEvent"_s, getGPUUncapturedErrorEventConstructor },
    { "GPUValidationError"_s, getGPUValidationErrorConstructor },
    { "WGSLLanguageFeatures"_s, getWGSLLanguageFeaturesConstructor },
};
static constexpr LazyWebGPUProperty navigatorGPU { "gpu"_s, createNavigatorGPU };

// The first read makes the value, which is an ordinary property from then on. A static property table does this with a
// PropertyCallback, but that of the global object is the same in every build.
JSC_DEFINE_CUSTOM_GETTER(getLazyWebGPUProperty, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto* owner = JSC::JSValue::decode(thisValue).getObject();
    auto* name = propertyName.publicName();
    if (!owner || !name)
        return JSC::JSValue::encode(JSC::jsUndefined());
    auto create = [&](const LazyWebGPUProperty& property, unsigned attributes) {
        JSC::JSValue value = property.create(vm, owner);
        owner->putDirect(vm, propertyName, value, attributes);
        return JSC::JSValue::encode(value);
    };
    if (WTF::equal(name, navigatorGPU.name))
        return create(navigatorGPU, JSC::PropertyAttribute::ReadOnly | 0);
    for (const auto& property : webGPUGlobals) {
        if (WTF::equal(name, property.name))
            return create(property, JSC::PropertyAttribute::DontEnum | 0);
    }
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_CUSTOM_SETTER(setLazyWebGPUProperty, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    auto* owner = JSC::JSValue::decode(thisValue).getObject();
    if (!owner)
        return false;
    owner->putDirect(JSC::getVM(globalObject), propertyName, JSC::JSValue::decode(value), JSC::PropertyAttribute::DontEnum | 0);
    return true;
}

void addWebGPUGlobals(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    auto* accessor = JSC::CustomGetterSetter::create(vm, getLazyWebGPUProperty, setLazyWebGPUProperty);
    for (const auto& property : webGPUGlobals)
        globalObject->putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, property.name), accessor, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::CustomValue);
}

void addWebGPUToNavigator(JSC::VM& vm, JSC::JSObject* navigator)
{
    auto* accessor = JSC::CustomGetterSetter::create(vm, getLazyWebGPUProperty, nullptr);
    navigator->putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, navigatorGPU.name), accessor, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomValue);
}

}

#endif
