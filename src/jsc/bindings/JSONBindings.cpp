// The parts of `JSON.parse` and `JSON.stringify` that run JavaScript, for the formats that take the same arguments.

#include "root.h"

#include "BunClientData.h"
#include "BunString.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayInlines.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/NumberObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/StringObject.h>

namespace Bun {
using namespace JSC;

static JSValue internalizeJSONProperty(JSGlobalObject*, JSObject* holder, const Identifier& name, JSValue reviver, const CallData&);

// LengthOfArrayLike. As in `JSON`, a length that no array can have is out of memory.
static uint32_t jsonArrayLength(JSGlobalObject* globalObject, JSObject* array)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    uint64_t length = toLength(globalObject, array);
    RETURN_IF_EXCEPTION(scope, 0);
    if (length > std::numeric_limits<uint32_t>::max()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return 0;
    }
    return static_cast<uint32_t>(length);
}

static void internalizeJSONChild(JSGlobalObject* globalObject, JSObject* object, const Identifier& key, JSValue reviver, const CallData& callData)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue newElement = internalizeJSONProperty(globalObject, object, key, reviver, callData);
    RETURN_IF_EXCEPTION(scope, );
    scope.release();
    if (newElement.isUndefined())
        object->deleteProperty(globalObject, key);
    else
        object->createDataProperty(globalObject, key, newElement, false);
}

// https://tc39.es/ecma262/#sec-internalizejsonproperty
static JSValue internalizeJSONProperty(JSGlobalObject* globalObject, JSObject* holder, const Identifier& name, JSValue reviver, const CallData& callData)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!vm.isSafeToRecurse()) [[unlikely]] {
        throwStackOverflowError(globalObject, scope);
        return {};
    }

    JSValue value = holder->get(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});

    if (value.isObject()) {
        JSObject* object = asObject(value);
        bool valueIsArray = JSC::isArray(globalObject, object);
        RETURN_IF_EXCEPTION(scope, {});
        if (valueIsArray) {
            uint32_t length = jsonArrayLength(globalObject, object);
            RETURN_IF_EXCEPTION(scope, {});
            for (uint32_t i = 0; i < length; i++) {
                internalizeJSONChild(globalObject, object, Identifier::from(vm, i), reviver, callData);
                RETURN_IF_EXCEPTION(scope, {});
            }
        } else {
            PropertyNameArrayBuilder keys(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
            object->methodTable()->getOwnPropertyNames(object, globalObject, keys, DontEnumPropertiesMode::Exclude);
            RETURN_IF_EXCEPTION(scope, {});
            for (const auto& key : keys) {
                internalizeJSONChild(globalObject, object, key, reviver, callData);
                RETURN_IF_EXCEPTION(scope, {});
            }
        }
    }

    MarkedArgumentBuffer args;
    args.append(jsString(vm, name.string()));
    args.append(value);
    ASSERT(!args.hasOverflowed());
    JSValue result = JSC::call(globalObject, reviver, callData, holder, args);
    RETURN_IF_EXCEPTION(scope, {});
    return result;
}

// What `JSON.parse` does with its `reviver` once the text is parsed. `reviver` is callable. It gets no `context` argument.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue JSC__JSValue__jsonRevive(JSC::EncodedJSValue encodedValue, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedReviver)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue reviver = JSValue::decode(encodedReviver);
    auto callData = JSC::getCallData(reviver);
    ASSERT(callData.type != CallData::Type::None);

    JSObject* root = constructEmptyObject(globalObject);
    root->putDirect(vm, vm.propertyNames->emptyIdentifier, JSValue::decode(encodedValue));
    RELEASE_AND_RETURN(scope, JSValue::encode(internalizeJSONProperty(globalObject, root, vm.propertyNames->emptyIdentifier, reviver, callData)));
}

// The PropertyList that https://tc39.es/ecma262/#sec-json.stringify makes of a `replacer` that is an array or a Proxy
// of one, as an array of strings. Each string is an atom, so that a lookup by it does not search the atom table.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue JSC__JSValue__jsonPropertyList(JSC::EncodedJSValue encodedReplacer, JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* replacer = asObject(JSValue::decode(encodedReplacer));
    uint64_t length = toLength(globalObject, replacer);
    RETURN_IF_EXCEPTION(scope, {});

    PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    for (uint64_t i = 0; i < length; i++) {
        JSValue name = replacer->get(globalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        if (name.isObject()) {
            JSObject* nameObject = asObject(name);
            if (!nameObject->inherits<NumberObject>() && !nameObject->inherits<StringObject>())
                continue;
        } else if (!name.isNumber() && !name.isString())
            continue;
        JSString* nameString = name.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto identifier = nameString->toIdentifier(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        names.add(identifier);
    }

    MarkedArgumentBuffer strings;
    for (const auto& name : names)
        strings.append(jsString(vm, name.string()));
    if (strings.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), strings)));
}

// The method that the `json5` package calls on a value to get what to stringify in its place: `toJSON5`, else
// `toJSON`, else `undefined`. As in `JSON.stringify`, only an object and a BigInt are asked.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue JSC__JSValue__getToJSON5Method(JSC::EncodedJSValue encodedValue, JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue value = JSValue::decode(encodedValue);
    if (!value.isObject() && !value.isBigInt())
        return JSValue::encode(jsUndefined());

    JSValue method = value.get(globalObject, WebCore::builtinNames(vm).toJSON5PublicName());
    RETURN_IF_EXCEPTION(scope, {});
    if (method.isCallable())
        return JSValue::encode(method);

    method = value.get(globalObject, vm.propertyNames->toJSON);
    RETURN_IF_EXCEPTION(scope, {});
    if (method.isCallable())
        return JSValue::encode(method);

    return JSValue::encode(jsUndefined());
}

// `value[propertyName]`: walks the prototype chain, takes an index, and is `undefined` for what is not there.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue JSC__JSValue__getBunString(JSC::EncodedJSValue encodedValue, JSC::JSGlobalObject* globalObject, const BunString* propertyName)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue result = JSValue::decode(encodedValue).get(globalObject, Bun::toIdentifier(vm, *propertyName));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

// `Array.isArray(value)`: sees through a Proxy, and throws for a revoked one.
extern "C" [[ZIG_EXPORT(check_slow)]] bool JSC__JSValue__isArrayOrProxyOfArray(JSC::EncodedJSValue encodedValue, JSC::JSGlobalObject* globalObject)
{
    return JSC::isArray(globalObject, JSValue::decode(encodedValue));
}

extern "C" [[ZIG_EXPORT(check_slow)]] uint32_t JSC__JSValue__jsonArrayLength(JSC::EncodedJSValue encodedArray, JSC::JSGlobalObject* globalObject)
{
    return jsonArrayLength(globalObject, asObject(JSValue::decode(encodedArray)));
}

} // namespace Bun
