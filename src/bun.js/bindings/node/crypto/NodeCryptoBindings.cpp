#include "root.h"
#include "JSDiffieHellman.h"
#include "JSDiffieHellmanPrototype.h"
#include "JSDiffieHellmanConstructor.h"
#include "JSDiffieHellmanGroup.h"
#include "JSDiffieHellmanGroupConstructor.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSCJSValueInlines.h>

extern "C" JSC::EncodedJSValue Bun__DiffieHellmanConstructor(Zig::GlobalObject* globalObject)
{
    return JSC::JSValue::encode(globalObject->m_JSDiffieHellmanClassStructure.constructor(globalObject));
}

extern "C" JSC::EncodedJSValue Bun__DiffieHellmanGroupConstructor(Zig::GlobalObject* globalObject)
{
    return JSC::JSValue::encode(globalObject->m_JSDiffieHellmanGroupClassStructure.constructor(globalObject));
}
