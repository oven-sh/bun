#include "root.h"

#include "BunWebGPU.h"
#include "InternalModuleRegistry.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSArrayBuffer.h>

namespace Bun {

using namespace JSC;

static JSValue internalWebGPUModule(VM& vm, Zig::GlobalObject* globalObject)
{
    return globalObject->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::InternalWebgpu);
}

// The receiver of a CustomValue callback is whatever object the access went
// through, which is not necessarily the global object (a Proxy around it, an
// object that inherits from it).
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

JSC_DEFINE_HOST_FUNCTION(functionNavigatorGetGPU, (JSGlobalObject * lexicalGlobalObject, CallFrame*))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    return JSValue::encode(globalObject->m_gpuObject.getInitializedOnMainThread(globalObject));
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

// GPUBuffer.unmap() and destroy() detach every ArrayBuffer getMappedRange() returned.
extern "C" void Bun__WebGPU__detachArrayBuffer(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue)
{
    auto* arrayBuffer = dynamicDowncast<JSC::JSArrayBuffer>(JSC::JSValue::decode(encodedValue));
    if (!arrayBuffer || arrayBuffer->isShared())
        return;
    auto* impl = arrayBuffer->impl();
    if (impl && !impl->isDetached() && impl->isDetachable())
        impl->detach(JSC::getVM(globalObject));
}
