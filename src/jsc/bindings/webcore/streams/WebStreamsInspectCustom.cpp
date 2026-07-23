#include "config.h"
#include "WebStreamsInspectCustom.h"

#include "BunClientData.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <wtf/text/MakeString.h>

namespace Bun {
namespace WebStreams {

using namespace JSC;

EncodedJSValue customInspect(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame, JSValue thisValue, ASCIILiteral name, JSObject* data)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue depthValue = callFrame->argument(0);
    JSValue optionsValue = callFrame->argument(1);

    double depth = depthValue.toNumber(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (depth < 0)
        return JSValue::encode(thisValue);

    // opts = { ...options, depth: options.depth == null ? null : options.depth - 1 }
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
        CLEAR_IF_EXCEPTION(scope);
        if (has) {
            JSValue ctorValue = slot.getValue(lexicalGlobalObject, vm.propertyNames->constructor);
            CLEAR_IF_EXCEPTION(scope);
            if (ctorValue.isCallable()) {
                JSValue nameValue = ctorValue.get(lexicalGlobalObject, vm.propertyNames->name);
                CLEAR_IF_EXCEPTION(scope);
                if (nameValue.isString()) {
                    String name = asString(nameValue)->value(lexicalGlobalObject);
                    CLEAR_IF_EXCEPTION(scope);
                    if (!name.isEmpty())
                        return name;
                }
            }
        }
        JSValue proto = obj->getPrototype(lexicalGlobalObject);
        CLEAR_IF_EXCEPTION(scope);
        obj = proto.getObject();
    }
    return fallback;
}

void installInspectCustom(VM& vm, JSObject* prototype, NativeFunction nativeFunction)
{
    auto* globalObject = prototype->globalObject();
    prototype->putDirectNativeFunction(vm, globalObject, WebCore::builtinNames(vm).inspectCustomPublicName(), 2,
        nativeFunction, ImplementationVisibility::Public, NoIntrinsic,
        static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum));
}

} // namespace WebStreams
} // namespace Bun
