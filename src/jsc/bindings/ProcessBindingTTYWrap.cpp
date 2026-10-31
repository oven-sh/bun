#include "root.h"

#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSDestructibleObject.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/Identifier.h"

#include <JavaScriptCore/ObjectConstructor.h>

#include "ProcessBindingTTYWrap.h"
#include "GeneratedTtyWrap.h"
#include "NodeTTYModule.h"
#include "WebCoreJSBuiltins.h"
#include <JavaScriptCore/FunctionPrototype.h>

#ifndef WIN32
#include <errno.h>
#include <dlfcn.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <netdb.h>
#include <unistd.h>
#include <sys/utsname.h>
#else
#include <uv.h>
#include <io.h>
#include <fcntl.h>

#endif

namespace Bun {

using namespace JSC;

// 0, or the negative libuv errno that uv_tty_get_winsize() answers.
static int getWindowSize(int fd, size_t* width, size_t* height)
{
#if OS(WINDOWS)
    CONSOLE_SCREEN_BUFFER_INFO csbi;
    HANDLE handle = INVALID_HANDLE_VALUE;
    switch (fd) {
    case 0:
        handle = GetStdHandle(STD_INPUT_HANDLE);
        break;
    case 1:
        handle = GetStdHandle(STD_OUTPUT_HANDLE);
        break;
    case 2:
        handle = GetStdHandle(STD_ERROR_HANDLE);
        break;
    default:
        break;
    }
    if (handle == INVALID_HANDLE_VALUE)
        return UV_EBADF;

    if (!GetConsoleScreenBufferInfo(handle, &csbi))
        return uv_translate_sys_error(GetLastError());

    *width = csbi.srWindow.Right - csbi.srWindow.Left + 1;
    *height = csbi.srWindow.Bottom - csbi.srWindow.Top + 1;
    return 0;
#else
    struct winsize ws;
    int err;
    do
        err = ioctl(fd, TIOCGWINSZ, &ws);
    while (err == -1 && errno == EINTR);

    if (err == -1)
        return -errno;

    *width = ws.ws_col;
    *height = ws.ws_row;

    return 0;
#endif
}

extern "C" int32_t Bun__ttyGetWindowSize(int fd, size_t* width, size_t* height)
{
    return getWindowSize(fd, width, height);
}

JSC_DEFINE_HOST_FUNCTION(Process_functionInternalGetWindowSize,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto argCount = callFrame->argumentCount();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (argCount == 0) {
        JSC::throwTypeError(globalObject, throwScope, "getWindowSize requires 2 argument (a file descriptor)"_s);
        return {};
    }

    int fd = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    JSC::JSArray* array = dynamicDowncast<JSC::JSArray>(callFrame->uncheckedArgument(1));
    if (!array || array->length() < 2) {
        JSC::throwTypeError(globalObject, throwScope, "getWindowSize requires 2 argument (an array)"_s);
        return {};
    }

    size_t width, height;
    if (getWindowSize(fd, &width, &height) != 0) {
        return JSC::JSValue::encode(jsBoolean(false));
    }

    array->putDirectIndex(globalObject, 0, jsNumber(width));
    RETURN_IF_EXCEPTION(throwScope, {});
    array->putDirectIndex(globalObject, 1, jsNumber(height));
    RETURN_IF_EXCEPTION(throwScope, {});

    return JSC::JSValue::encode(jsBoolean(true));
}

// `ctx` is the caller's object: each field is stored with [[Set]], in the order of Node's CollectUVExceptionInfo.
extern "C" [[ZIG_EXPORT(false_is_throw)]] bool Bun__TTY__collectInitError(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedCtx, int32_t uvError, JSC::EncodedJSValue code, JSC::EncodedJSValue message)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* ctx = asObject(JSValue::decode(encodedCtx));
    const std::pair<Identifier, JSValue> fields[] = {
        { Identifier::fromString(vm, "errno"_s), jsNumber(uvError) },
        { Identifier::fromString(vm, "code"_s), JSValue::decode(code) },
        { vm.propertyNames->message, JSValue::decode(message) },
        { Identifier::fromString(vm, "syscall"_s), jsNontrivialString(vm, "uv_tty_init"_s) },
    };
    for (const auto& [name, value] : fields) {
        PutPropertySlot slot(ctx, false);
        ctx->methodTable()->put(ctx, globalObject, name, value, slot);
        RETURN_IF_EXCEPTION(scope, false);
    }
    return true;
}

JSValue createBunTTYFunctions(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto* obj = constructEmptyObject(globalObject);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "isatty"_s)), JSFunction::create(vm, globalObject, 0, "isatty"_s, Zig::jsFunctionTty_isatty, ImplementationVisibility::Public), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "getWindowSize"_s)), JSFunction::create(vm, globalObject, 0, "getWindowSize"_s, Bun::Process_functionInternalGetWindowSize, ImplementationVisibility::Public), 0);

    return obj;
}

JSValue createNodeTTYWrapObject(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto* obj = constructEmptyObject(globalObject);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "isTTY"_s)), JSFunction::create(vm, globalObject, 0, "isatty"_s, Zig::jsFunctionTty_isatty, ImplementationVisibility::Public), 0);

    // The `TTY` handle class is generated from src/runtime/node/tty_wrap.bind.ts.
    JSValue constructor = Bun::Bindgen::constructorForClass<Bun::Bindgen::Generated::JSTTY>(globalObject);
    obj->putDirect(vm, Identifier::fromString(vm, "TTY"_s), constructor, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete);

    return obj;
}
}
