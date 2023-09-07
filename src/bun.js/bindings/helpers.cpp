#include "root.h"
#include "helpers.h"
#include "BunClientData.h"

JSC::JSValue createSystemError(JSC::JSGlobalObject* global, ASCIILiteral message, ASCIILiteral syscall, int err)
{
    auto* instance = JSC::createError(global, String(message));
    auto& vm = global->vm();
    auto& builtinNames = WebCore::builtinNames(vm);
    instance->putDirect(vm, builtinNames.syscallPublicName(), jsString(vm, String(syscall)), 0);
    instance->putDirect(vm, builtinNames.errnoPublicName(), JSC::jsNumber(err), 0);
    instance->putDirect(vm, vm.propertyNames->name, jsString(vm, String("SystemError"_s)), JSC::PropertyAttribute::DontEnum | 0);
    return instance;
}

JSC::JSValue createSystemError(JSC::JSGlobalObject* global, ASCIILiteral syscall, int err)
{
    auto* instance = JSC::createError(global, makeString(String(syscall), "() failed"_s));
    auto& vm = global->vm();
    auto& builtinNames = WebCore::builtinNames(vm);
    instance->putDirect(vm, builtinNames.syscallPublicName(), jsString(vm, String(syscall)), 0);
    instance->putDirect(vm, builtinNames.errnoPublicName(), JSC::jsNumber(err), 0);
    instance->putDirect(vm, vm.propertyNames->name, jsString(vm, String("SystemError"_s)), JSC::PropertyAttribute::DontEnum | 0);
    return instance;
}