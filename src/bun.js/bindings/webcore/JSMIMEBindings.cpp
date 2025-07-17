#include "root.h"
#include "JSMIMEParams.h"
#include "JSMIMEType.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSCJSValueInlines.h"
#include "ZigGlobalObject.h"

namespace WebCore {

using namespace JSC;

// Create the combined MIME binding object with both MIMEParams and MIMEType
JSValue createMIMEBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    JSObject* obj = constructEmptyObject(globalObject);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "MIMEParams"_s)), globalObject->m_JSMIMEParamsClassStructure.constructor(globalObject));
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "MIMEType"_s)), globalObject->m_JSMIMETypeClassStructure.constructor(globalObject));

    return obj;
}

} // namespace WebCore
