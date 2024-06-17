#include "root.h"
#include "ZigGlobalObject.h"

#include "helpers.h"

#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayInlines.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSStringInlines.h>

#include "BunClientData.h"
#include "wtf/Compiler.h"
#include "wtf/Forward.h"

using namespace JSC;

extern "C" size_t Bun__getEnvCount(JSGlobalObject* globalObject, void** list_ptr);
extern "C" size_t Bun__getEnvKey(void* list, size_t index, unsigned char** out);

extern "C" bool Bun__getEnvValue(JSGlobalObject* globalObject, ZigString* name, ZigString* value);

namespace Bun {

using namespace WebCore;

JSC_DEFINE_CUSTOM_GETTER(jsGetterEnvironmentVariable, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
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

JSC_DEFINE_CUSTOM_SETTER(jsSetterEnvironmentVariable, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    JSC::JSObject* object = JSValue::decode(thisValue).getObject();
    if (!object)
        return false;

    auto string = JSValue::decode(value).toString(globalObject);
    if (UNLIKELY(!string))
        return false;

    object->putDirect(vm, propertyName, string, 0);
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsTimeZoneEnvironmentVariableGetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
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
JSC_DEFINE_CUSTOM_SETTER(jsTimeZoneEnvironmentVariableSetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, PropertyName propertyName))
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

    // TODO: this is an assertion failure
    // Recreate this because the property visibility needs to be set correctly
    // object->putDirectWithoutTransition(vm, propertyName, JSC::CustomGetterSetter::create(vm, jsTimeZoneEnvironmentVariableGetter, jsTimeZoneEnvironmentVariableSetter), JSC::PropertyAttribute::CustomAccessor | 0);
    return true;
}

extern "C" int Bun__getTLSRejectUnauthorizedValue();
extern "C" int Bun__setTLSRejectUnauthorizedValue(int value);
extern "C" int Bun__getVerboseFetchValue();
extern "C" int Bun__setVerboseFetchValue(int value);

ALWAYS_INLINE static Identifier NODE_TLS_REJECT_UNAUTHORIZED_PRIVATE_PROPERTY(VM& vm)
{
    auto* clientData = WebCore::clientData(vm);
    auto& builtinNames = clientData->builtinNames();
    // We just pick one to reuse. This will never be exposed to a user. And we
    // don't want to pay the cost of adding another one.
    return builtinNames.textDecoderStreamDecoderPrivateName();
}

ALWAYS_INLINE static Identifier BUN_CONFIG_VERBOSE_FETCH_PRIVATE_PROPERTY(VM& vm)
{
    auto* clientData = WebCore::clientData(vm);
    auto& builtinNames = clientData->builtinNames();
    // We just pick one to reuse. This will never be exposed to a user. And we
    // don't want to pay the cost of adding another one.
    return builtinNames.textEncoderStreamEncoderPrivateName();
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeTLSRejectUnauthorizedGetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSObject*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return JSValue::encode(jsUndefined());

    const auto& privateName = NODE_TLS_REJECT_UNAUTHORIZED_PRIVATE_PROPERTY(vm);
    JSValue result = thisObject->getDirect(vm, privateName);
    if (UNLIKELY(result)) {
        return JSValue::encode(result);
    }

    ZigString name = toZigString(propertyName.publicName());
    ZigString value = { nullptr, 0 };

    if (!Bun__getEnvValue(globalObject, &name, &value) || value.len == 0) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsString(vm, Zig::toStringCopy(value)));
}

