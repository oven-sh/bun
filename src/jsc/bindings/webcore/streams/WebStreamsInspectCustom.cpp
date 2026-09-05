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

    JSObject* opts = copyInspectOptions(lexicalGlobalObject, optionsValue);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue childDepth = jsNull();
    if (optionsValue.isObject()) {
        JSValue optionsDepth = asObject(optionsValue)->get(lexicalGlobalObject, Identifier::fromString(vm, "depth"_s));
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

JSObject* copyInspectOptions(JSGlobalObject* lexicalGlobalObject, JSValue optionsValue)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* copy = constructEmptyObject(lexicalGlobalObject);
    JSObject* options = optionsValue.getObject();
    if (!options)
        return copy;

    PropertyNameArrayBuilder names(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    options->methodTable()->getOwnPropertyNames(options, lexicalGlobalObject, names, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, nullptr);
    for (const auto& name : names) {
        JSValue value = options->get(lexicalGlobalObject, name);
        RETURN_IF_EXCEPTION(scope, nullptr);
        copy->putDirectMayBeIndex(lexicalGlobalObject, name, value);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    return copy;
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

void installInspectCustom(VM& vm, JSObject* prototype, NativeFunction nativeFunction)
{
    auto* globalObject = prototype->globalObject();
    // Matches Node: { writable: true, enumerable: false, configurable: true }.
    prototype->putDirectNativeFunction(vm, globalObject, WebCore::builtinNames(vm).inspectCustomPublicName(), 2,
        nativeFunction, ImplementationVisibility::Public, NoIntrinsic,
        static_cast<unsigned>(JSC::PropertyAttribute::DontEnum));
}

} // namespace WebStreams
} // namespace Bun
