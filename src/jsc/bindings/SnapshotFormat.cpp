#include "root.h"

#include "ZigGlobalObject.h"
#include <JavaScriptCore/ArrayConstructor.h>
#include <JavaScriptCore/JSFunctionInlines.h>
#include <JavaScriptCore/JSMapIterator.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSSetIterator.h>
#include <JavaScriptCore/Operations.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/RegExpObject.h>

using namespace JSC;

namespace Bun {
JSString* objectPrototypeToStringOutOfLine(JSGlobalObject*, JSValue);
}

// `Kind` in pretty_format.rs
enum class SnapshotKind : uint8_t {
    Object,
    Arguments,
    List,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Date,
    Error,
    RegExp,
    Function,
    Symbol,
    Promise,
};

extern "C" SnapshotKind SnapshotFormat__kindOf(JSGlobalObject* globalObject, EncodedJSValue encodedObject)
{
    static constexpr std::pair<ASCIILiteral, SnapshotKind> kinds[] = {
        { "[object Array]"_s, SnapshotKind::List },
        { "[object Map]"_s, SnapshotKind::Map },
        { "[object Set]"_s, SnapshotKind::Set },
        { "[object Date]"_s, SnapshotKind::Date },
        { "[object Error]"_s, SnapshotKind::Error },
        { "[object RegExp]"_s, SnapshotKind::RegExp },
        { "[object Arguments]"_s, SnapshotKind::Arguments },
        { "[object WeakMap]"_s, SnapshotKind::WeakMap },
        { "[object WeakSet]"_s, SnapshotKind::WeakSet },
        { "[object Function]"_s, SnapshotKind::Function },
        { "[object GeneratorFunction]"_s, SnapshotKind::Function },
        { "[object Symbol]"_s, SnapshotKind::Symbol },
        { "[object Promise]"_s, SnapshotKind::Promise },
        { "[object ArrayBuffer]"_s, SnapshotKind::List },
        { "[object DataView]"_s, SnapshotKind::List },
        { "[object Float32Array]"_s, SnapshotKind::List },
        { "[object Float64Array]"_s, SnapshotKind::List },
        { "[object Int8Array]"_s, SnapshotKind::List },
        { "[object Int16Array]"_s, SnapshotKind::List },
        { "[object Int32Array]"_s, SnapshotKind::List },
        { "[object Uint8Array]"_s, SnapshotKind::List },
        { "[object Uint8ClampedArray]"_s, SnapshotKind::List },
        { "[object Uint16Array]"_s, SnapshotKind::List },
        { "[object Uint32Array]"_s, SnapshotKind::List },
    };

    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue object = JSValue::decode(encodedObject);
    JSString* toStringed = Bun::objectPrototypeToStringOutOfLine(globalObject, object);
    RETURN_IF_EXCEPTION(scope, SnapshotKind::Object);
    auto view = toStringed->view(globalObject);
    RETURN_IF_EXCEPTION(scope, SnapshotKind::Object);
    if (view != "[object Object]"_s) {
        for (auto& [name, kind] : kinds) {
            if (view == name)
                return kind;
        }
    }
    bool isError = JSObject::defaultHasInstance(globalObject, object, globalObject->errorPrototype());
    RETURN_IF_EXCEPTION(scope, SnapshotKind::Object);
    return isError ? SnapshotKind::Error : SnapshotKind::Object;
}

// `fn.mock`
static bool isStateOfMockFunction(JSGlobalObject* globalObject, JSObject* object)
{
    auto* global = dynamicDowncast<Zig::GlobalObject>(globalObject);
    if (!global || !global->mockModule.mockObjectStructure.isInitialized())
        return false;
    return object->getPrototypeDirect() == global->mockModule.mockObjectStructure.getInitializedOnMainThread(global)->storedPrototype();
}

