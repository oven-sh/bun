#include "root.h"
#include "headers.h"
#include "UtilInspect.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSFunction.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSGlobalObjectInlines.h"
#include "ZigGlobalObject.h"
#include "JSBuffer.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/PropertyNameArray.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/ArrayPrototype.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/ObjectPrototype.h"
#include "JavaScriptCore/RegExpPrototype.h"
#include "JavaScriptCore/StringPrototype.h"
#include "JavaScriptCore/JSPromisePrototype.h"
#include "JavaScriptCore/JSTypedArrayViewPrototype.h"
#include "JavaScriptCore/IdentifierInlines.h"

namespace Bun {

using namespace JSC;

Structure* createUtilInspectOptionsStructure(VM& vm, JSC::JSGlobalObject* globalObject)
{
    Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), 3);
    PropertyOffset offset;
    structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, "stylize"_s), 0, offset);
    RELEASE_ASSERT(offset == 0);
    structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, "depth"_s), 0, offset);
    RELEASE_ASSERT(offset == 1);
    structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, "colors"_s), 0, offset);
    RELEASE_ASSERT(offset == 2);
    return structure;
}

JSObject* createInspectOptionsObject(VM& vm, Zig::GlobalObject* globalObject, unsigned max_depth, bool colors)
{
    JSFunction* stylizeFn = colors ? globalObject->utilInspectStylizeColorFunction() : globalObject->utilInspectStylizeNoColorFunction();
    if (!stylizeFn) return nullptr;
    JSObject* options = JSC::constructEmptyObject(vm, globalObject->utilInspectOptionsStructure());
    options->putDirectOffset(vm, 0, stylizeFn);
    options->putDirectOffset(vm, 1, jsNumber(max_depth));
    options->putDirectOffset(vm, 2, jsBoolean(colors));
    return options;
}

// Node's `wellKnownPrototypes`, without the constructors:
// https://github.com/nodejs/node/blob/v26.12.1/lib/internal/util/inspect.js#L882-L904
// Node fills it from primordials. internal/util/inspect loads after the program can have replaced
// `globalThis.Date` or the prototype of `Uint8Array`, so the prototypes come from the global object.
JSC::JSValue createWellKnownPrototypes(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    const std::pair<JSObject*, ASCIILiteral> entries[] = {
        { globalObject->arrayPrototype(), "Array"_s },
        { globalObject->arrayBufferPrototype(ArrayBufferSharingMode::Default), "ArrayBuffer"_s },
        { globalObject->functionPrototype(), "Function"_s },
        { globalObject->mapPrototype(), "Map"_s },
        { globalObject->jsSetPrototype(), "Set"_s },
        { globalObject->objectPrototype(), "Object"_s },
        { globalObject->m_typedArrayProto.get(globalObject), "TypedArray"_s },
        { globalObject->regExpPrototype(), "RegExp"_s },
        { globalObject->datePrototype(), "Date"_s },
        { globalObject->typedArrayPrototype(TypeDataView), "DataView"_s },
        { globalObject->errorPrototype(), "Error"_s },
        { globalObject->errorStructure(ErrorType::AggregateError)->storedPrototypeObject(), "AggregateError"_s },
        { globalObject->errorStructure(ErrorType::RangeError)->storedPrototypeObject(), "RangeError"_s },
        { globalObject->errorStructure(ErrorType::TypeError)->storedPrototypeObject(), "TypeError"_s },
        { globalObject->booleanPrototype(), "Boolean"_s },
        { globalObject->numberPrototype(), "Number"_s },
        { globalObject->stringPrototype(), "String"_s },
        { globalObject->promisePrototype(), "Promise"_s },
        { globalObject->weakMapStructure()->storedPrototypeObject(), "WeakMap"_s },
        { globalObject->weakSetStructure()->storedPrototypeObject(), "WeakSet"_s },
    };

    JSMap* map = JSMap::create(vm, globalObject->mapStructure());
    for (const auto& [prototype, name] : entries) {
        // An atom, as a string literal of JavaScript is: `constructor === "Object"` then compares pointers.
        map->set(globalObject, prototype, jsString(vm, makeAtomString(name)));
        RETURN_IF_EXCEPTION(scope, {});
    }
    return map;
}

