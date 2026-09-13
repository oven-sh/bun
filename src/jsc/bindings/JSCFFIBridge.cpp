
#include "root.h"

#include <JavaScriptCore/BunFFI.h>
#include <JavaScriptCore/CModule.h>
#include <JavaScriptCore/FFISignature.h>
#include <JavaScriptCore/FFIType.h>
#include <JavaScriptCore/FFIContext.h>
#include <JavaScriptCore/JSFFICallback.h>
#include <JavaScriptCore/JSFFIFunction.h>
#include "ScriptExecutionContext.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSObject.h>

#include "ZigGlobalObject.h"
#include "headers-handwritten.h"

#if OS(WINDOWS)
#include <cstdarg>
#include <windows.h>
#endif

static_assert(static_cast<uint8_t>(JSC::FFI::Type::Char) == 0, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::Pointer) == 12, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::JSValue) == 19, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::Buffer) == 20, "FFI::Type tag drift");
static_assert(static_cast<uint8_t>(JSC::FFI::Type::BufferLength) == 21, "FFI::Type tag drift");

extern "C" JSC::EncodedJSValue Bun__CreateJSCFFIFunction(
    Zig::GlobalObject* globalObject,
    const EncodedSlice* symbolName,
    const uint8_t* argTypes,
    unsigned argCount,
    uint8_t returnType,
    void* target,
    JSC::EncodedJSValue ownerValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    Vector<JSC::FFI::Type, 8> arguments;
    arguments.reserveInitialCapacity(argCount);
    for (unsigned i = 0; i < argCount; ++i)
        arguments.append(static_cast<JSC::FFI::Type>(argTypes[i]));

    RefPtr<JSC::FFI::Signature> signature = JSC::FFI::Signature::tryCreate(arguments.span(), static_cast<JSC::FFI::Type>(returnType));
    if (!signature) {
        JSC::throwTypeError(globalObject, scope, "bun:ffi: unsupported signature"_s);
        RELEASE_AND_RETURN(scope, {});
    }

    JSC::JSObject* owner = JSC::JSValue::decode(ownerValue).getObject();

    WTF::String name = symbolName ? Zig::toStringCopy(*symbolName) : WTF::String();
    JSC::JSFFIFunction* function = JSC::JSFFIFunction::create(vm, globalObject, globalObject->ffiFunctionStructure(), signature.releaseNonNull(), target, name, owner, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    if (!function)
        RELEASE_AND_RETURN(scope, {});

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(function));
}

static void Bun__jscFFIThreadsafeDispatch(JSC::FFI::ThreadsafeInvocation& invocation)
{
    static_assert(sizeof(WebCore::ScriptExecutionContextIdentifier) <= sizeof(void*));
    auto contextId = static_cast<WebCore::ScriptExecutionContextIdentifier>(reinterpret_cast<uintptr_t>(invocation.embedderContext()));
    WebCore::ScriptExecutionContext::postTaskTo(contextId, BunLoopKind::Regular, [protectedInvocation = Ref { invocation }](WebCore::ScriptExecutionContext&) mutable { JSC::FFI::runThreadsafeInvocation(protectedInvocation.get()); });
}

extern "C" JSC::EncodedJSValue Bun__CreateJSCFFICallback(
    Zig::GlobalObject* globalObject,
    JSC::EncodedJSValue callableValue,
    const uint8_t* argTypes,
    unsigned argCount,
    uint8_t returnType,
    bool threadsafe)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (threadsafe) {
        static std::once_flag registerDispatch;
        std::call_once(registerDispatch, [] {
            JSC::FFI::FFIContext::setThreadsafeDispatch(Bun__jscFFIThreadsafeDispatch);
        });
    }

    JSC::JSObject* callable = JSC::JSValue::decode(callableValue).getObject();
    if (!callable || !callable->isCallable()) [[unlikely]] {
        JSC::throwTypeError(globalObject, scope, "bun:ffi: JSCallback requires a function"_s);
        RELEASE_AND_RETURN(scope, {});
    }

    Vector<JSC::FFI::Type, 8> arguments;
    arguments.reserveInitialCapacity(argCount);
    for (unsigned i = 0; i < argCount; ++i)
        arguments.append(static_cast<JSC::FFI::Type>(argTypes[i]));

    RefPtr<JSC::FFI::Signature> signature = JSC::FFI::Signature::tryCreate(arguments.span(), static_cast<JSC::FFI::Type>(returnType));
    if (!signature) {
        JSC::throwTypeError(globalObject, scope, "bun:ffi: unsupported callback signature"_s);
        RELEASE_AND_RETURN(scope, {});
    }

    void* embedderContext = nullptr;
    if (threadsafe) {
        auto* scriptExecutionContext = globalObject->scriptExecutionContext();
        if (!scriptExecutionContext) [[unlikely]] {
            JSC::throwTypeError(globalObject, scope, "bun:ffi: no script execution context for a threadsafe JSCallback"_s);
            RELEASE_AND_RETURN(scope, {});
        }
        embedderContext = reinterpret_cast<void*>(static_cast<uintptr_t>(scriptExecutionContext->identifier()));
    }
    JSC::JSFFICallback* callback = JSC::FFI::createCallback(globalObject, signature.releaseNonNull(), callable, threadsafe, embedderContext);
    RETURN_IF_EXCEPTION(scope, {});
    if (!callback)
        RELEASE_AND_RETURN(scope, {});

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(callback));
}

