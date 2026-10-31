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
#include "JavaScriptCore/AOTHost.h"
#include "JavaScriptCore/BigIntObject.h"
#include "JavaScriptCore/DisallowVMEntry.h"
#include "JavaScriptCore/FunctionExecutable.h"
#include "JavaScriptCore/InternalFunction.h"
#include "JavaScriptCore/JSArrayBuffer.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "JavaScriptCore/JSBoundFunction.h"
#include "JavaScriptCore/JSFunctionInlines.h"
#include "JavaScriptCore/JSRemoteFunction.h"
#include "JavaScriptCore/SymbolObject.h"
#include "ErrorCode.h"

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

// A port of V8's JSReceiver::class_name() (LICENSE.md), null where that answers "Object": https://github.com/nodejs/node/blob/b7e6a5d37e7a14ef0f2cc95214b95d66c4081415/deps/v8/src/objects/js-objects.cc#L535-L591
static ASCIILiteral v8ClassName(VM& vm, JSObject* object)
{
    UNUSED_PARAM(vm);
    if (object->isCallable())
        return "Function"_s;
    auto type = object->type();
    if (isTypedArrayType(type)) {
        // V8 has a second set of elements kinds (RAB_GSAB_*) for a view of a resizable buffer and for a length-tracking view of a growable shared buffer. class_name() lists only the first set.
        if (!uncheckedDowncast<JSArrayBufferView>(object)->canUseRawFieldsDirectly())
            return {};
        return object->classInfo()->className;
    }
    switch (type) {
    case DirectArgumentsType:
    case ScopedArgumentsType:
    case ClonedArgumentsType:
        return "Arguments"_s;
    case ArrayType:
    case DerivedArrayType:
        return "Array"_s;
    case ArrayBufferType:
        return uncheckedDowncast<JSArrayBuffer>(object)->isShared() ? "SharedArrayBuffer"_s : "ArrayBuffer"_s;
    case JSArrayIteratorType:
        return "Array Iterator"_s;
    case JSDateType:
        return "Date"_s;
    case ErrorInstanceType:
        return "Error"_s;
    case JSGeneratorType:
    case JSAsyncGeneratorType:
        return "Generator"_s;
    case JSMapType:
        return "Map"_s;
    case JSMapIteratorType:
        return "Map Iterator"_s;
    case RegExpObjectType:
        return "RegExp"_s;
    case JSSetType:
        return "Set"_s;
    case JSSetIteratorType:
        return "Set Iterator"_s;
    case BooleanObjectType:
        return "Boolean"_s;
    case StringObjectType:
    case DerivedStringObjectType:
        return "String"_s;
    case NumberObjectType:
        return "Number"_s;
    case JSWeakMapType:
        return "WeakMap"_s;
    case JSWeakSetType:
        return "WeakSet"_s;
    default:
        break;
    }
#if ENABLE(AOT)
    if (vm.hasCompiledCode() && AOT::isGeneratorObject(object))
        return "Generator"_s;
#endif
    if (object->inherits<BigIntObject>())
        return "BigInt"_s;
    if (object->inherits<SymbolObject>())
        return "Symbol"_s;
    return {};
}

