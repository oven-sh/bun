#include "../bindings/ZigGlobalObject.h"
#include "JavaScriptCore/JSGlobalObject.h"

namespace Zig {

inline void generateBufferSourceCode(JSC::JSGlobalObject* lexicalGlobalObject, JSC::Identifier moduleKey, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues) {
    JSC::VM& vm = lexicalGlobalObject->vm();
    GlobalObject* globalObject = reinterpret_cast<GlobalObject*>(lexicalGlobalObject);

    exportNames.append(JSC::Identifier::fromString(vm, "Buffer"_s));
    exportValues.append(WebCore::JSBuffer::getConstructor(vm, globalObject));

    // substitute after JSBlob is implemented.
    exportNames.append(JSC::Identifier::fromString(vm, "Blob"_s));
    exportValues.append(JSC::jsUndefined());

    exportNames.append(JSC::Identifier::fromString(vm, "INSPECT_MAX_BYTES"_s));
    exportValues.append(JSC::jsNumber(50));

    exportNames.append(JSC::Identifier::fromString(vm, "kMaxLength"_s));
    exportValues.append(JSC::jsNumber(4294967296LL));

    exportNames.append(JSC::Identifier::fromString(vm, "kMaxLength"_s));
    exportValues.append(JSC::jsNumber(536870888));
}

}
