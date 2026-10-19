#include "config.h"
#include "WebStreamsInspectCustom.h"

#include "BunClientData.h"
#include "InternalModuleRegistry.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ProxyObject.h>
#include <wtf/text/MakeString.h>

namespace WebCore {
JSC_DECLARE_HOST_FUNCTION(jsFetchHeadersPrototypeFunction_inspectCustom);
JSC_DECLARE_HOST_FUNCTION(jsDOMFormDataPrototypeFunction_inspectCustom);
JSC_DECLARE_HOST_FUNCTION(jsAbortSignalPrototypeFunction_inspectCustom);
JSC_DECLARE_HOST_FUNCTION(jsAbortControllerPrototypeFunction_inspectCustom);
JSC_DECLARE_HOST_FUNCTION(jsEventPrototypeFunction_inspectCustom);
}

namespace Bun {
namespace WebStreams {

using namespace JSC;

EncodedJSValue customInspect(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame, JSValue thisValue, ASCIILiteral name, JSObject* data)
{
    return customInspect(lexicalGlobalObject, callFrame, thisValue, WTF::String(name), data);
}

EncodedJSValue customInspect(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame, JSValue thisValue, const WTF::String& name, JSObject* data)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue depthValue = callFrame->argument(0);
    JSValue optionsValue = callFrame->argument(1);

