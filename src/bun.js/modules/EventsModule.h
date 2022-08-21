#include "../bindings/ZigGlobalObject.h"
#include "JavaScriptCore/JSGlobalObject.h"

namespace Zig {

inline void generateEventsSourceCode(JSC::JSGlobalObject* lexicalGlobalObject, JSC::Identifier moduleKey, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues) {
    JSC::VM& vm = lexicalGlobalObject->vm();
    GlobalObject* globalObject = reinterpret_cast<GlobalObject*>(lexicalGlobalObject);

    exportNames.append(JSC::Identifier::fromString(vm, "EventEmitter"_s));
    exportValues.append(WebCore::JSEventEmitter::getConstructor(vm, globalObject));

    exportNames.append(JSC::Identifier::fromString(vm, "getEventListeners"_s));
    exportValues.append(JSC::JSFunction::create(vm, lexicalGlobalObject, 0,
        MAKE_STATIC_STRING_IMPL("getEventListeners"), Events_functionGetEventListeners, ImplementationVisibility::Public));
    exportNames.append(JSC::Identifier::fromString(vm, "listenerCount"_s));
    exportValues.append(JSC::JSFunction::create(vm, lexicalGlobalObject, 0,
        MAKE_STATIC_STRING_IMPL("listenerCount"), Events_functionListenerCount, ImplementationVisibility::Public));
    exportNames.append(JSC::Identifier::fromString(vm, "once"_s));
    exportValues.append(JSC::JSFunction::create(vm, lexicalGlobalObject, 0,
        MAKE_STATIC_STRING_IMPL("once"), Events_functionOnce, ImplementationVisibility::Public));
    exportNames.append(JSC::Identifier::fromString(vm, "on"_s));
    exportValues.append(JSC::JSFunction::create(vm, lexicalGlobalObject, 0,
        MAKE_STATIC_STRING_IMPL("on"), Events_functionOn, ImplementationVisibility::Public));
}

}
