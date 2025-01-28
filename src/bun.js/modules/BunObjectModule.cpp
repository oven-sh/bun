#include "root.h"

#include "ZigGlobalObject.h"

#include "ObjectModule.h"

namespace Zig {
void generateNativeModule_BunObject(JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::Identifier moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    // FIXME: this does not add each property as a top level export
    JSC::VM& vm = lexicalGlobalObject->vm();
    Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    JSObject* object = globalObject->bunObject();

    exportNames.append(vm.propertyNames->defaultKeyword);
    exportValues.append(object);
}

} // namespace Zig
