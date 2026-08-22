#include "LazyTransform.h"
#include "ZigGlobalObject.h"
#include "InternalModuleRegistry.h"
#include <JavaScriptCore/JSCInlines.h>

namespace Bun {

using namespace JSC;

JSObject* transformConstructor(JSGlobalObject* lexicalGlobalObject)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue transform = globalObject->internalModuleRegistry()->requireId(lexicalGlobalObject, vm, InternalModuleRegistry::Field::InternalStreamsTransform);
    RETURN_IF_EXCEPTION(scope, nullptr);
    RELEASE_ASSERT(transform.isObject());
    return transform.getObject();
}

JSC_DEFINE_CUSTOM_GETTER(jsLazyTransformStateGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName propertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* thisObject = JSValue::decode(thisValue).getObject();
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    // Transform.call(this, this._options)
    JSValue options = thisObject->get(globalObject, Identifier::fromString(vm, "_options"_s));
    RETURN_IF_EXCEPTION(scope, {});
    JSObject* transform = transformConstructor(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    MarkedArgumentBuffer args;
    args.append(options);
    JSC::profiledCall(globalObject, ProfilingReason::API, transform, JSC::getCallData(transform), thisObject, args);
    RETURN_IF_EXCEPTION(scope, {});

    // this._writableState.decodeStrings = false
    JSValue writableState = thisObject->get(globalObject, Identifier::fromString(vm, "_writableState"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (JSObject* writableStateObject = writableState.getObject()) {
        PutPropertySlot slot(writableState);
        writableStateObject->methodTable()->put(writableStateObject, globalObject, Identifier::fromString(vm, "decodeStrings"_s), jsBoolean(false), slot);
        RETURN_IF_EXCEPTION(scope, {});
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject->get(globalObject, propertyName)));
}

JSC_DEFINE_CUSTOM_SETTER(jsLazyTransformStateSetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName propertyName))
{
    auto& vm = JSC::getVM(globalObject);
    JSObject* thisObject = JSValue::decode(thisValue).getObject();
    if (!thisObject) [[unlikely]]
        return false;
    thisObject->putDirect(vm, propertyName, JSValue::decode(encodedValue), 0);
    return true;
}

} // namespace Bun
