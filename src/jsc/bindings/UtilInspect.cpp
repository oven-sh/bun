#include "root.h"
#include "headers.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSFunction.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/PropertyNameArray.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/IdentifierInlines.h"
#include "JavaScriptCore/ArrayPrototype.h"
#include "JavaScriptCore/BigIntObject.h"
#include "JavaScriptCore/BigIntPrototype.h"
#include "JavaScriptCore/BooleanObject.h"
#include "JavaScriptCore/BooleanPrototype.h"
#include "JavaScriptCore/DatePrototype.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/JSMapInlines.h"
#include "JavaScriptCore/JSSetInlines.h"
#include "JavaScriptCore/NumberObject.h"
#include "JavaScriptCore/NumberPrototype.h"
#include "JavaScriptCore/ObjectPrototype.h"
#include "JavaScriptCore/RegExpObject.h"
#include "JavaScriptCore/RegExpPrototype.h"
#include "JavaScriptCore/StringObject.h"
#include "JavaScriptCore/StringPrototype.h"
#include "JavaScriptCore/SymbolObject.h"
#include "JavaScriptCore/SymbolPrototype.h"
#include "BunString.h"

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

// The prototypes that own `toString` or `Symbol.toPrimitive` among the names Node counts as built-in.
// Error.prototype is left out: String(error) is `name: message`, and `%s` keeps that line where Node prints the stack.
static bool isPrototypeWithGenericToString(JSObject* object)
{
    const ClassInfo* info = object->classInfo();
    return info == ObjectPrototype::info() || info == FunctionPrototype::info() || info == ArrayPrototype::info()
        || info == DatePrototype::info() || info == RegExpPrototype::info() || info == StringPrototype::info()
        || info == NumberPrototype::info() || info == BooleanPrototype::info() || info == SymbolPrototype::info()
        || info == BigIntPrototype::info();
}

// The kinds of object that `%s` inspects. The formatter prints each other kind through code of
// the object (the `length` of an arguments object, the iterator of a Map subclass, the getters
// of an Event), uses it up (an iterator) or prints many lines (a Response).
static bool isInspectedKind(JSObject* object)
{
    switch (object->type()) {
    case ObjectType:
    case FinalObjectType:
    case ArrayType:
    case DerivedArrayType:
    case JSDateType:
    case JSPromiseType:
    case ArrayBufferType:
    case DataViewType:
    case StringObjectType:
    case DerivedStringObjectType:
    case NumberObjectType:
    case BooleanObjectType:
    case RegExpObjectType:
        return true;
    case JSMapType: {
        auto* map = uncheckedDowncast<JSMap>(object);
        return map->structure() == map->realm()->mapStructure() && map->isIteratorProtocolFastAndNonObservable();
    }
    case JSSetType: {
        auto* set = uncheckedDowncast<JSSet>(object);
        return set->structure() == set->realm()->setStructure() && set->isIteratorProtocolFastAndNonObservable();
    }
    default:
        return false;
    }
}

// Whether `%s` inspects `object`. Otherwise it prints String(object).
//
// This is the rule of Node's util.format (`hasBuiltInToString`, lib/internal/util/inspect.js):
// an object converts when `toString` or `Symbol.toPrimitive` is its own, or comes from a
// prototype that is not a built-in one. Any other object is inspected, with these limits:
// - String(object) stays for a kind that isInspectedKind leaves out, for a React element,
//   and for an object with a custom inspect function, which `%s` does not call.
// - An object with no conversion at all is inspected in every case, because String(object) throws.
//
// Runs no user code. An accessor, or a Proxy on the prototype chain, counts as the object's own
// conversion: String(object) then runs that code once. Pass the target of a Proxy.
extern "C" bool Bun__isInspectedByStringSpecifier(JSC::EncodedJSValue encodedValue, JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSObject* object = JSValue::decode(encodedValue).getObject();
    ASSERT(object);

    enum class Property : uint8_t {
        Missing,
        NotCallable,
        Callable,
        // An accessor, or an object that cannot answer without running code.
        Unknown,
    };
    enum class Search : uint8_t {
        // As in a read of the property, the first object of the prototype chain that has it decides.
        PrototypeChain,
        OwnOnly,
    };
    auto find = [&](PropertyName name, Search search, JSObject*& holder) {
        PropertySlot slot(object, PropertySlot::InternalMethodType::VMInquiry, &vm);
        bool found = search == Search::OwnOnly ? object->methodTable()->getOwnPropertySlot(object, globalObject, name, slot) : object->getPropertySlot(globalObject, name, slot);
        scope.assertNoExceptionExceptTermination();
        if (!found)
            return slot.isTaintedByOpaqueObject() ? Property::Unknown : Property::Missing;
        if (!slot.isValue())
            return Property::Unknown;
        holder = slot.slotBase();
        return slot.getValue(globalObject, name).isCallable() ? Property::Callable : Property::NotCallable;
    };

    JSObject* holder = nullptr;
    bool hasConversion = false;
    for (PropertyName name : { PropertyName(vm.propertyNames->toString), PropertyName(vm.propertyNames->toPrimitiveSymbol) }) {
        Property conversion = find(name, Search::PrototypeChain, holder);
        if (conversion == Property::Unknown)
            return false;
        if (conversion == Property::Callable) {
            if (holder == object || !isPrototypeWithGenericToString(holder))
                return false;
            hasConversion = true;
        }
    }
    if (!hasConversion)
        return true;

    if (!isInspectedKind(object))
        return false;
    auto& builtinNames = WebCore::clientData(vm)->builtinNames();
    if (find(builtinNames.$$typeofPublicName(), Search::OwnOnly, holder) != Property::Missing)
        return false;
    Property customInspect = find(builtinNames.inspectCustomPublicName(), Search::PrototypeChain, holder);
    return customInspect == Property::Missing || customInspect == Property::NotCallable;
}

// The primitive inside a String, Number, Boolean, Symbol or BigInt object. Any other value as it is.
extern "C" JSC::EncodedJSValue Bun__wrappedPrimitive(JSC::EncodedJSValue encodedValue)
{
    JSValue value = JSValue::decode(encodedValue);
    // JSWrapperObject has no ClassInfo of its own, so a downcast to it accepts any object.
    if (value.inherits<NumberObject>() || value.inherits<StringObject>() || value.inherits<BooleanObject>() || value.inherits<SymbolObject>() || value.inherits<BigIntObject>())
        return JSValue::encode(uncheckedDowncast<JSWrapperObject>(value)->internalValue());
    return encodedValue;
}

// `/source/flags` of a RegExp, from its internal slots.
extern "C" BunString Bun__regExpSource(JSC::EncodedJSValue encodedValue)
{
    if (auto* object = dynamicDowncast<RegExpObject>(JSValue::decode(encodedValue)))
        return Bun::toStringRef(object->regExp()->toSourceString());
    return BunStringEmpty;
}

}
