#include "root.h"

#include "JavaScriptCore/Identifier.h"
#include <JavaScriptCore/ObjectConstructor.h>

#include "ProcessBindingPipeWrap.h"
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

extern "C" SYSV_ABI JSC::EncodedJSValue Pipe__getConstructor(Zig::GlobalObject*);

JSValue createNodePipeWrapObject(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto* obj = constructEmptyObject(globalObject);

    auto* zigGlobal = jsCast<Zig::GlobalObject*>(globalObject);
    obj->putDirect(vm, Identifier::fromString(vm, "Pipe"_s), JSValue::decode(Pipe__getConstructor(zigGlobal)), JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete);

    auto* constants = constructEmptyObject(globalObject);
    constants->putDirect(vm, Identifier::fromString(vm, "SOCKET"_s), jsNumber(0));
    constants->putDirect(vm, Identifier::fromString(vm, "SERVER"_s), jsNumber(1));
    constants->putDirect(vm, Identifier::fromString(vm, "IPC"_s), jsNumber(2));
    constants->putDirect(vm, Identifier::fromString(vm, "UV_READABLE"_s), jsNumber(1));
    constants->putDirect(vm, Identifier::fromString(vm, "UV_WRITABLE"_s), jsNumber(2));
    obj->putDirect(vm, Identifier::fromString(vm, "constants"_s), constants, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete);

    return obj;
}

}
