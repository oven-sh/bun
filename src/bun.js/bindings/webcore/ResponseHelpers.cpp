#include "config.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

// Helper function to merge AsyncLocalStorage context into Response init options
// This modifies initOptions in place by adding properties from alsStore that don't exist in initOptions
extern "C" void Response__mergeAsyncLocalStorageOptions(
    JSC::JSGlobalObject* globalObject,
    JSC::EncodedJSValue alsStoreValue,
    JSC::EncodedJSValue initOptionsValue)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue alsStore = JSValue::decode(alsStoreValue);
    JSValue initOptions = JSValue::decode(initOptionsValue);

    // Both must be objects
    if (!alsStore.isObject() || !initOptions.isObject()) {
        return;
    }

    JSObject* alsStoreObject = asObject(alsStore);
    JSObject* initOptionsObject = asObject(initOptions);

    // Get properties from alsStore
    PropertyNameArray properties(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    alsStoreObject->getOwnPropertyNames(alsStoreObject, globalObject, properties, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, );

    // Copy properties from alsStore to initOptions (only if they don't already exist)
    for (auto& propertyName : properties) {
        // Check if initOptions already has this property
        PropertySlot checkSlot(initOptionsObject, PropertySlot::InternalMethodType::Get);
        if (!initOptionsObject->getOwnPropertySlot(initOptionsObject, globalObject, propertyName, checkSlot)) {
            // Property doesn't exist in initOptions, copy it from alsStore
            PropertySlot slot(alsStoreObject, PropertySlot::InternalMethodType::Get);
            if (alsStoreObject->getOwnPropertySlot(alsStoreObject, globalObject, propertyName, slot)) {
                JSValue value = slot.getValue(globalObject, propertyName);
                RETURN_IF_EXCEPTION(scope, );
                initOptionsObject->putDirect(vm, propertyName, value);
            }
        }
    }
}

// Helper function to get the store from AsyncLocalStorage instance
extern "C" JSC::EncodedJSValue Response__getAsyncLocalStorageStore(
    JSC::JSGlobalObject* globalObject,
    JSC::EncodedJSValue alsValue)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue als = JSValue::decode(alsValue);
    if (!als.isObject()) {
        return JSValue::encode(jsUndefined());
    }

    JSObject* alsObject = asObject(als);

    // Call the getStore() method
    Identifier getStoreId = Identifier::fromString(vm, "getStore"_s);
    PropertySlot slot(alsObject, PropertySlot::InternalMethodType::Get);
    if (!alsObject->getPropertySlot(globalObject, getStoreId, slot)) {
        return JSValue::encode(jsUndefined());
    }

    JSValue getStoreFunction = slot.getValue(globalObject, getStoreId);
    RETURN_IF_EXCEPTION(scope, {});

    if (!getStoreFunction.isCallable()) {
        return JSValue::encode(jsUndefined());
    }

    CallData callData = getCallData(getStoreFunction);
    MarkedArgumentBuffer args;
    JSValue result = call(globalObject, getStoreFunction, callData, alsObject, args);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(result);
}

} // namespace Bun