// For the same reason, and JavaScriptCore gives built-in JavaScript no private name for Error.
JSC::JSValue errorPrototype(Zig::GlobalObject* globalObject)
{
    return globalObject->errorPrototype();
}

extern "C" JSC::EncodedJSValue JSC__JSValue__callCustomInspectFunction(
    Zig::GlobalObject* globalObject,
    JSC::EncodedJSValue encodedFunctionValue,
    JSC::EncodedJSValue encodedThisValue,
    unsigned depth,
    unsigned max_depth,
    bool colors)
{
    JSValue functionToCall = JSValue::decode(encodedFunctionValue);
    JSValue thisValue = JSValue::decode(encodedThisValue);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto callData = JSC::getCallData(functionToCall);
    MarkedArgumentBuffer arguments;
    arguments.append(jsNumber(depth));
    if (WebCore::isInspectFunctionOfBuffer(functionToCall)) {
        // Of its operands it reads `showHidden` of the second.
        arguments.append(constructEmptyObject(globalObject));
    } else {
        JSObject* options = Bun::createInspectOptionsObject(vm, globalObject, max_depth, colors);
        RETURN_IF_EXCEPTION(scope, {});
        JSFunction* inspectFn = globalObject->utilInspectFunction();
        RETURN_IF_EXCEPTION(scope, {});
        arguments.append(options);
        arguments.append(inspectFn);
    }

    auto inspectRet = JSC::profiledCall(globalObject, ProfilingReason::API, functionToCall, callData, thisValue, arguments);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(inspectRet));
}

// Port of V8's `internalBinding('util').getOwnNonIndexProperties(object, filter)` used by
// util.inspect and the REPL completer: own keys minus array indices, without materializing
// a name (or descriptor) per element the way Object.getOwnPropertyNames() on an array would.
// `filter` is Node's PropertyFilter bitmask: ONLY_ENUMERABLE = 2, SKIP_STRINGS = 8, SKIP_SYMBOLS = 16.
JSC_DEFINE_HOST_FUNCTION(jsFunctionGetOwnNonIndexProperties, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* object = callFrame->argument(0).toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    int32_t filter = callFrame->argument(1).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    constexpr int32_t ONLY_ENUMERABLE = 1 << 1;
    constexpr int32_t SKIP_STRINGS = 1 << 3;
    constexpr int32_t SKIP_SYMBOLS = 1 << 4;

    if ((filter & SKIP_STRINGS) && (filter & SKIP_SYMBOLS))
        RELEASE_AND_RETURN(scope, JSValue::encode(constructEmptyArray(globalObject, nullptr)));
    PropertyNameMode propertyNameMode = PropertyNameMode::StringsAndSymbols;
    if (filter & SKIP_STRINGS)
        propertyNameMode = PropertyNameMode::Symbols;
    else if (filter & SKIP_SYMBOLS)
        propertyNameMode = PropertyNameMode::Strings;
    DontEnumPropertiesMode dontEnumMode = (filter & ONLY_ENUMERABLE) ? DontEnumPropertiesMode::Exclude : DontEnumPropertiesMode::Include;

    PropertyNameArrayBuilder propertyNames(vm, propertyNameMode, PrivateSymbolMode::Exclude);
    // The ordinary [[OwnPropertyKeys]] (Array included) and the typed array one are both "the
    // indices, then getOwnNonIndexPropertyNames()", so for those the indices are never produced.
    // Anything else that overrides it (Proxy, String objects, arguments, module namespaces, ...)
    // has to be asked for all of its keys, and the loop below drops the indices again.
    if (isTypedArrayType(object->type()) || !object->structure()->typeInfo().overridesGetOwnPropertyNames())
        object->getOwnNonIndexPropertyNames(globalObject, propertyNames, dontEnumMode);
    else
        object->methodTable()->getOwnPropertyNames(object, globalObject, propertyNames, dontEnumMode);
    RETURN_IF_EXCEPTION(scope, {});

    MarkedArgumentBuffer keys;
    for (const auto& propertyName : propertyNames) {
        if (!propertyName.isSymbol() && parseIndex(propertyName))
            continue;
        keys.append(identifierToJSValue(vm, propertyName));
    }
    if (keys.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), keys)));
}

}
