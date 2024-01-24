#include "root.h"

#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/Identifier.h"

#include <JavaScriptCore/ObjectConstructor.h>

#include "ProcessBindingTTYWrap.h"
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

class TTYWrapObject final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static TTYWrapObject* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, int fd)
    {
        TTYWrapObject* object = new (NotNull, JSC::allocateCell<TTYWrapObject>(vm)) TTYWrapObject(vm, structure, fd);
        object->finishCreation(vm);
        return object;
    }

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;

        return WebCore::subspaceForImpl<TTYWrapObject, UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForTTYWrapObject.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForTTYWrapObject = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForTTYWrapObject.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForTTYWrapObject = std::forward<decltype(space)>(space); });
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSObject* prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    int fd = -1;

private:
    TTYWrapObject(JSC::VM& vm, JSC::Structure* structure, const int fd)
        : Base(vm, structure)
        , fd(fd)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);

        ASSERT(inherits(info()));
    }
};

const ClassInfo TTYWrapObject::s_info = {
    "LibuvStreamWrap"_s,

    &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(TTYWrapObject)
};

JSC::EncodedJSValue Process_functionInternalGetWindowSize(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);

extern "C" int Bun__ttySetMode(int fd, int mode);

JSC_DEFINE_HOST_FUNCTION(jsTTYSetMode, (JSC::JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() != 2) {
        throwTypeError(globalObject, scope, "Expected 2 arguments"_s);
        return JSValue::encode(jsUndefined());
    }

    JSValue fd = callFrame->argument(0);
    if (!fd.isNumber()) {
        throwTypeError(globalObject, scope, "fd must be a number"_s);
        return JSValue::encode(jsUndefined());
    }

    JSValue mode = callFrame->argument(1);
    if (!mode.isNumber()) {
        throwTypeError(globalObject, scope, "mode must be a number"_s);
        return JSValue::encode(jsUndefined());
    }

    // Nodejs does not throw when ttySetMode fails. An Error event is emitted instead.
    int err = Bun__ttySetMode(fd.asNumber(), mode.toInt32(globalObject));
    return JSValue::encode(jsNumber(err));
}

