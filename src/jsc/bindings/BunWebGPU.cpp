#include "root.h"

#include "BunWebGPU.h"
#include "BunBuiltinNames.h"
#include "InternalModuleRegistry.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSArrayBuffer.h>

namespace Bun {

using namespace JSC;

extern "C" JSC::EncodedJSValue Bun__WebGPU__createGPU(JSC::JSGlobalObject*);

static JSValue internalWebGPUModule(VM& vm, Zig::GlobalObject* globalObject)
{
    return globalObject->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::InternalWebgpu);
}

// The receiver can be a Proxy or an object that inherits from the global object.
static Zig::GlobalObject* receiverGlobalObject(JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue)
{
    if (auto* globalObject = dynamicDowncast<Zig::GlobalObject>(JSValue::decode(thisValue)))
        return globalObject;
    return defaultGlobalObject(lexicalGlobalObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsWebGPUGlobal, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName propertyName))
{
    auto& vm = getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = receiverGlobalObject(lexicalGlobalObject, thisValue);
    JSValue module = internalWebGPUModule(vm, globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSObject* exports = module.getObject();
    if (!exports) [[unlikely]]
        return JSValue::encode(jsUndefined());
    JSValue value = exports->get(globalObject, propertyName);
    RETURN_IF_EXCEPTION(scope, {});
    // From here on the global is an ordinary data property holding the class.
    globalObject->putDirect(vm, propertyName, value, PropertyAttribute::DontEnum | 0);
    return JSValue::encode(value);
}

JSC_DEFINE_CUSTOM_SETTER(setJSWebGPUGlobal, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue value, PropertyName propertyName))
{
    auto* globalObject = receiverGlobalObject(lexicalGlobalObject, thisValue);
    globalObject->putDirect(getVM(lexicalGlobalObject), propertyName, JSValue::decode(value), PropertyAttribute::DontEnum | 0);
    return true;
}

// [SameObject]. The GPU is kept on the navigator object under a private name, which script cannot reach.
JSC_DEFINE_HOST_FUNCTION(functionNavigatorGetGPU, (JSGlobalObject * lexicalGlobalObject, CallFrame*))
{
    auto& vm = getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSObject* navigator = globalObject->m_navigatorObject.getInitializedOnMainThread(globalObject);
    const auto& name = Bun::builtinNames(vm).dataPrivateName();
    if (JSValue gpu = navigator->getDirect(vm, name))
        return JSValue::encode(gpu);
    JSValue gpu = JSValue::decode(Bun__WebGPU__createGPU(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    navigator->putDirect(vm, name, gpu, 0);
    return JSValue::encode(gpu);
}

} // namespace Bun

// `internal/webgpu`'s exports object, for src/runtime/webgpu/mod.rs. Empty on exception.
extern "C" JSC::EncodedJSValue Bun__WebGPU__internalModule(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue module = Bun::internalWebGPUModule(vm, globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(module);
}

// getMappedRange(): a pinned ArrayBuffer cannot be transferred, so only unmap() and destroy() detach it.
extern "C" void Bun__WebGPU__pinArrayBuffer(JSC::EncodedJSValue encodedValue)
{
    if (auto* arrayBuffer = dynamicDowncast<JSC::JSArrayBuffer>(JSC::JSValue::decode(encodedValue)))
        arrayBuffer->impl()->pin();
}

// GPUBuffer.unmap() and destroy() unpin and detach every ArrayBuffer getMappedRange() returned.
extern "C" void Bun__WebGPU__detachArrayBuffer(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue)
{
    auto* arrayBuffer = dynamicDowncast<JSC::JSArrayBuffer>(JSC::JSValue::decode(encodedValue));
    if (!arrayBuffer)
        return;
    auto* impl = arrayBuffer->impl();
    impl->unpin();
    if (!impl->isDetached() && impl->isDetachable())
        impl->detach(JSC::getVM(globalObject));
}
