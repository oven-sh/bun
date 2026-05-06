#include "root.h"
#include "helpers.h"
#include "BunClientData.h"
#include <string.h>
#ifdef _WIN32
#include <uv.h>
#endif

using namespace JSC;

JSValue createSystemError(JSGlobalObject* global, ASCIILiteral message, ASCIILiteral syscall, int err)
{
    auto* instance = createError(global, String(message));
    auto& vm = global->vm();
    auto& builtinNames = WebCore::builtinNames(vm);
    instance->putDirect(vm, builtinNames.syscallPublicName(), jsString(vm, String(syscall)), 0);
    instance->putDirect(vm, builtinNames.errnoPublicName(), jsNumber(err), 0);
    instance->putDirect(vm, vm.propertyNames->name, jsString(vm, String("SystemError"_s)), PropertyAttribute::DontEnum | 0);
    return instance;
}

JSValue createSystemError(JSGlobalObject* global, ASCIILiteral syscall, int err)
{
    auto errstr = String::fromLatin1(Bun__errnoName(err));
#ifdef _WIN32
    auto strerr = uv_strerror(err);
#else
    auto strerr = strerror(err);
#endif
    auto* instance = JSC::createError(global, makeString(syscall, "() failed: "_s, errstr, ": "_s, String::fromLatin1(strerr)));
    auto& vm = global->vm();
    auto& builtinNames = WebCore::builtinNames(vm);
    instance->putDirect(vm, builtinNames.syscallPublicName(), jsString(vm, String(syscall)), 0);
    instance->putDirect(vm, builtinNames.errnoPublicName(), jsNumber(err), 0);
    instance->putDirect(vm, vm.propertyNames->name, jsString(vm, String("SystemError"_s)), PropertyAttribute::DontEnum | 0);
    instance->putDirect(vm, builtinNames.codePublicName(), jsString(vm, errstr));
    return instance;
}
