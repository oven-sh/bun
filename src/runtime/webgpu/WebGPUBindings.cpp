// What src/runtime/webgpu/*.rs asks of JavaScriptCore, and of Dawn beyond its C API.

#include "root.h"

#include "BunBuiltinNames.h"
#include "BunString.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSSet.h>
#include <JavaScriptCore/JSSetIterator.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <dawn/native/DawnNative.h>
#include <wtf/SharedTask.h>

#if OS(WINDOWS)
#include <windows.h>
#endif

// What says where an instance logs is a struct of C++. Without it Dawn writes to stderr, for one why there is no adapter.
extern "C" WGPUInstance Bun__WebGPU__createInstance(WGPULoggingCallback log)
{
    dawn::native::DawnInstanceDescriptor dawnDescriptor;
    dawnDescriptor.loggingCallbackInfo.callback = log;
    WGPUInstanceDescriptor descriptor = WGPU_INSTANCE_DESCRIPTOR_INIT;
    descriptor.nextInChain = reinterpret_cast<WGPUChainedStruct*>(&dawnDescriptor);
    return wgpuCreateInstance(&descriptor);
}

extern "C" bool Bun__WebGPU__tickDevice(WGPUDevice device)
{
    return dawn::native::DeviceTick(device);
}

extern "C" bool Bun__WebGPU__reduceMemoryUsage(WGPUDevice device)
{
    return dawn::native::ReduceMemoryUsage(device);
}

#if OS(WINDOWS)
// Where Dawn looks for it: beside the executable, then in System32.
extern "C" bool Bun__WebGPU__hasDXC()
{
    static const bool hasDXC = !!LoadLibraryExW(L"dxcompiler.dll", nullptr, LOAD_LIBRARY_SEARCH_APPLICATION_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
    return hasDXC;
}
#endif

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
