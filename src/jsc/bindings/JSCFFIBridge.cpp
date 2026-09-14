
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

using BunCModuleResolver = void* (*)(const char* name, size_t nameLength);

// Loads the module: none of its code runs. On success stores it in `out`: a module that has loaded stays loaded
// for the life of the process (what the C code gives the process, an exit or signal handler, a thread's start
// routine, a pointer to a static object, points into it), and any thread may use it. Otherwise stores why not in
// `error`.
extern "C" bool Bun__CModule__create(
    const uint8_t* bir,
    size_t birLength,
    BunCModuleResolver resolve,
    JSC::FFI::CModule** out,
    BunString* error)
{
    auto module = JSC::FFI::CModule::tryCreate(std::span { bir, birLength }, [&](const CString& name) {
        return resolve(name.data(), name.length());
    });
    if (!module) {
        *error = Bun::toStringRef(module.error());
        return false;
    }
    *out = module.value().ptr();
    return true;
}

// Passes each `__attribute__((destructor))` function to `add`, last to run first (`add` is `atexit`: last
// registered runs first).
extern "C" void Bun__CModule__registerDestructors(JSC::FFI::CModule* module, int (*add)(void (*)()))
{
    const auto& destructors = module->bir().destructors;
    for (size_t i = destructors.size(); i--;)
        add(reinterpret_cast<void (*)()>(module->entrypoint(destructors[i])));
}