JSC_DEFINE_CUSTOM_SETTER(jsNodeTLSRejectUnauthorizedSetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    JSC::JSObject* object = JSValue::decode(thisValue).getObject();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!object)
        return false;

    JSValue decodedValue = JSValue::decode(value);
    WTF::String str = decodedValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, false);

    // TODO: only check "0". Node doesn't check both. But we already did. So we
    // should wait to do that until Bun v1.2.0.
    if (str == "0"_s || str == "false"_s) {
        Bun__setTLSRejectUnauthorizedValue(0);
    } else {
        Bun__setTLSRejectUnauthorizedValue(1);
    }

    const auto& privateName = NODE_TLS_REJECT_UNAUTHORIZED_PRIVATE_PROPERTY(vm);
    object->putDirect(vm, privateName, JSValue::decode(value), 0);

    // TODO: this is an assertion failure
    // Recreate this because the property visibility needs to be set correctly
    // object->putDirectWithoutTransition(vm, propertyName, JSC::CustomGetterSetter::create(vm, jsTimeZoneEnvironmentVariableGetter, jsTimeZoneEnvironmentVariableSetter), JSC::PropertyAttribute::CustomAccessor | 0);
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsBunConfigVerboseFetchGetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSObject*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return JSValue::encode(jsUndefined());

    const auto& privateName = BUN_CONFIG_VERBOSE_FETCH_PRIVATE_PROPERTY(vm);
    JSValue result = thisObject->getDirect(vm, privateName);
    if (UNLIKELY(result)) {
        return JSValue::encode(result);
    }

    ZigString name = toZigString(propertyName.publicName());
    ZigString value = { nullptr, 0 };

    if (!Bun__getEnvValue(globalObject, &name, &value) || value.len == 0) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsString(vm, Zig::toStringCopy(value)));
}

JSC_DEFINE_CUSTOM_SETTER(jsBunConfigVerboseFetchSetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, PropertyName propertyName))
{
    VM& vm = globalObject->vm();
    JSC::JSObject* object = JSValue::decode(thisValue).getObject();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!object)
        return false;

    JSValue decodedValue = JSValue::decode(value);
    WTF::String str = decodedValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, false);

    if (str == "1"_s || str == "true"_s) {
        Bun__setVerboseFetchValue(1);
    } else if (str == "curl"_s) {
        Bun__setVerboseFetchValue(2);
    } else {
        Bun__setVerboseFetchValue(0);
    }

    const auto& privateName = BUN_CONFIG_VERBOSE_FETCH_PRIVATE_PROPERTY(vm);
    object->putDirect(vm, privateName, JSValue::decode(value), 0);

    // TODO: this is an assertion failure
    // Recreate this because the property visibility needs to be set correctly
    // object->putDirectWithoutTransition(vm, propertyName, JSC::CustomGetterSetter::create(vm, jsTimeZoneEnvironmentVariableGetter, jsTimeZoneEnvironmentVariableSetter), JSC::PropertyAttribute::CustomAccessor | 0);
    return true;
}