// The name a function was made with, or null when V8 does not take the value for a constructor. V8's debug name can also be a name that V8 infers from the source (`ns.Widget = function () {}`), which JSC does not keep.
static JSString* constructorDebugName(JSGlobalObject* globalObject, JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSString* name = nullptr;
#if ENABLE(AOT)
    // A function that `bun build --compile --aot` compiled has no executable. The first value of its `name` stands for the name it was made with, and a function of the program that a computed key names has none.
    if (vm.hasCompiledCode() && value.isCell() && AOT::CompiledCallee::isCompiledCallee(value.asCell())) {
        JSObject* callee = asObject(value);
        if (AOT::CompiledCallee::isBoundFunction(callee))
            return nullptr;
        if (!AOT::belongsToBuiltinModule(callee) && AOT::CompiledCallee::displayName(callee).isEmpty())
            return nullptr;
        name = jsString(vm, AOT::CompiledCallee::name(callee));
    }
#endif
    if (!name) {
        if (auto* function = dynamicDowncast<JSFunction>(value)) {
            if (function->inherits<JSBoundFunction>() || function->inherits<JSRemoteFunction>())
                return nullptr;
            // A computed key names a function when the program runs, so the function was made with no name. For a getter under such a key JSC would answer `get `.
            if (!function->isHostFunction() && function->jsExecutable()->ecmaName().isEmpty())
                return nullptr;
            name = function->originalName(globalObject);
            RETURN_IF_EXCEPTION(scope, nullptr);
        } else if (auto* function = dynamicDowncast<InternalFunction>(value))
            name = jsString(vm, function->name());
        else
            return nullptr;
    }

    auto view = name->view(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (view->isEmpty() || view.data == "Object"_s)
        return nullptr;
    return name;
}

// An own data property, read straight from the storage of the object as V8's OWN_SKIP_INTERCEPTOR lookup reads it: no getter, no Proxy trap and no lookup hook of a class runs.
static JSValue ownDataProperty(VM& vm, JSObject* object, PropertyName name)
{
    unsigned attributes;
    JSValue value = object->getDirect(vm, name, attributes);
    if (!value || (attributes & PropertyAttribute::AccessorOrCustomAccessorOrValue))
        return {};
    return value;
}

#if ENABLE(AOT)
// The namespace of a module that `bun build --compile --aot` compiled keeps its Symbol.toStringTag out of its storage. Its lookup answers an inquiry for the tag and runs no code.
static JSValue tagOfCompiledModuleNamespace(JSGlobalObject* globalObject, JSObject* moduleNamespace)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    PropertySlot slot(moduleNamespace, PropertySlot::InternalMethodType::VMInquiry, &vm);
    bool hasTag = moduleNamespace->methodTable()->getOwnPropertySlot(moduleNamespace, globalObject, vm.propertyNames->toStringTagSymbol, slot);
    RETURN_IF_EXCEPTION(scope, {});
    if (!hasTag || !slot.isValue())
        return {};
    return slot.getValue(globalObject, vm.propertyNames->toStringTagSymbol);
}
#endif

// A port of the walk of V8's GetConstructorHelper (LICENSE.md): https://github.com/nodejs/node/blob/b7e6a5d37e7a14ef0f2cc95214b95d66c4081415/deps/v8/src/objects/js-objects.cc#L594-L686
static JSString* getConstructorName(JSGlobalObject* globalObject, JSObject* receiver)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    DisallowVMEntry disallowVMEntry(vm);

    // V8 first takes the constructor that made the receiver. JSC records no such constructor, so the lookup starts at the chain.
    for (JSObject* object = receiver; object;) {
        // A class, its prototype object and a function that `bun build --compile --aot` compiled make their own properties when something first looks for one.
        if (vm.hasCompiledCode()) [[unlikely]] {
            AOT::PropertyWalk::materializeLazyProperties(vm, object);
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
        JSValue tag = ownDataProperty(vm, object, vm.propertyNames->toStringTagSymbol);
#if ENABLE(AOT)
        if (vm.hasCompiledCode() && AOT::isModuleNamespace(object)) {
            tag = tagOfCompiledModuleNamespace(globalObject, object);
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
#endif
        if (tag && tag.isString())
            return asString(tag);

        // The `constructor` of the receiver itself does not count: it names what the receiver is a prototype of.
        if (object != receiver) {
            if (JSValue constructor = ownDataProperty(vm, object, vm.propertyNames->constructor)) {
                JSString* name = constructorDebugName(globalObject, constructor);
                RETURN_IF_EXCEPTION(scope, nullptr);
                if (name)
                    return name;
            }
        }

        // A Proxy and `import.meta` answer getPrototypeOf themselves. The prototype in their structure is not the one they report, so the walk ends.
        if (object->structure()->typeInfo().overridesGetPrototype())
            break;
        JSValue prototype = object->getPrototypeDirect();
        object = prototype.isObject() ? asObject(prototype) : nullptr;
    }

    ASCIILiteral name = v8ClassName(vm, receiver);
    return jsNontrivialString(vm, name.isNull() ? "Object"_s : name);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionGetConstructorName, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue value = callFrame->argument(0);
    if (!value.isObject()) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "object"_s, "object"_s, value);
    RELEASE_AND_RETURN(scope, JSValue::encode(getConstructorName(globalObject, asObject(value))));
}

}
