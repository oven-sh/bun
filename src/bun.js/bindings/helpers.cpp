#include "root.h"
#include "helpers.h"
#include "BunClientData.h"
#include <string.h>

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
    auto errstr = String::fromLatin1(Bun__errnoName(err));
    auto* instance = JSC::createError(global, makeString(syscall, "() failed: "_s, errstr, ": "_s, String::fromLatin1(strerror(err))));
    auto& vm = global->vm();
    auto& builtinNames = WebCore::builtinNames(vm);
    instance->putDirect(vm, builtinNames.syscallPublicName(), jsString(vm, String(syscall)), 0);
    instance->putDirect(vm, builtinNames.errnoPublicName(), JSC::jsNumber(err), 0);
    instance->putDirect(vm, vm.propertyNames->name, jsString(vm, String("SystemError"_s)), JSC::PropertyAttribute::DontEnum | 0);
    instance->putDirect(vm, builtinNames.codePublicName(), jsString(vm, errstr));
    return instance;
}