extern "C" void SnapshotFormat__forEachProperty(JSGlobalObject* globalObject, EncodedJSValue encodedObject, bool isForVitest, void* context, bool (*each)(void* context, EncodedJSValue key, EncodedJSValue value))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // As `Object.keys()` takes it.
    JSValue value = JSValue::decode(encodedObject);
    if (value.isUndefinedOrNull()) {
        throwTypeError(globalObject, scope, "Cannot convert undefined or null to object"_s);
        return;
    }
    JSObject* object = value.toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, );

    PropertyNameArrayBuilder properties(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    object->methodTable()->getOwnPropertyNames(object, globalObject, properties, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, );

    auto keys = properties.data()->propertyNameVector();
    // What Bun has getters on the prototype for are properties of the object itself in Jest and Vitest.
    Identifier lastCall;
    if (isStateOfMockFunction(globalObject, object)) {
        lastCall = Identifier::fromString(vm, "lastCall"_s);
        keys.append(lastCall);
        if (isForVitest)
            keys.append(Identifier::fromString(vm, "settledResults"_s));
    }
    auto symbols = std::stable_partition(keys.begin(), keys.end(), [](const Identifier& key) { return !key.isSymbol(); });
    std::sort(keys.begin(), symbols, [](const Identifier& a, const Identifier& b) { return codePointCompare(a.impl(), b.impl()) < 0; });

    for (const Identifier& key : keys) {
        JSValue member = object->get(globalObject, key);
        RETURN_IF_EXCEPTION(scope, );
        // Jest sets it at the first call.
        if (key == lastCall && !isForVitest && member.isUndefined())
            continue;
        JSValue name = key.isSymbol() ? JSValue(Symbol::create(vm, static_cast<SymbolImpl&>(*key.impl()))) : JSValue(jsString(vm, key.string()));
        bool goOn = each(context, JSValue::encode(name), JSValue::encode(member));
        RETURN_IF_EXCEPTION(scope, );
        if (!goOn)
            return;
    }
}

// `index in value`
extern "C" bool SnapshotFormat__hasIndex(JSGlobalObject* globalObject, EncodedJSValue encodedValue, uint32_t index)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSObject* object = JSValue::decode(encodedValue).getObject();
    if (!object) {
        throwTypeError(globalObject, scope, "Cannot use the 'in' operator on a value that is not an object"_s);
        return false;
    }
    RELEASE_AND_RETURN(scope, object->hasProperty(globalObject, index));
}

static void throwCannotRead(JSGlobalObject*, ThrowScope&, JSValue, const String& name);

// How many times `for (let i = 0; i < value.length; i++)` goes round.
extern "C" uint32_t SnapshotFormat__lengthOf(JSGlobalObject* globalObject, EncodedJSValue encodedValue)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = JSValue::decode(encodedValue);
    if (value.isUndefinedOrNull()) {
        throwCannotRead(globalObject, scope, value, "length"_s);
        return 0;
    }
    JSValue length = value.get(globalObject, vm.propertyNames->length);
    RETURN_IF_EXCEPTION(scope, 0);
    if (!length.isNumber()) {
        length = length.toNumeric(globalObject);
        RETURN_IF_EXCEPTION(scope, 0);
        if (length.isBigInt()) {
            // The loops go on to `length - 1`.
            if (JSBigInt::toNumber(length).asNumber() > 0)
                throwTypeError(globalObject, scope, "Cannot mix BigInt and other types, use explicit conversions"_s);
            return 0;
        }
    }
    double count = std::ceil(length.asNumber());
    return count >= std::numeric_limits<uint32_t>::max() ? std::numeric_limits<uint32_t>::max() : count > 0 ? static_cast<uint32_t>(count) : 0;
}

// `value > 0`
extern "C" bool SnapshotFormat__isGreaterThanZero(JSGlobalObject* globalObject, EncodedJSValue encodedValue)
{
    return jsLess<false>(globalObject, jsNumber(0), JSValue::decode(encodedValue));
}

// `Array.isArray(value)`
extern "C" bool SnapshotFormat__isArray(JSGlobalObject* globalObject, EncodedJSValue encodedValue)
{
    return isArray(globalObject, JSValue::decode(encodedValue));
}

static void throwCannotRead(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, const String& name)
{
    throwTypeError(globalObject, scope, makeString("Cannot read properties of "_s, value.isNull() ? "null"_s : "undefined"_s, " (reading '"_s, name, "')"_s));
}

// `value[name]`
extern "C" EncodedJSValue SnapshotFormat__get(JSGlobalObject* globalObject, EncodedJSValue encodedValue, const Latin1Character* name, size_t length)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = JSValue::decode(encodedValue);
    auto identifier = Identifier::fromString(vm, std::span { name, length });
    if (value.isUndefinedOrNull()) {
        throwCannotRead(globalObject, scope, value, identifier.string());
        return {};
    }
    JSValue member = value.get(globalObject, identifier);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(member);
}

// `value[index]`
extern "C" EncodedJSValue SnapshotFormat__getIndex(JSGlobalObject* globalObject, EncodedJSValue encodedValue, uint32_t index)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue value = JSValue::decode(encodedValue);
    if (value.isUndefinedOrNull()) {
        throwCannotRead(globalObject, scope, value, String::number(index));
        return {};
    }
    JSValue item = value.get(globalObject, index);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(item);
}

