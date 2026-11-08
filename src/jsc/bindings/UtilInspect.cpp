#include "root.h"
#include "headers.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSFunction.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "ZigGlobalObject.h"
#include "JSBuffer.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/PropertyNameArray.h"
#include "JavaScriptCore/JSArray.h"
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

// The test of Node's formatValue for a prototype object, on data properties only: no getter and no Proxy trap runs.
static NEVER_INLINE bool isPrototypeOfItsConstructor(VM& vm, JSGlobalObject* globalObject, JSObject* object)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Through the method table: `constructor` of a WebCore prototype is a native custom value.
    PropertySlot constructorSlot(object, PropertySlot::InternalMethodType::GetOwnProperty);
    bool hasConstructor = object->methodTable()->getOwnPropertySlot(object, globalObject, vm.propertyNames->constructor, constructorSlot);
    RETURN_IF_EXCEPTION(scope, false);
    if (!hasConstructor || constructorSlot.isAccessor() || (constructorSlot.attributes() & PropertyAttribute::CustomAccessor))
        return false;
    JSValue constructorValue = constructorSlot.getValue(globalObject, vm.propertyNames->constructor);
    RETURN_IF_EXCEPTION(scope, false);
    JSObject* constructor = constructorValue.getObject();
    if (!constructor)
        return false;

    PropertySlot prototypeSlot(constructor, PropertySlot::InternalMethodType::VMInquiry, &vm);
    bool hasPrototype = constructor->getNonIndexPropertySlot(globalObject, vm.propertyNames->prototype, prototypeSlot);
    RETURN_IF_EXCEPTION(scope, false);
    if (!hasPrototype || !prototypeSlot.isValue())
        return false;
    RELEASE_AND_RETURN(scope, prototypeSlot.getValue(globalObject, vm.propertyNames->prototype) == JSValue(object));
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

    if (JSObject* thisObject = thisValue.getObject()) {
        // An instance has no own `constructor`: the Structure of an ordinary object or a typed array (a Buffer) says so.
        auto flags = thisObject->inlineTypeFlags();
        bool structureListsOwnProperties = !TypeInfo::hasStaticPropertyTable(flags)
            && (!TypeInfo::overridesGetOwnPropertySlot(flags) || isTypedArrayType(thisObject->type()));
        if (!structureListsOwnProperties || thisObject->hasDirectProperty(globalObject, vm.propertyNames->constructor)) {
            bool isPrototype = isPrototypeOfItsConstructor(vm, globalObject, thisObject);
            RETURN_IF_EXCEPTION(scope, {});
            // The formatter prints a result that is the receiver itself without the hook.
            if (isPrototype)
                return JSValue::encode(thisValue);
        }
    }

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