JSValue createEnvironmentVariablesMap(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    void* list;
    size_t count = Bun__getEnvCount(globalObject, &list);
    JSC::JSObject* object = nullptr;
    if (count < 63) {
        object = constructEmptyObject(globalObject, globalObject->objectPrototype(), count);
    } else {
        object = constructEmptyObject(globalObject, globalObject->objectPrototype());
    }

#if OS(WINDOWS)
    JSArray* keyArray = constructEmptyArray(globalObject, nullptr, count);
#endif

    static NeverDestroyed<String> TZ = MAKE_STATIC_STRING_IMPL("TZ");
    String NODE_TLS_REJECT_UNAUTHORIZED = String("NODE_TLS_REJECT_UNAUTHORIZED"_s);
    String BUN_CONFIG_VERBOSE_FETCH = String("BUN_CONFIG_VERBOSE_FETCH"_s);
    bool hasTZ = false;
    bool hasNodeTLSRejectUnauthorized = false;
    bool hasBunConfigVerboseFetch = false;

    for (size_t i = 0; i < count; i++) {
        unsigned char* chars;
        size_t len = Bun__getEnvKey(list, i, &chars);
        auto name = String::fromUTF8(std::span { chars, len });
#if OS(WINDOWS)
        keyArray->putByIndexInline(globalObject, (unsigned)i, jsString(vm, name), false);
#endif
        if (name == TZ) {
            hasTZ = true;
            continue;
        }
        if (name == NODE_TLS_REJECT_UNAUTHORIZED) {
            hasNodeTLSRejectUnauthorized = true;
            continue;
        }
        if (name == BUN_CONFIG_VERBOSE_FETCH) {
            hasBunConfigVerboseFetch = true;
            continue;
        }
        ASSERT(len > 0);
#if OS(WINDOWS)
        String idName = name.convertToASCIIUppercase();
#else
        String idName = name;
#endif
        Identifier identifier = Identifier::fromString(vm, idName);

        // CustomGetterSetter doesn't support indexed properties yet.
        // This causes strange issues when the environment variable name is an integer.
        if (UNLIKELY(chars[0] >= '0' && chars[0] <= '9')) {
            if (auto index = parseIndex(identifier)) {
                ZigString valueString = { nullptr, 0 };
                ZigString nameStr = toZigString(name);
                if (Bun__getEnvValue(globalObject, &nameStr, &valueString)) {
                    JSValue value = jsString(vm, Zig::toStringCopy(valueString));
                    object->putDirectIndex(globalObject, *index, value, 0, PutDirectIndexLikePutDirect);
                }
                continue;
            }
        }

        object->putDirectCustomAccessor(vm, identifier, JSC::CustomGetterSetter::create(vm, jsGetterEnvironmentVariable, jsSetterEnvironmentVariable), JSC::PropertyAttribute::CustomAccessor | 0);
    }

    unsigned int TZAttrs = JSC::PropertyAttribute::CustomAccessor | 0;
    if (!hasTZ) {
        TZAttrs |= JSC::PropertyAttribute::DontEnum;
    }
    object->putDirectCustomAccessor(
        vm,
        Identifier::fromString(vm, TZ), JSC::CustomGetterSetter::create(vm, jsTimeZoneEnvironmentVariableGetter, jsTimeZoneEnvironmentVariableSetter), TZAttrs);

    unsigned int NODE_TLS_REJECT_UNAUTHORIZED_Attrs = JSC::PropertyAttribute::CustomAccessor | 0;
    if (!hasNodeTLSRejectUnauthorized) {
        NODE_TLS_REJECT_UNAUTHORIZED_Attrs |= JSC::PropertyAttribute::DontEnum;
    }
    object->putDirectCustomAccessor(
        vm,
        Identifier::fromString(vm, NODE_TLS_REJECT_UNAUTHORIZED), JSC::CustomGetterSetter::create(vm, jsNodeTLSRejectUnauthorizedGetter, jsNodeTLSRejectUnauthorizedSetter), NODE_TLS_REJECT_UNAUTHORIZED_Attrs);

    unsigned int BUN_CONFIG_VERBOSE_FETCH_Attrs = JSC::PropertyAttribute::CustomAccessor | 0;
    if (!hasBunConfigVerboseFetch) {
        BUN_CONFIG_VERBOSE_FETCH_Attrs |= JSC::PropertyAttribute::DontEnum;
    }
    object->putDirectCustomAccessor(
        vm,
        Identifier::fromString(vm, BUN_CONFIG_VERBOSE_FETCH), JSC::CustomGetterSetter::create(vm, jsBunConfigVerboseFetchGetter, jsBunConfigVerboseFetchSetter), BUN_CONFIG_VERBOSE_FETCH_Attrs);

#if OS(WINDOWS)
    JSC::JSFunction* getSourceEvent = JSC::JSFunction::create(vm, processObjectInternalsWindowsEnvCodeGenerator(vm), globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::MarkedArgumentBuffer args;
    args.append(object);
    args.append(keyArray);
    auto clientData = WebCore::clientData(vm);
    JSC::CallData callData = JSC::getCallData(getSourceEvent);
    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::call(globalObject, getSourceEvent, callData, globalObject->globalThis(), args, returnedException);
    RETURN_IF_EXCEPTION(scope, {});

    if (returnedException) {
        throwException(globalObject, scope, returnedException.get());
        return jsUndefined();
    }

    RELEASE_AND_RETURN(scope, result);
#else
    return object;
#endif
}
}
