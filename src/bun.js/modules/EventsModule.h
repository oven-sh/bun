#include "../bindings/ZigGlobalObject.h"
#include "JavaScriptCore/JSGlobalObject.h"

namespace Zig {

inline void generateEventsSourceCode(JSC::JSGlobalObject* lexicalGlobalObject, JSC::Identifier moduleKey, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues) {
    JSC::VM& vm = lexicalGlobalObject->vm();
    GlobalObject* globalObject = reinterpret_cast<GlobalObject*>(lexicalGlobalObject);

    exportNames.append(JSC::Identifier::fromString(vm, "EventEmitter"_s));
    exportValues.append(WebCore::JSEventEmitter::getConstructor(vm, globalObject));
}

}
