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

JSValue nodeEventEmitterPrototype(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto& names = WebCore::builtinNames(vm);
    if (JSValue prototype = globalObject->getDirect(vm, names.nodeEventsPrototypePrivateName()))
        return prototype;

    // A builtin reads a `$nodeEvents` name as a global variable: an own property of the global object under a
    // private name. They are defined here and not at startup, so a global that never has an emitter pays nothing.
    constexpr unsigned constant = PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly;
    auto helper = [&](const Identifier& name, FunctionExecutable* executable) {
        globalObject->putDirectBuiltinFunction(vm, globalObject, name, executable, constant);
    };
    // events.defaultMaxListeners and events.setMaxListeners(n) assign this one.
    globalObject->putDirect(vm, names.nodeEventsDefaultMaxListenersPrivateName(), jsNumber(10), PropertyAttribute::DontEnum | PropertyAttribute::DontDelete);
    globalObject->putDirect(vm, names.nodeEventsKShapeModePrivateName(), Symbol::createWithDescription(vm, "shapeMode"_s), constant);
    globalObject->putDirect(vm, names.nodeEventsKErrorMonitorPrivateName(), Symbol::create(vm, vm.symbolRegistry().symbolForKey("events.errorMonitor"_s)), constant);
    helper(names.nodeEventsAddListenerPrivateName(), eventEmitterPrototypeInternalAddListenerCodeGenerator(vm));
    helper(names.nodeEventsApplyHandlersPrivateName(), eventEmitterPrototypeApplyHandlersCodeGenerator(vm));
    helper(names.nodeEventsCopyWithInsertedPrivateName(), eventEmitterPrototypeCopyWithInsertedCodeGenerator(vm));
    helper(names.nodeEventsCreateEmitPrivateName(), eventEmitterPrototypeCreateEmitCodeGenerator(vm));
    helper(names.nodeEventsEmitErrorPrivateName(), eventEmitterPrototypeEmitErrorCodeGenerator(vm));
    helper(names.nodeEventsOnceWrapPrivateName(), eventEmitterPrototypeInternalOnceWrapCodeGenerator(vm));
    helper(names.nodeEventsOverflowWarningPrivateName(), eventEmitterPrototypeOverflowWarningCodeGenerator(vm));

    // 16 names here, and events.ts adds two.
    auto* prototype = constructEmptyObject(globalObject, globalObject->objectPrototype(), 18);
    auto method = [&](ASCIILiteral name, FunctionExecutable* executable) {
        return prototype->putDirectBuiltinFunction(vm, globalObject, Identifier::fromString(vm, name), executable, 0);
    };
    // The order of the keys is the order that the plain object of events.ts had. events.ts assigns the two names
    // that are undefined here: `constructor` is its function, and `emit` has a rest parameter, which a builtin
    // cannot have, so a call into JavaScript creates it.
    method("setMaxListeners"_s, eventEmitterPrototypeSetMaxListenersCodeGenerator(vm));
    prototype->putDirect(vm, vm.propertyNames->constructor, jsUndefined());
    method("getMaxListeners"_s, eventEmitterPrototypeGetMaxListenersCodeGenerator(vm));
    prototype->putDirect(vm, Identifier::fromString(vm, "emit"_s), jsUndefined());
    auto* addListener = method("addListener"_s, eventEmitterPrototypeAddListenerCodeGenerator(vm));
    prototype->putDirect(vm, Identifier::fromString(vm, "on"_s), addListener);
    method("prependListener"_s, eventEmitterPrototypePrependListenerCodeGenerator(vm));
    method("once"_s, eventEmitterPrototypeOnceCodeGenerator(vm));
    method("prependOnceListener"_s, eventEmitterPrototypePrependOnceListenerCodeGenerator(vm));
    auto* removeListener = method("removeListener"_s, eventEmitterPrototypeRemoveListenerCodeGenerator(vm));
    prototype->putDirect(vm, Identifier::fromString(vm, "off"_s), removeListener);
    method("removeAllListeners"_s, eventEmitterPrototypeRemoveAllListenersCodeGenerator(vm));
    method("listeners"_s, eventEmitterPrototypeListenersCodeGenerator(vm));
    method("rawListeners"_s, eventEmitterPrototypeRawListenersCodeGenerator(vm));
    method("listenerCount"_s, eventEmitterPrototypeListenerCountCodeGenerator(vm));
    method("eventNames"_s, eventEmitterPrototypeEventNamesCodeGenerator(vm));

    globalObject->putDirect(vm, names.nodeEventsPrototypePrivateName(), prototype, constant);
    return prototype;
}

}
