#include "root.h"
#include "ZigGlobalObject.h"

#include "helpers.h"

#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "BunClientData.h"
using namespace JSC;

extern "C" size_t Bun__getEnvNames(JSGlobalObject*, ZigString* names, size_t max);
extern "C" bool Bun__getEnvValue(JSGlobalObject* globalObject, ZigString* name, ZigString* value);

namespace Bun {

using namespace WebCore;

JSC_DEFINE_CUSTOM_GETTER(jsGetterEnvironmentVariable, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSObject*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return JSValue::encode(jsUndefined());

    ZigString name = toZigString(propertyName.publicName());
    ZigString value = { nullptr, 0 };

    if (UNLIKELY(name.len == 0))
        return JSValue::encode(jsUndefined());

    if (!Bun__getEnvValue(globalObject, &name, &value)) {
        return JSValue::encode(jsUndefined());
    }

    JSValue result = jsString(vm, Zig::toStringCopy(value));
    thisObject->putDirect(vm, propertyName, result, 0);
    return JSValue::encode(result);
}

JSC_DEFINE_CUSTOM_SETTER(jsSetterEnvironmentVariable, (JSGlobalObject * globalObject, EncodedJSValue thisValue, EncodedJSValue value, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    JSC::JSObject* object = JSValue::decode(thisValue).getObject();
    if (!object)
        return false;

    object->putDirect(vm, propertyName, JSValue::decode(value), 0);
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsTimeZoneEnvironmentVariableGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSObject*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return JSValue::encode(jsUndefined());

    auto* clientData = WebCore::clientData(vm);

    ZigString name = toZigString(propertyName.publicName());
    ZigString value = { nullptr, 0 };

    if (auto hasExistingValue = thisObject->getIfPropertyExists(globalObject, clientData->builtinNames().dataPrivateName())) {
        return JSValue::encode(hasExistingValue);
    }

    if (!Bun__getEnvValue(globalObject, &name, &value) || value.len == 0) {
        return JSValue::encode(jsUndefined());
    }

    JSValue out = jsString(vm, Zig::toStringCopy(value));
    thisObject->putDirect(vm, clientData->builtinNames().dataPrivateName(), out, 0);

    return JSValue::encode(out);
}

// In Node.js, the "TZ" environment variable is special.
// Setting it automatically updates the timezone.
// We also expose an explicit setTimeZone function in bun:jsc
JSC_DEFINE_CUSTOM_SETTER(jsTimeZoneEnvironmentVariableSetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, EncodedJSValue value, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    JSC::JSObject* object = JSValue::decode(thisValue).getObject();
    if (!object)
        return false;

    JSValue decodedValue = JSValue::decode(value);
    if (decodedValue.isString()) {
        auto timeZoneName = decodedValue.toWTFString(globalObject);
        if (timeZoneName.length() < 32) {
            if (WTF::setTimeZoneOverride(timeZoneName)) {
                vm.dateCache.resetIfNecessarySlow();
            }
        }
    }

    auto* clientData = WebCore::clientData(vm);
    auto* builtinNames = &clientData->builtinNames();
    auto privateName = builtinNames->dataPrivateName();
    object->putDirect(vm, privateName, JSValue::decode(value), 0);

    // Recreate this because the property visibility needs to be set correctly
    object->putDirectCustomAccessor(vm, propertyName, JSC::CustomGetterSetter::create(vm, jsTimeZoneEnvironmentVariableGetter, jsTimeZoneEnvironmentVariableSetter), JSC::PropertyAttribute::CustomAccessor | 0);
    return true;
}

JSValue createEnvironmentVariablesMap(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    size_t max = 768;
    ZigString names[max];
    size_t count = Bun__getEnvNames(globalObject, names, max);
    JSC::JSObject* object = nullptr;
    if (count < 63) {
        object = constructEmptyObject(globalObject, globalObject->objectPrototype(), count);
    } else {
        object = constructEmptyObject(globalObject, globalObject->objectPrototype());
    }

    static NeverDestroyed<String> TZ = MAKE_STATIC_STRING_IMPL("TZ");
    bool hasTZ = false;
    for (size_t i = 0; i < count; i++) {
        auto name = Zig::toStringCopy(names[i]);
        if (name == TZ) {
            hasTZ = true;
            continue;
        }
        object->putDirectCustomAccessor(vm, Identifier::fromString(vm, name), JSC::CustomGetterSetter::create(vm, jsGetterEnvironmentVariable, jsSetterEnvironmentVariable), JSC::PropertyAttribute::CustomAccessor | 0);
    }

    unsigned int TZAttrs = JSC::PropertyAttribute::CustomAccessor | 0;
    if (!hasTZ) {
        TZAttrs |= JSC::PropertyAttribute::DontEnum;
    }
    object->putDirectCustomAccessor(
        vm,
        Identifier::fromString(vm, TZ), JSC::CustomGetterSetter::create(vm, jsTimeZoneEnvironmentVariableGetter, jsTimeZoneEnvironmentVariableSetter), TZAttrs);

    return object;
}
}
