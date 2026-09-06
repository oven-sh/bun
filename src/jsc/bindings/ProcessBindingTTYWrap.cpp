#include "root.h"

#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSDestructibleObject.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/Identifier.h"

#include <JavaScriptCore/ObjectConstructor.h>

#include "BunTTYState.h"
#include "ProcessBindingTTYWrap.h"
#include "NodeTTYModule.h"
#include "WebCoreJSBuiltins.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSTypedArrays.h>

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

#if OS(WINDOWS)
extern "C" int Source__setRawModeStdin(uv_loop_t* uv_loop, bool raw);
#endif

namespace Bun {

using namespace JSC;

static bool getWindowSize(int fd, size_t* width, size_t* height)
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
        return false;

    if (!GetConsoleScreenBufferInfo(handle, &csbi))
        return false;

    *width = csbi.srWindow.Right - csbi.srWindow.Left + 1;
    *height = csbi.srWindow.Bottom - csbi.srWindow.Top + 1;
    return true;
#else
    struct winsize ws;
    int err;
    do
        err = ioctl(fd, TIOCGWINSZ, &ws);
    while (err == -1 && errno == EINTR);

    if (err == -1)
        return false;

    *width = ws.ws_col;
    *height = ws.ws_row;

    return true;
#endif
}

extern "C" bool Bun__ttyGetWindowSize(int fd, size_t* width, size_t* height)
{
    return getWindowSize(fd, width, height);
}

JSC_DEFINE_HOST_FUNCTION(jsTTYSetMode, (JSC::JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if OS(WINDOWS)
    ASSERT(callFrame->argumentCount() == 1);
    auto flag = callFrame->argument(0);
    bool raw = flag.asBoolean();

    Zig::GlobalObject* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);

    return JSValue::encode(jsNumber(Source__setRawModeStdin(global->uvLoop(), raw)));
#else
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() != 3) {
        throwTypeError(globalObject, scope, "Expected 3 arguments"_s);
        return {};
    }

    JSValue fd = callFrame->argument(0);
    if (!fd.isNumber()) {
        throwTypeError(globalObject, scope, "fd must be a number"_s);
        return {};
    }

    JSValue mode = callFrame->argument(1);

    auto fdToUse = fd.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Nodejs does not throw when ttySetMode fails. An Error event is emitted instead.
    int mode_ = mode.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // The per-stream state buffer node:tty hands back on every call. Holding it
    // in JS keeps its lifetime tied to the stream that owns the mode. Validated
    // after the coercions above so a detach triggered from inside them is caught.
    auto* state = dynamicDowncast<JSC::JSUint8Array>(callFrame->argument(2));
    if (!state || state->isDetached() || state->length() < Bun__ttyStateSize()) {
        throwTypeError(globalObject, scope, "state must be a Uint8Array of rawModeStateSize bytes"_s);
        return {};
    }
    int err = Bun__ttySetMode(fdToUse, mode_, state->typedVector(), 1);
    return JSValue::encode(jsNumber(err));
#endif
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
    if (!getWindowSize(fd, &width, &height)) {
        return JSC::JSValue::encode(jsBoolean(false));
    }

    array->putDirectIndex(globalObject, 0, jsNumber(width));
    RETURN_IF_EXCEPTION(throwScope, {});
    array->putDirectIndex(globalObject, 1, jsNumber(height));
    RETURN_IF_EXCEPTION(throwScope, {});

    return JSC::JSValue::encode(jsBoolean(true));
}

JSValue createBunTTYFunctions(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto* obj = constructEmptyObject(globalObject);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "isatty"_s)), JSFunction::create(vm, globalObject, 0, "isatty"_s, Zig::jsFunctionTty_isatty, ImplementationVisibility::Public), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "setRawMode"_s)), JSFunction::create(vm, globalObject, 0, "ttySetMode"_s, jsTTYSetMode, ImplementationVisibility::Public), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "getWindowSize"_s)), JSFunction::create(vm, globalObject, 0, "getWindowSize"_s, Bun::Process_functionInternalGetWindowSize, ImplementationVisibility::Public), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "rawModeStateSize"_s)), jsNumber(static_cast<unsigned>(Bun__ttyStateSize())), 0);

    return obj;
}

JSValue createNodeTTYWrapObject(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto* obj = constructEmptyObject(globalObject);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "isTTY"_s)), JSFunction::create(vm, globalObject, 0, "isatty"_s, Zig::jsFunctionTty_isatty, ImplementationVisibility::Public), 0);

    // The `TTY` handle class is generated from src/runtime/node/tty_wrap.classes.ts.
    auto* constructor = uncheckedDowncast<Zig::GlobalObject>(globalObject)->JSTTYConstructor();
    obj->putDirect(vm, Identifier::fromString(vm, "TTY"_s), constructor, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete);

    return obj;
}
}
