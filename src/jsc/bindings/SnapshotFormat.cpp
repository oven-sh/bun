#include "root.h"

#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/PropertyNameArray.h>

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
    JSObject* object = asObject(JSValue::decode(encodedObject));

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
        JSValue value = object->get(globalObject, key);
        RETURN_IF_EXCEPTION(scope, );
        // Jest sets it at the first call.
        if (key == lastCall && !isForVitest && value.isUndefined())
            continue;
        JSValue name = key.isSymbol() ? JSValue(Symbol::create(vm, static_cast<SymbolImpl&>(*key.impl()))) : JSValue(jsString(vm, key.string()));
        bool goOn = each(context, JSValue::encode(name), JSValue::encode(value));
        RETURN_IF_EXCEPTION(scope, );
        if (!goOn)
            return;
    }
}

extern "C" bool SnapshotFormat__hasIndex(JSGlobalObject* globalObject, EncodedJSValue object, uint32_t index)
{
    return asObject(JSValue::decode(object))->hasProperty(globalObject, index);
}