    double depth = depthValue.toNumber(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (depth < 0)
        return JSValue::encode(thisValue);

    JSObject* opts = constructEmptyObject(lexicalGlobalObject);
    JSValue childDepth = jsNull();
    if (optionsValue.isObject()) {
        JSObject* options = asObject(optionsValue);
        PropertyNameArrayBuilder names(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
        options->getPropertyNames(lexicalGlobalObject, names, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, {});
        for (size_t i = 0; i < names.size(); ++i) {
            JSValue v = options->get(lexicalGlobalObject, names[i]);
            RETURN_IF_EXCEPTION(scope, {});
            opts->putDirect(vm, names[i], v, 0);
        }
        JSValue optionsDepth = options->get(lexicalGlobalObject, Identifier::fromString(vm, "depth"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!optionsDepth.isUndefinedOrNull()) {
            double d = optionsDepth.toNumber(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
            childDepth = jsNumber(d - 1);
        }
    }
    opts->putDirect(vm, Identifier::fromString(vm, "depth"_s), childDepth, 0);

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSFunction* utilInspect = globalObject->utilInspectFunction();
    RETURN_IF_EXCEPTION(scope, {});
    auto callData = JSC::getCallData(utilInspect);
    MarkedArgumentBuffer arguments;
    arguments.append(data);
    arguments.append(opts);
    ASSERT(!arguments.hasOverflowed());

    JSValue inspected = JSC::profiledCall(lexicalGlobalObject, ProfilingReason::API, utilInspect, callData, jsUndefined(), arguments);
    RETURN_IF_EXCEPTION(scope, {});

    auto* inspectedString = inspected.toString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto view = inspectedString->view(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsString(vm, makeString(name, " "_s, view.data)));
}

WTF::String constructorNameOf(JSGlobalObject* lexicalGlobalObject, JSValue thisValue, ASCIILiteral fallback)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* obj = thisValue.getObject();
    while (obj) {
        PropertySlot slot(obj, PropertySlot::InternalMethodType::GetOwnProperty);
        bool has = obj->methodTable()->getOwnPropertySlot(obj, lexicalGlobalObject, vm.propertyNames->constructor, slot);
        RETURN_IF_EXCEPTION(scope, fallback);
        if (has) {
            JSValue ctorValue = slot.getValue(lexicalGlobalObject, vm.propertyNames->constructor);
            RETURN_IF_EXCEPTION(scope, fallback);
            if (!ctorValue.isEmpty() && ctorValue.isCallable()) {
                JSValue nameValue = ctorValue.get(lexicalGlobalObject, vm.propertyNames->name);
                RETURN_IF_EXCEPTION(scope, fallback);
                if (!nameValue.isEmpty() && nameValue.isString()) {
                    String name = asString(nameValue)->value(lexicalGlobalObject);
                    RETURN_IF_EXCEPTION(scope, fallback);
                    if (!name.isEmpty())
                        return name;
                }
            }
        }
        JSValue proto = obj->getPrototype(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, fallback);
        if (proto.isEmpty())
            break;
        obj = proto.getObject();
    }
    return fallback;
}

// The methods that the native formatter does not call, known by the address of the host function.
static constexpr NativeFunction handWrittenNodeOnlyInspectHooks[] = {
    WebCore::jsFetchHeadersPrototypeFunction_inspectCustom,
    WebCore::jsDOMFormDataPrototypeFunction_inspectCustom,
    WebCore::jsAbortSignalPrototypeFunction_inspectCustom,
    WebCore::jsAbortControllerPrototypeFunction_inspectCustom,
    WebCore::jsEventPrototypeFunction_inspectCustom,
};

static bool isNodeOnlyInspectHook(TaggedNativeFunction function)
{
    for (auto hook : handWrittenNodeOnlyInspectHooks) {
        if (function == toTagged(hook))
            return true;
    }
    for (size_t i = 0; i < generatedNodeOnlyInspectHookCount; ++i) {
        if (function == toTagged(generatedNodeOnlyInspectHooks[i]))
            return true;
    }
    return false;
}

static bool isNodeOnlyInspectHook(JSValue value)
{
    auto* function = dynamicDowncast<JSFunction>(value);
    return function && function->isHostFunction() && isNodeOnlyInspectHook(function->nativeFunction());
}

// For the native formatter: it does not list such a function under the method's key.
extern "C" bool Bun__isNodeOnlyInspectHook(EncodedJSValue encodedValue)
{
    return isNodeOnlyInspectHook(JSValue::decode(encodedValue));
}

// For the native formatter: `method`, or when that is node-only, the method that `value` has above it, or nothing.
extern "C" EncodedJSValue Bun__inspectCustomForFormatter(JSGlobalObject* globalObject, EncodedJSValue encodedValue, EncodedJSValue encodedMethod)
{
    JSValue method = JSValue::decode(encodedMethod);
    if (!isNodeOnlyInspectHook(method))
        return encodedMethod;
    auto& vm = JSC::getVM(globalObject);
    auto& name = WebCore::builtinNames(vm).inspectCustomPublicName();
    // As the formatter's own lookup, this does not look at Object.prototype.
    JSObject* objectPrototype = globalObject->objectPrototype();
    for (JSObject* object = JSValue::decode(encodedValue).getObject(); object && object != objectPrototype && object->type() != ProxyObjectType; object = object->getPrototypeDirect().getObject()) {
        JSValue own = object->getDirect(vm, name);
        if (own && !isNodeOnlyInspectHook(own))
            return JSValue::encode(own);
    }
    return {};
}

void installInspectCustom(VM& vm, JSObject* prototype, NativeFunction nativeFunction)
{
    auto* globalObject = prototype->globalObject();
    auto& inspectCustom = WebCore::builtinNames(vm).inspectCustomPublicName();
    // Matches Node: { writable: true, enumerable: false, configurable: true }.
    auto attributes = static_cast<unsigned>(JSC::PropertyAttribute::DontEnum);
    if (isNodeOnlyInspectHook(toTagged(nativeFunction))) {
        prototype->putDirect(vm, inspectCustom, JSFunction::create(vm, globalObject, 2, "[nodejs.util.inspect.custom]"_s, nativeFunction, ImplementationVisibility::Public), attributes);
        return;
    }
    prototype->putDirectNativeFunction(vm, globalObject, inspectCustom, 2, nativeFunction, ImplementationVisibility::Public, NoIntrinsic, attributes);
}

JSObject* inspectHolder(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    JSObject* object = callFrame->thisValue().toThis(globalObject, ECMAMode::strict()).getObject();
    while (object && object->type() == ProxyObjectType) {
        auto* proxy = uncheckedDowncast<ProxyObject>(object);
        if (proxy->isRevoked())
            return nullptr;
        object = proxy->target();
    }
    return object;
}

JSObject* findInspectInstance(JSObject* holder, const ClassInfo* info)
{
    for (JSObject* object = holder; object && object->type() != ProxyObjectType; object = object->getPrototypeDirect().getObject()) {
        if (object->inherits(info))
            return object;
    }
    return nullptr;
}

EncodedJSValue inspectFields(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame, ASCIILiteral tag, JSObject* fields, JSObject* instance)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // A bare call passes a scope object as `this`. It must not reach script.
    JSValue self = callFrame->thisValue().toThis(lexicalGlobalObject, ECMAMode::strict());
    RETURN_IF_EXCEPTION(scope, {});
    JSObject* holder = inspectHolder(lexicalGlobalObject, callFrame);

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue inspectHook = globalObject->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::Field::InternalUtilInspectHooks);
    RETURN_IF_EXCEPTION(scope, {});

    MarkedArgumentBuffer arguments;
    arguments.append(jsString(vm, WTF::String(tag)));
    arguments.append(self);
    arguments.append(callFrame->argument(0));
    arguments.append(callFrame->argument(1));
    arguments.append(fields ? JSValue(fields) : jsUndefined());
    arguments.append(holder ? JSValue(holder) : jsUndefined());
    arguments.append(instance ? JSValue(instance) : jsUndefined());
    arguments.append(callFrame->jsCallee());
    ASSERT(!arguments.hasOverflowed());

    JSValue result = JSC::profiledCall(lexicalGlobalObject, ProfilingReason::API, inspectHook, JSC::getCallData(inspectHook), jsUndefined(), arguments);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

// For the readers of the classes in *.classes.ts files (src/runtime/webcore/node_inspect.rs).
extern "C" EncodedJSValue Bun__inspectFields(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame, EncodedJSValue encodedInstance, EncodedJSValue encodedFields, const char* tag)
{
    return inspectFields(lexicalGlobalObject, callFrame, ASCIILiteral::fromLiteralUnsafe(tag), asObject(JSValue::decode(encodedFields)), asObject(JSValue::decode(encodedInstance)));
}

} // namespace WebStreams
} // namespace Bun
