#include "root.h"

#include "NodeEventEmitterPrototype.h"

#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include "WebCoreJSBuiltins.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/Symbol.h>
#include <wtf/text/SymbolRegistry.h>

namespace Bun {

using namespace JSC;

// What a builtin that exists to create a function returns. Empty when the call threw.
static JSValue callFactory(VM& vm, JSGlobalObject* globalObject, FunctionExecutable* executable)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* factory = JSFunction::create(vm, globalObject, executable, globalObject);
    JSValue function = JSC::profiledCall(globalObject, ProfilingReason::API, factory, JSC::getCallData(factory), jsUndefined(), ArgList());
    RETURN_IF_EXCEPTION(scope, {});
    return function;
}

// The functions that the methods of EventEmitter.prototype call, by the private name that a method reads them under.
struct NodeEventsHelper {
    WebCore::BunBuiltinNames::Name name;
    FunctionExecutable* (*generator)(VM&);
};
static constexpr NodeEventsHelper nodeEventsHelpers[] = {
    { WebCore::BunBuiltinNames::Name::k_nodeEventsAddListener, WebCore::eventEmitterPrototypeInternalAddListenerCodeGenerator },
    { WebCore::BunBuiltinNames::Name::k_nodeEventsApplyHandlers, WebCore::eventEmitterPrototypeApplyHandlersCodeGenerator },
    { WebCore::BunBuiltinNames::Name::k_nodeEventsCopyWithInserted, WebCore::eventEmitterPrototypeCopyWithInsertedCodeGenerator },
    { WebCore::BunBuiltinNames::Name::k_nodeEventsEmitError, WebCore::eventEmitterPrototypeEmitErrorCodeGenerator },
    { WebCore::BunBuiltinNames::Name::k_nodeEventsOnceWrap, WebCore::eventEmitterPrototypeInternalOnceWrapCodeGenerator },
    { WebCore::BunBuiltinNames::Name::k_nodeEventsOverflowWarning, WebCore::eventEmitterPrototypeOverflowWarningCodeGenerator },
};

// A helper, or the `emit` that captures rejections, becomes a function when it is first read.
JSC_DEFINE_CUSTOM_GETTER(getNodeEventsFunction, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue, PropertyName name))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& names = WebCore::builtinNames(vm);
    constexpr unsigned attributes = PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly;

    for (auto& helper : nodeEventsHelpers) {
        if (name == names.privateName(helper.name))
            return JSValue::encode(globalObject->putDirectBuiltinFunction(vm, globalObject, name, helper.generator(vm), attributes | PropertyAttribute::Builtin));
    }

    ASSERT(name == names.nodeEventsEmitWithRejectionCapturePrivateName());
    JSValue emit = callFactory(vm, globalObject, WebCore::eventEmitterPrototypeCreateEmitWithRejectionCaptureCodeGenerator(vm));
    RETURN_IF_EXCEPTION(scope, {});
    globalObject->putDirect(vm, name, emit, attributes);
    return JSValue::encode(emit);
}

// The state of node:events that no emitter holds, and the helpers: one set per global, which the global object
// itself holds as own properties under private names. A builtin then reads one as a global variable, which the
// JITs fold to a constant; a field of a separate holder object would be loaded on every read.
static void putState(VM& vm, Zig::GlobalObject* globalObject)
{
    auto& names = WebCore::builtinNames(vm);
    if (globalObject->getDirect(vm, names.nodeEventsKCapturePrivateName()))
        return;

    constexpr unsigned constant = PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly;
    globalObject->putDirect(vm, names.nodeEventsDefaultMaxListenersPrivateName(), jsNumber(10), PropertyAttribute::DontEnum | PropertyAttribute::DontDelete);
    globalObject->putDirect(vm, names.nodeEventsKCapturePrivateName(), Symbol::createWithDescription(vm, "kCapture"_s), constant);
    globalObject->putDirect(vm, names.nodeEventsKShapeModePrivateName(), Symbol::createWithDescription(vm, "shapeMode"_s), constant);
    globalObject->putDirect(vm, names.nodeEventsKErrorMonitorPrivateName(), Symbol::create(vm, vm.symbolRegistry().symbolForKey("events.errorMonitor"_s)), constant);
    globalObject->putDirect(vm, names.nodeEventsKRejectionPrivateName(), Symbol::create(vm, vm.symbolRegistry().symbolForKey("nodejs.rejection"_s)), constant);

    auto* lazyFunction = CustomGetterSetter::create(vm, getNodeEventsFunction, nullptr);
    constexpr unsigned lazy = PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::CustomValue;
    for (auto& helper : nodeEventsHelpers)
        globalObject->putDirectCustomAccessor(vm, names.privateName(helper.name), lazyFunction, lazy);
    globalObject->putDirectCustomAccessor(vm, names.nodeEventsEmitWithRejectionCapturePrivateName(), lazyFunction, lazy);
}

JSValue nodeEventEmitterState(Zig::GlobalObject* globalObject, NodeEventEmitterState state)
{
    static constexpr WebCore::BunBuiltinNames::Name stateNames[] = {
        WebCore::BunBuiltinNames::Name::k_nodeEventsDefaultMaxListeners,
        WebCore::BunBuiltinNames::Name::k_nodeEventsKCapture,
        WebCore::BunBuiltinNames::Name::k_nodeEventsKShapeMode,
        WebCore::BunBuiltinNames::Name::k_nodeEventsKErrorMonitor,
        WebCore::BunBuiltinNames::Name::k_nodeEventsKRejection,
        WebCore::BunBuiltinNames::Name::k_nodeEventsEmitWithRejectionCapture,
    };
    auto index = static_cast<size_t>(state);
    ASSERT(index < std::size(stateNames));

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    putState(vm, globalObject);
    // Not getDirect(): the function is behind getNodeEventsFunction until something reads it.
    JSValue value = globalObject->get(globalObject, WebCore::builtinNames(vm).privateName(stateNames[index]));
    RETURN_IF_EXCEPTION(scope, {});
    return value;
}

}
