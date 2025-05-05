#include "root.h"
#include "helpers.h"
#include "BunClientData.h"
#include <string.h>
#include "uv.h"

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
    auto* instance = createError(global, makeString(syscall, "() failed: "_s, errstr, ": "_s, String::fromLatin1(strerror(err))));
    auto& vm = global->vm();
    auto& builtinNames = WebCore::builtinNames(vm);
    instance->putDirect(vm, builtinNames.syscallPublicName(), jsString(vm, String(syscall)), 0);
    instance->putDirect(vm, builtinNames.errnoPublicName(), jsNumber(err), 0);
    instance->putDirect(vm, vm.propertyNames->name, jsString(vm, String("SystemError"_s)), PropertyAttribute::DontEnum | 0);
    instance->putDirect(vm, builtinNames.codePublicName(), jsString(vm, errstr));
    return instance;
}

// UVException from node, without path or dest arguments
// https://github.com/nodejs/node/blob/4acb85403950320773352ab127bee9fc85818153/src/api/exceptions.cc#L91
JSValue createUVError(JSGlobalObject* global, int err, ASCIILiteral syscall, const char* message)
{
    auto& vm = global->vm();
    auto& builtinNames = WebCore::builtinNames(vm);

    if (!message || !message[0]) {
        message = uv_strerror(err);
    }

    String codeString = String::fromUTF8(uv_err_name(err));
    String messageString = String::fromUTF8(message);

    WTF::StringBuilder messageBuilder;
    messageBuilder.append(std::span { message, strlen(message) });
    messageBuilder.append(", "_s);
    messageBuilder.append(syscall);

    JSObject* error = createError(global, messageBuilder.toString());

    error->putDirect(vm, builtinNames.errnoPublicName(), jsNumber(err), 0);
    error->putDirect(vm, builtinNames.codePublicName(), jsString(vm, codeString), 0);
    error->putDirect(vm, builtinNames.syscallPublicName(), jsString(vm, String(syscall)), 0);

    // TODO: path and dest

    return error;
}
