#include "root.h"

#include "NodeEventEmitterPrototype.h"

#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include "WebCoreJSBuiltins.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/Symbol.h>
#include <wtf/text/SymbolRegistry.h>

namespace Bun {

using namespace JSC;
using namespace WebCore;

using BuiltinName = WebCore::BunBuiltinNames::Name;
using Generator = FunctionExecutable* (*)(VM&);

// The functions that the methods call, each under the `$name` that a builtin reads it by.
static constexpr struct {
    BuiltinName name;
    Generator generator;
} helpers[] = {
    { BuiltinName::k_nodeEventsAddListener, eventEmitterPrototypeInternalAddListenerCodeGenerator },
    { BuiltinName::k_nodeEventsApplyHandlers, eventEmitterPrototypeApplyHandlersCodeGenerator },
    { BuiltinName::k_nodeEventsCopyWithInserted, eventEmitterPrototypeCopyWithInsertedCodeGenerator },
    { BuiltinName::k_nodeEventsCreateEmit, eventEmitterPrototypeCreateEmitCodeGenerator },
    { BuiltinName::k_nodeEventsEmitError, eventEmitterPrototypeEmitErrorCodeGenerator },
    { BuiltinName::k_nodeEventsOnceWrap, eventEmitterPrototypeInternalOnceWrapCodeGenerator },
    { BuiltinName::k_nodeEventsOverflowWarning, eventEmitterPrototypeOverflowWarningCodeGenerator },
};

// The own keys of the prototype, in the order that the object literal of events.ts had. src/js/node/events.ts
// assigns the two that have no generator: `constructor` is its function, and `emit` has a rest parameter, which
// a builtin cannot have, so a call of $nodeEventsCreateEmit creates it.
static constexpr struct {
    ASCIILiteral name;
    Generator generator;
    ASCIILiteral alias;
} methods[] = {
    { "setMaxListeners"_s, eventEmitterPrototypeSetMaxListenersCodeGenerator, {} },
    { "constructor"_s, nullptr, {} },
    { "getMaxListeners"_s, eventEmitterPrototypeGetMaxListenersCodeGenerator, {} },
    { "emit"_s, nullptr, {} },
    { "addListener"_s, eventEmitterPrototypeAddListenerCodeGenerator, "on"_s },
    { "prependListener"_s, eventEmitterPrototypePrependListenerCodeGenerator, {} },
    { "once"_s, eventEmitterPrototypeOnceCodeGenerator, {} },
    { "prependOnceListener"_s, eventEmitterPrototypePrependOnceListenerCodeGenerator, {} },
    { "removeListener"_s, eventEmitterPrototypeRemoveListenerCodeGenerator, "off"_s },
    { "removeAllListeners"_s, eventEmitterPrototypeRemoveAllListenersCodeGenerator, {} },
    { "listeners"_s, eventEmitterPrototypeListenersCodeGenerator, {} },
    { "rawListeners"_s, eventEmitterPrototypeRawListenersCodeGenerator, {} },
    { "listenerCount"_s, eventEmitterPrototypeListenerCountCodeGenerator, {} },
    { "eventNames"_s, eventEmitterPrototypeEventNamesCodeGenerator, {} },
};

JSValue nodeEventEmitterPrototype(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& names = WebCore::builtinNames(vm);

    // The globals are defined here and not at startup, so that a global object that never has an emitter does not
    // pay for them. `$nodeEventsPrototype` is the last one: it is defined when the rest is.
    JSValue existing = globalObject->get(globalObject, names.nodeEventsPrototypePrivateName());
    RETURN_IF_EXCEPTION(scope, {});
    if (existing.isObject())
        return existing;

    constexpr unsigned constant = PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly;
    // events.defaultMaxListeners and events.setMaxListeners(n) assign this one.
    globalObject->addBuiltinGlobal(names.nodeEventsDefaultMaxListenersPrivateName(), jsNumber(10), PropertyAttribute::DontEnum | 0);
    globalObject->addBuiltinGlobal(names.nodeEventsKShapeModePrivateName(), Symbol::createWithDescription(vm, "shapeMode"_s), constant);
    globalObject->addBuiltinGlobal(names.nodeEventsKErrorMonitorPrivateName(), Symbol::create(vm, vm.symbolRegistry().symbolForKey("events.errorMonitor"_s)), constant);
    for (auto& helper : helpers)
        globalObject->addBuiltinGlobal(names.privateName(helper.name), JSFunction::create(vm, globalObject, helper.generator(vm), globalObject), constant);

    auto* prototype = constructEmptyObject(globalObject, globalObject->objectPrototype());
    for (auto& method : methods) {
        auto name = Identifier::fromString(vm, method.name);
        if (!method.generator) {
            prototype->putDirect(vm, name, jsUndefined());
            continue;
        }
        auto* function = prototype->putDirectBuiltinFunction(vm, globalObject, name, method.generator(vm), 0);
        if (!method.alias.isNull())
            prototype->putDirect(vm, Identifier::fromString(vm, method.alias), function);
    }

    globalObject->addBuiltinGlobal(names.nodeEventsPrototypePrivateName(), prototype, constant);
    return prototype;
}

}
