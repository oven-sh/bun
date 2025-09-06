#include "root.h"
#include "JSYogaConstructor.h"
#include "ZigGlobalObject.h"

using namespace JSC;

extern "C" {

JSC::EncodedJSValue Bun__JSYogaConfigConstructor(Zig::GlobalObject* globalObject)
{
    return JSValue::encode(globalObject->m_JSYogaConfigClassStructure.constructor(globalObject));
}

JSC::EncodedJSValue Bun__JSYogaNodeConstructor(Zig::GlobalObject* globalObject)
{
    return JSValue::encode(globalObject->m_JSYogaNodeClassStructure.constructor(globalObject));
}

} // extern "C"