// Runs the module's `__attribute__((constructor))` functions, the first time it is called for a module; a
// thread that calls it while another runs them waits for them.
extern "C" void Bun__CModule__runConstructors(JSC::FFI::CModule* module)
{
    module->runConstructors();
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
// The Universal C Runtime's stdio functions are inline functions in <stdio.h> over a few exported workers, so
// ucrtbase.dll has no `printf` to find. These are what legacy_stdio_definitions.lib gives a program that declares
// them itself instead of including the header. They use ucrtbase.dll's streams, as the compiled C does: Bun's own C
// runtime is a separate, statically linked copy.
namespace {

HMODULE ucrt()
{
    static HMODULE module = LoadLibraryA("ucrtbase.dll");
    return module;
}

template<typename Function> Function ucrtFunction(const char* name)
{
    return ucrt() ? reinterpret_cast<Function>(GetProcAddress(ucrt(), name)) : nullptr;
}

using Stream = void*;
using VFPrintF = int(__cdecl*)(unsigned long long, Stream, const char*, void*, va_list);
using VSPrintF = int(__cdecl*)(unsigned long long, char*, size_t, const char*, void*, va_list);
using VFScanF = int(__cdecl*)(unsigned long long, Stream, const char*, void*, va_list);
using VSScanF = int(__cdecl*)(unsigned long long, const char*, size_t, const char*, void*, va_list);
using IOB = Stream(__cdecl*)(unsigned);

// _CRT_INTERNAL_PRINTF_STANDARD_SNPRINTF_BEHAVIOR
constexpr unsigned long long standardSnprintf = 1ull << 1;

Stream standardStream(unsigned index)
{
    static IOB iob = ucrtFunction<IOB>("__acrt_iob_func");
    return iob ? iob(index) : nullptr;
}

int printToStream(Stream stream, const char* format, va_list arguments)
{
    static VFPrintF print = ucrtFunction<VFPrintF>("__stdio_common_vfprintf");
    return print && stream ? print(0, stream, format, nullptr, arguments) : -1;
}

int printToBuffer(unsigned long long options, char* buffer, size_t size, const char* format, va_list arguments)
{
    static VSPrintF print = ucrtFunction<VSPrintF>("__stdio_common_vsprintf");
    if (!print)
        return -1;
    int result = print(options, buffer, size, format, nullptr, arguments);
    return result < 0 ? -1 : result;
}

int scanStream(Stream stream, const char* format, va_list arguments)
{
    static VFScanF scan = ucrtFunction<VFScanF>("__stdio_common_vfscanf");
    return scan && stream ? scan(0, stream, format, nullptr, arguments) : -1;
}

int scanBuffer(const char* buffer, const char* format, va_list arguments)
{
    static VSScanF scan = ucrtFunction<VSScanF>("__stdio_common_vsscanf");
    return scan ? scan(0, buffer, static_cast<size_t>(-1), format, nullptr, arguments) : -1;
}

}

#define BUN_C_VARIADIC(call)     \
    va_list arguments;           \
    va_start(arguments, format); \
    int result = call;           \
    va_end(arguments);           \
    return result;

extern "C" int Bun__CModule__vprintf(const char* format, va_list arguments) { return printToStream(standardStream(1), format, arguments); }
extern "C" int Bun__CModule__vfprintf(Stream stream, const char* format, va_list arguments) { return printToStream(stream, format, arguments); }
extern "C" int Bun__CModule__vsprintf(char* buffer, const char* format, va_list arguments) { return printToBuffer(0, buffer, static_cast<size_t>(-1), format, arguments); }
extern "C" int Bun__CModule__vsnprintf(char* buffer, size_t size, const char* format, va_list arguments) { return printToBuffer(standardSnprintf, buffer, size, format, arguments); }
extern "C" int Bun__CModule__vscanf(const char* format, va_list arguments) { return scanStream(standardStream(0), format, arguments); }
extern "C" int Bun__CModule__vfscanf(Stream stream, const char* format, va_list arguments) { return scanStream(stream, format, arguments); }
extern "C" int Bun__CModule__vsscanf(const char* buffer, const char* format, va_list arguments) { return scanBuffer(buffer, format, arguments); }
extern "C" int Bun__CModule__printf(const char* format, ...) { BUN_C_VARIADIC(printToStream(standardStream(1), format, arguments)) }
extern "C" int Bun__CModule__fprintf(Stream stream, const char* format, ...) { BUN_C_VARIADIC(printToStream(stream, format, arguments)) }
extern "C" int Bun__CModule__sprintf(char* buffer, const char* format, ...) { BUN_C_VARIADIC(printToBuffer(0, buffer, static_cast<size_t>(-1), format, arguments)) }
extern "C" int Bun__CModule__snprintf(char* buffer, size_t size, const char* format, ...) { BUN_C_VARIADIC(printToBuffer(standardSnprintf, buffer, size, format, arguments)) }
extern "C" int Bun__CModule__scanf(const char* format, ...) { BUN_C_VARIADIC(scanStream(standardStream(0), format, arguments)) }
extern "C" int Bun__CModule__fscanf(Stream stream, const char* format, ...) { BUN_C_VARIADIC(scanStream(stream, format, arguments)) }
extern "C" int Bun__CModule__sscanf(const char* buffer, const char* format, ...) { BUN_C_VARIADIC(scanBuffer(buffer, format, arguments)) }

#undef BUN_C_VARIADIC

// What a program's startup code, which compiled C has none of, does with that runtime, and what c_module.rs asks
// of it. (`atexit`, `at_quick_exit` and `quick_exit` are Bun's own lists on every platform: c_module.rs.)

// `setvbuf(stdout, NULL, mode, size)`: a null buffer has the runtime allocate one.
extern "C" void Bun__CModule__bufferStdout(int mode, size_t size)
{
    using SetVBuf = int(__cdecl*)(Stream, char*, int, size_t);
    static SetVBuf setBuffer = ucrtFunction<SetVBuf>("setvbuf");
    if (Stream stream = standardStream(1); setBuffer && stream)
        setBuffer(stream, nullptr, mode, size);
}

// Puts `handler` on the list that runtime's `exit` runs.
extern "C" void Bun__CModule__atExitOfTheRuntime(void (*handler)())
{
    using Register = int(__cdecl*)(void (*)());
    static Register registerFunction = ucrtFunction<Register>("_crt_atexit");
    if (registerFunction)
        registerFunction(handler);
}

// `_set_app_type(_crt_console_app)`.
extern "C" void Bun__CModule__thisIsAConsoleProgram()
{
    using SetAppType = void(__cdecl*)(int);
    static SetAppType setAppType = ucrtFunction<SetAppType>("_set_app_type");
    constexpr int consoleApp = 1;
    if (setAppType)
        setAppType(consoleApp);
}

// Whether descriptor 1 of that runtime is a console.
extern "C" bool Bun__CModule__stdoutIsAConsole()
{
    using IsATTY = int(__cdecl*)(int);
    static IsATTY isATTY = ucrtFunction<IsATTY>("_isatty");
    return isATTY && isATTY(1);
}

static void flushStream(Stream stream)
{
    using FFlush = int(__cdecl*)(Stream);
    static FFlush flush = ucrtFunction<FFlush>("fflush");
    if (flush)
        flush(stream);
}

// `fflush(NULL)`: every open output stream.
extern "C" void Bun__CModule__flushStreams() { flushStream(nullptr); }

// `fflush(stdout)`.
extern "C" void Bun__CModule__flushStdout()
{
    if (Stream stream = standardStream(1))
        flushStream(stream);
}

// That runtime's `_environ`. It makes the table when a program's startup code asks it to
// (`_initialize_narrow_environment`, which does nothing when there is one already), not when it is loaded.
extern "C" char** Bun__CModule__environment()
{
    using Initialize = int(__cdecl*)();
    using Table = char***(__cdecl*)();
    static Initialize initialize = ucrtFunction<Initialize>("_initialize_narrow_environment");
    static Table table = ucrtFunction<Table>("__p__environ");
    if (initialize)
        initialize();
    return table ? *table() : nullptr;
}

// Flushes and closes the C code's streams: what returning from `main` does in a program of its own, after the
// handlers it registered with atexit have run (c_module.rs has those). Bun's exit does that for Bun's C runtime only.
extern "C" void Bun__CModule__runExitHandlers()
{
    using Exit = void(__cdecl*)();
    static Exit cexit = ucrtFunction<Exit>("_cexit");
    if (cexit)
        cexit();
}
#endif