// `value[key]`
extern "C" EncodedJSValue SnapshotFormat__getByValue(JSGlobalObject* globalObject, EncodedJSValue encodedValue, EncodedJSValue encodedKey)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue value = JSValue::decode(encodedValue);
    auto key = JSValue::decode(encodedKey).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (value.isUndefinedOrNull()) {
        throwCannotRead(globalObject, scope, value, key.isSymbol() ? String("a symbol"_s) : key.string());
        return {};
    }
    JSValue member = value.get(globalObject, key);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(member);
}

// `key in value`
extern "C" bool SnapshotFormat__hasByValue(JSGlobalObject* globalObject, EncodedJSValue encodedValue, EncodedJSValue encodedKey)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSObject* object = JSValue::decode(encodedValue).getObject();
    if (!object) {
        throwTypeError(globalObject, scope, "Cannot use the 'in' operator on a value that is not an object"_s);
        return false;
    }
    auto key = JSValue::decode(encodedKey).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    RELEASE_AND_RETURN(scope, object->hasProperty(globalObject, key));
}

// Defines `object[key]`, for an object that the printer has made.
extern "C" void SnapshotFormat__define(JSGlobalObject* globalObject, EncodedJSValue encodedObject, EncodedJSValue encodedKey, EncodedJSValue encodedValue)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSObject* object = JSValue::decode(encodedObject).getObject();
    if (!object)
        return;
    auto key = JSValue::decode(encodedKey).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    scope.release();
    object->putDirectMayBeIndex(globalObject, key, JSValue::decode(encodedValue));
}

// `new RegExp(pattern)`, or `pattern` when it is not one.
extern "C" EncodedJSValue SnapshotFormat__toRegExp(JSGlobalObject* globalObject, EncodedJSValue encodedPattern)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue pattern = JSValue::decode(encodedPattern);
    if (!pattern.isString())
        return encodedPattern;
    auto string = asString(pattern)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    RegExp* regExp = RegExp::create(vm, string, {});
    if (!regExp->isValid())
        return encodedPattern;
    return JSValue::encode(RegExpObject::create(vm, globalObject->regExpStructure(), regExp));
}

// The entries of a Map or the values of a Set. False, with nothing done, unless `method` is the `entries` or `values` it is born with.
extern "C" bool SnapshotFormat__forEachOfCollection(JSGlobalObject* globalObject, EncodedJSValue encodedCollection, EncodedJSValue encodedMethod, void* context, bool (*each)(void* context, EncodedJSValue first, EncodedJSValue second))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* method = dynamicDowncast<JSFunction>(JSValue::decode(encodedMethod));
    if (!method)
        return false;
    JSValue collection = JSValue::decode(encodedCollection);
    JSValue first, second;
    if (auto* map = dynamicDowncast<JSMap>(collection); map && method->intrinsic() == JSMapEntriesIntrinsic) {
        auto* iterator = JSMapIterator::create(vm, globalObject->mapIteratorStructure(), map, IterationKind::Entries);
        while (iterator->nextKeyValue(globalObject, first, second)) {
            bool goOn = each(context, JSValue::encode(first), JSValue::encode(second));
            RETURN_IF_EXCEPTION(scope, true);
            if (!goOn)
                break;
        }
        return true;
    }
    if (auto* set = dynamicDowncast<JSSet>(collection); set && method->intrinsic() == JSSetValuesIntrinsic) {
        auto* iterator = JSSetIterator::create(vm, globalObject->setIteratorStructure(), set, IterationKind::Values);
        while (iterator->next(globalObject, first)) {
            bool goOn = each(context, JSValue::encode(first), JSValue::encode(jsUndefined()));
            RETURN_IF_EXCEPTION(scope, true);
            if (!goOn)
                break;
        }
        return true;
    }
    return false;
}

// Whether `value` is among the first `length` items of an array that only the printer has.
extern "C" bool SnapshotFormat__includes(EncodedJSValue encodedList, uint32_t length, EncodedJSValue encodedValue)
{
    auto* list = dynamicDowncast<JSArray>(JSValue::decode(encodedList));
    if (!list)
        return false;
    JSValue value = JSValue::decode(encodedValue);
    for (uint32_t i = 0; i < length; i++) {
        if (list->tryGetIndexQuickly(i) == value)
            return true;
    }
    return false;
}
