#include "root.h"
#include "headers.h"
#include "UtilInspect.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSFunction.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/PropertyNameArray.h"
#include "JavaScriptCore/Symbol.h"

namespace Bun {

using namespace JSC;

// Node's `internalBinding('util').getOwnNonIndexProperties(object, filter)`:
// the own property keys of `object` excluding array indices. `filter` uses
// V8's PropertyFilter bits (ONLY_ENUMERABLE = 2, SKIP_SYMBOLS = 16).
JSC_DEFINE_HOST_FUNCTION(jsFunctionGetOwnNonIndexProperties, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue objectValue = callFrame->argument(0);
    if (!objectValue.isObject()) [[unlikely]] {
        throwTypeError(globalObject, scope, "getOwnNonIndexProperties expects an object"_s);
        return {};
    }
    JSObject* object = asObject(objectValue);

    constexpr int32_t kOnlyEnumerable = 2;
    constexpr int32_t kSkipSymbols = 16;
    int32_t filter = callFrame->argument(1).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto dontEnumMode = (filter & kOnlyEnumerable) ? DontEnumPropertiesMode::Exclude : DontEnumPropertiesMode::Include;
    auto nameMode = (filter & kSkipSymbols) ? PropertyNameMode::Strings : PropertyNameMode::StringsAndSymbols;
    PropertyNameArrayBuilder properties(vm, nameMode, PrivateSymbolMode::Exclude);

    if (object->hasNonReifiedStaticProperties()) [[unlikely]] {
        object->reifyAllStaticProperties(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    if (object->type() == ProxyObjectType) [[unlikely]] {
        // getOwnNonIndexPropertyNames does not consult the `ownKeys` trap, so
        // collect every own key through the method table and drop the indices.
        PropertyNameArrayBuilder allProperties(vm, nameMode, PrivateSymbolMode::Exclude);
        object->methodTable()->getOwnPropertyNames(object, globalObject, allProperties, dontEnumMode);
        RETURN_IF_EXCEPTION(scope, {});
        for (const auto& identifier : allProperties) {
            if (parseIndex(identifier))
                continue;
            properties.add(identifier);
        }
    } else {
        object->getOwnNonIndexPropertyNames(globalObject, properties, dontEnumMode);
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSArray* result = constructEmptyArray(globalObject, nullptr, properties.size());
    RETURN_IF_EXCEPTION(scope, {});
    unsigned index = 0;
    for (const auto& identifier : properties) {
        JSValue key;
        if (identifier.isSymbol())
            key = Symbol::create(vm, static_cast<SymbolImpl&>(*identifier.impl()));
        else
            key = jsOwnedString(vm, identifier.string());
        result->putDirectIndex(globalObject, index++, key);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(result);
}

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

    JSObject* options = Bun::createInspectOptionsObject(vm, globalObject, max_depth, colors);
    RETURN_IF_EXCEPTION(scope, {});

    JSFunction* inspectFn = globalObject->utilInspectFunction();
    RETURN_IF_EXCEPTION(scope, {});
    auto callData = JSC::getCallData(functionToCall);
    MarkedArgumentBuffer arguments;
    arguments.append(jsNumber(depth));
    arguments.append(options);
    arguments.append(inspectFn);

    auto inspectRet = JSC::profiledCall(globalObject, ProfilingReason::API, functionToCall, callData, thisValue, arguments);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(inspectRet));
}

}