JSC_DEFINE_HOST_FUNCTION(TTYWrap_functionSetMode,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto argCount = callFrame->argumentCount();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (argCount == 0) {
        JSC::throwTypeError(globalObject, throwScope, "setRawMode requires 1 argument (a number)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    TTYWrapObject* ttyWrap = jsDynamicCast<TTYWrapObject*>(callFrame->thisValue());
    if (UNLIKELY(!ttyWrap)) {
        JSC::throwTypeError(globalObject, throwScope, "TTY.setRawMode expects a TTYWrapObject as this"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    int fd = ttyWrap->fd;
    JSValue mode = callFrame->argument(0);
    if (!mode.isNumber()) {
        throwTypeError(globalObject, throwScope, "mode must be a number"_s);
        return JSValue::encode(jsUndefined());
    }

    // Nodejs does not throw when ttySetMode fails. An Error event is emitted instead.
    int err = Bun__ttySetMode(fd, mode.toInt32(globalObject));
    return JSValue::encode(jsNumber(err));
}

JSC_DEFINE_HOST_FUNCTION(TTYWrap_functionGetWindowSize,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto argCount = callFrame->argumentCount();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (argCount == 0) {
        JSC::throwTypeError(globalObject, throwScope, "getWindowSize requires 1 argument (an array)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    TTYWrapObject* ttyWrap = jsDynamicCast<TTYWrapObject*>(callFrame->thisValue());
    if (UNLIKELY(!ttyWrap)) {
        JSC::throwTypeError(globalObject, throwScope, "TTY.getWindowSize expects a TTYWrapObject as this"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    int fd = ttyWrap->fd;
    JSC::JSArray* array = jsDynamicCast<JSC::JSArray*>(callFrame->uncheckedArgument(0));
    if (!array || array->length() < 2) {
        JSC::throwTypeError(globalObject, throwScope, "getWindowSize expects an array"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    size_t width, height;
    if (!getWindowSize(fd, &width, &height)) {
        return JSC::JSValue::encode(jsBoolean(false));
    }

    array->putDirectIndex(globalObject, 0, jsNumber(width));
    array->putDirectIndex(globalObject, 1, jsNumber(height));

    return JSC::JSValue::encode(jsBoolean(true));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionInternalGetWindowSize,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto argCount = callFrame->argumentCount();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (argCount == 0) {
        JSC::throwTypeError(globalObject, throwScope, "getWindowSize requires 2 argument (a file descriptor)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    int fd = callFrame->uncheckedArgument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    JSC::JSArray* array = jsDynamicCast<JSC::JSArray*>(callFrame->uncheckedArgument(1));
    if (!array || array->length() < 2) {
        JSC::throwTypeError(globalObject, throwScope, "getWindowSize requires 2 argument (an array)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    size_t width, height;
    if (!getWindowSize(fd, &width, &height)) {
        return JSC::JSValue::encode(jsBoolean(false));
    }

    array->putDirectIndex(globalObject, 0, jsNumber(width));
    array->putDirectIndex(globalObject, 1, jsNumber(height));

    return JSC::JSValue::encode(jsBoolean(true));
}

static const HashTableValue TTYWrapPrototypeValues[] = {
    { "getWindowSize"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, TTYWrap_functionGetWindowSize, 1 } },
    { "setRawMode"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, TTYWrap_functionSetMode, 0 } },
};

class TTYWrapPrototype final : public JSC::JSNonFinalObject {
public:
    DECLARE_INFO;
    using Base = JSC::JSNonFinalObject;

    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return Structure::create(vm, globalObject, globalObject->objectPrototype(), TypeInfo(ObjectType, StructureFlags), info());
    }

    static TTYWrapPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        TTYWrapPrototype* prototype = new (NotNull, JSC::allocateCell<TTYWrapPrototype>(vm)) TTYWrapPrototype(vm, structure);
        prototype->finishCreation(vm, globalObject);
        return prototype;
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(TTYWrapPrototype, Base);
        return &vm.plainObjectSpace();
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);

        auto* clientData = WebCore::clientData(vm);
        auto& builtinNames = clientData->builtinNames();

        reifyStaticProperties(vm, TTYWrapObject::info(), TTYWrapPrototypeValues, *this);
        JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    }

    TTYWrapPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

const ClassInfo TTYWrapPrototype::s_info = {
    "LibuvStreamWrap"_s,

    &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(TTYWrapPrototype)
};

class TTYWrapConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static TTYWrapConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSObject* prototype)
    {
        TTYWrapConstructor* constructor = new (NotNull, JSC::allocateCell<TTYWrapConstructor>(vm)) TTYWrapConstructor(vm, structure);
        constructor->finishCreation(vm, globalObject, prototype);
        return constructor;
    }

    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr bool needsDestruction = false;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return &vm.internalFunctionSpace();
    }

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe)
    {
        auto& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);

        throwTypeError(globalObject, scope, "TTYWrapConstructor cannot be called as a function"_s);
        return {};
    }

    // new TTY()
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe)
    {
        auto& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);

        auto* constructor = jsDynamicCast<TTYWrapConstructor*>(callframe->jsCallee());

        if (!constructor) {
            throwTypeError(globalObject, scope, "TTYWrapConstructor::construct called with wrong 'this' value"_s);
            return JSValue::encode(jsUndefined());
        }

        if (callframe->argumentCount() < 1) {
            throwTypeError(globalObject, scope, "Expected at least 1 argument"_s);
            return JSValue::encode(jsUndefined());
        }

        JSValue fd_value = callframe->argument(0);
        int32_t fd = fd_value.toInt32(globalObject);

        RETURN_IF_EXCEPTION(scope, encodedJSValue());

        if (fd < 0) {
            throwTypeError(globalObject, scope, "fd must be a positive number"_s);
            return JSValue::encode(jsUndefined());
        }

        auto prototypeValue = constructor->get(globalObject, vm.propertyNames->prototype);
        RETURN_IF_EXCEPTION(scope, encodedJSValue());
        if (!prototypeValue.isObject()) {
            throwTypeError(globalObject, scope, "TTYWrapConstructor prototype is not an object"_s);
            return {};
        }

        auto* structure = TTYWrapObject::createStructure(vm, globalObject, prototypeValue.getObject());
        auto* object = TTYWrapObject::create(vm, globalObject, structure, fd);
        return JSValue::encode(object);
    }

    DECLARE_EXPORT_INFO;

private:
    TTYWrapConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, call, construct)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSObject* prototype)
    {
        Base::finishCreation(vm, 1, "TTYWrap"_s);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete);
    }
};

const ClassInfo TTYWrapConstructor::s_info = { "TTY"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(TTYWrapConstructor) };

JSValue createBunTTYFunctions(JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto* obj = constructEmptyObject(globalObject);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "isTTY"_s)), JSFunction::create(vm, globalObject, 0, "isatty"_s, Zig::jsFunctionTty_isatty, ImplementationVisibility::Public), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "setRawMode"_s)), JSFunction::create(vm, globalObject, 0, "ttySetMode"_s, jsTTYSetMode, ImplementationVisibility::Public), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "getWindowSize"_s)), JSFunction::create(vm, globalObject, 0, "getWindowSize"_s, Bun::Process_functionInternalGetWindowSize, ImplementationVisibility::Public), 0);

    return obj;
}

JSValue createNodeTTYWrapObject(JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto* obj = constructEmptyObject(globalObject);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "isTTY"_s)), JSFunction::create(vm, globalObject, 0, "isatty"_s, Zig::jsFunctionTty_isatty, ImplementationVisibility::Public), 0);

    TTYWrapPrototype* prototype = TTYWrapPrototype::create(vm, globalObject, TTYWrapPrototype::createStructure(vm, globalObject));
    TTYWrapConstructor* constructor = TTYWrapConstructor::create(vm, globalObject, TTYWrapConstructor::createStructure(vm, globalObject, globalObject->functionPrototype()), prototype);

    obj->putDirect(vm, Identifier::fromString(vm, "TTY"_s), constructor, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete);

    return obj;
}

}