extern "C" void Bun__JSCFFICallbackClose(JSC::EncodedJSValue callbackValue)
{
    if (auto* callback = dynamicDowncast<JSC::JSFFICallback>(JSC::JSValue::decode(callbackValue)))
        callback->close();
}

// C compiled by bun_cc (BIR) and lowered to machine code by JSC's B3.

using BunCModuleResolver = void* (*)(void* context, const char* name, size_t nameLength);

// On success stores a +1 reference in `out`; otherwise leaves a TypeError pending.
extern "C" JSC::EncodedJSValue Bun__CModule__create(
    Zig::GlobalObject* globalObject,
    const uint8_t* bir,
    size_t birLength,
    void* resolverContext,
    BunCModuleResolver resolve,
    JSC::FFI::CModule** out)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto module = JSC::FFI::CModule::tryCreate(std::span { bir, birLength }, [&](const CString& name) {
        return resolve(resolverContext, name.data(), name.length());
    });
    if (!module) {
        JSC::throwTypeError(globalObject, scope, module.error());
        RELEASE_AND_RETURN(scope, {});
    }
    *out = &module.value().leakRef();
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsUndefined()));
}

extern "C" void Bun__CModule__deref(JSC::FFI::CModule* module)
{
    module->deref();
}

// Passes each `__attribute__((destructor))` function to `add`, last to run first (`add` is
// `atexit`-like: last registered runs first). A module that has any is never freed: they run
// when the process ends.
extern "C" void Bun__CModule__registerDestructors(JSC::FFI::CModule* module, void (*add)(void (*)()))
{
    const auto& destructors = module->bir().destructors;
    if (destructors.isEmpty())
        return;
    module->ref();
    for (size_t i = destructors.size(); i--;)
        add(reinterpret_cast<void (*)()>(module->functionTable()[destructors[i]]));
}

// { name: function } for every non-static function, typed from its C declaration.
extern "C" JSC::EncodedJSValue Bun__CModule__createExports(Zig::GlobalObject* globalObject, JSC::FFI::CModule* module)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSObject* exports = module->createExportsObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(exports));
}

#if OS(WINDOWS)
// C99's snprintf and vsnprintf for C compiled against msvcrt.dll, which has them only as _snprintf and
// _vsnprintf: those do not terminate a truncated string and return -1 for one.
namespace {
using VSNPrintF = int(__cdecl*)(char*, size_t, const char*, va_list);
using VSCPrintF = int(__cdecl*)(const char*, va_list);
template<typename Function> Function msvcrtFunction(const char* name)
{
    HMODULE msvcrt = LoadLibraryA("msvcrt.dll");
    return msvcrt ? reinterpret_cast<Function>(GetProcAddress(msvcrt, name)) : nullptr;
}
}

extern "C" int Bun__CModule__vsnprintf(char* buffer, size_t size, const char* format, va_list arguments)
{
    static VSNPrintF print = msvcrtFunction<VSNPrintF>("_vsnprintf");
    static VSCPrintF count = msvcrtFunction<VSCPrintF>("_vscprintf");
    if (!print || !count)
        return -1;
    va_list copy;
    va_copy(copy, arguments);
    int length = count(format, copy);
    va_end(copy);
    if (size) {
        int written = print(buffer, size, format, arguments);
        if (written < 0 || static_cast<size_t>(written) >= size)
            buffer[size - 1] = 0;
    }
    return length;
}

extern "C" int Bun__CModule__snprintf(char* buffer, size_t size, const char* format, ...)
{
    va_list arguments;
    va_start(arguments, format);
    int length = Bun__CModule__vsnprintf(buffer, size, format, arguments);
    va_end(arguments);
    return length;
}
#endif
