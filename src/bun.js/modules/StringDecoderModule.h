#include "../bindings/ZigGlobalObject.h"
#include "../bindings/JSStringDecoder.h"
#include "JavaScriptCore/JSGlobalObject.h"

namespace Zig {

inline void generateStringDecoderSourceCode(JSC::JSGlobalObject* lexicalGlobalObject, JSC::Identifier moduleKey, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues) {
    JSC::VM& vm = lexicalGlobalObject->vm();
    GlobalObject* globalObject = reinterpret_cast<GlobalObject*>(lexicalGlobalObject);

    exportNames.append(JSC::Identifier::fromString(vm, "StringDecoder"_s));
    exportValues.append(JSC::JSFunction::create(vm, globalObject, 0, "StringDecoder"_s, WebCore::constructJSStringDecoder, ImplementationVisibility::Public, NoIntrinsic, WebCore::constructJSStringDecoder));
}

}
