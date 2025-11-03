#include "ModuleLoader.h"
#include "napi.h"

#include "BunProcess.h"

// Include the CMake-generated dependency versions header
#include "bun_dependency_versions.h"
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSMicrotask.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/NumberPrototype.h>
#include "JSCommonJSModule.h"
#include "ErrorCode+List.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/CatchScope.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSMapInlines.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSType.h"
#include "JavaScriptCore/MathCommon.h"
#include "JavaScriptCore/Protect.h"
#include "JavaScriptCore/PutPropertySlot.h"
#include "ScriptExecutionContext.h"
#include "headers-handwritten.h"
#include "ZigGlobalObject.h"
#include "FormatStackTraceForJS.h"
#include "headers.h"
#include "JSEnvironmentVariableMap.h"
#include "ImportMetaObject.h"
#include "JavaScriptCore/ScriptCallStackFactory.h"
#include "JavaScriptCore/ConsoleMessage.h"
#include "JavaScriptCore/InspectorConsoleAgent.h"
#include "JavaScriptCore/JSGlobalObjectDebuggable.h"
#include <JavaScriptCore/StackFrame.h>
#include <sys/stat.h>
#include "ConsoleObject.h"
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/JSSet.h>
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include "wtf-bindings.h"
#include "EventLoopTask.h"
#include <JavaScriptCore/StructureCache.h>

#include <webcore/SerializedScriptValue.h>
#include "ProcessBindingTTYWrap.h"
#include "wtf/text/ASCIILiteral.h"
#include "wtf/text/StringToIntegerConversion.h"
#include "wtf/text/OrdinalNumber.h"
#include "NodeValidator.h"
#include "NodeModuleModule.h"
#include "JSX509Certificate.h"

#include "AsyncContextFrame.h"
#include "ErrorCode.h"

#include "napi_handle_scope.h"
#include "napi_external.h"

#ifndef WIN32
#include <errno.h>
#include <dlfcn.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <netdb.h>
#include <unistd.h>
#include <sys/utsname.h>
#include <sys/types.h>
#include <pwd.h>
#include <grp.h>
#else
#include <uv.h>
#include <io.h>
#include <fcntl.h>
// Using the same typedef and define for `mode_t` and `umask` as node on windows.
// https://github.com/nodejs/node/blob/ad5e2dab4c8306183685973387829c2f69e793da/src/node_process_methods.cc#L29
#define umask _umask
typedef int mode_t;
#endif
#include "JSNextTickQueue.h"
#include "ProcessBindingUV.h"
#include "ProcessBindingNatives.h"

#if OS(LINUX)
#include <features.h>
#ifdef __GNU_LIBRARY__
#include <gnu/libc-version.h>
#endif
#endif

#if ASSERT_ENABLED
#include <JavaScriptCore/IntegrityInlines.h>
#endif

#pragma mark - Node.js Process

#if defined(__APPLE__)
#include <mach/mach.h>
#include <mach/mach_time.h>
#endif

#if defined(__linux__)
#include <sys/resource.h>
#include <sys/time.h>
#include <sys/stat.h>
#include <fcntl.h>
#endif

#if !defined(_MSC_VER)
#include <unistd.h> // setuid, getuid
#endif

#include <cstring>
extern "C" bool Bun__Node__ProcessNoDeprecation;
extern "C" bool Bun__Node__ProcessThrowDeprecation;
extern "C" int32_t bun_stdio_tty[3];

namespace Bun {

using namespace JSC;

#define processObjectBindingCodeGenerator processObjectInternalsBindingCodeGenerator
#define setProcessObjectInternalsMainModuleCodeGenerator processObjectInternalsSetMainModuleCodeGenerator
#define setProcessObjectMainModuleCodeGenerator setMainModuleCodeGenerator

#if !defined(BUN_WEBKIT_VERSION)
#define BUN_WEBKIT_VERSION "unknown"
#endif

using JSGlobalObject = JSC::JSGlobalObject;
using Exception = JSC::Exception;
using JSValue = JSC::JSValue;
using JSString = JSC::JSString;
using JSModuleLoader = JSC::JSModuleLoader;
using JSModuleRecord = JSC::JSModuleRecord;
using Identifier = JSC::Identifier;
using SourceOrigin = JSC::SourceOrigin;
using JSObject = JSC::JSObject;
using JSNonFinalObject = JSC::JSNonFinalObject;
namespace JSCastingHelpers = JSC::JSCastingHelpers;

JSC_DECLARE_HOST_FUNCTION(Process_functionCwd);

extern "C" uint8_t Bun__getExitCode(void*);
extern "C" uint8_t Bun__setExitCode(void*, uint8_t);
extern "C" bool Bun__closeChildIPC(JSGlobalObject*);

extern "C" bool Bun__GlobalObject__connectedIPC(JSGlobalObject*);
extern "C" bool Bun__GlobalObject__hasIPC(JSGlobalObject*);
extern "C" bool Bun__ensureProcessIPCInitialized(JSGlobalObject*);
extern "C" const char* Bun__githubURL;
BUN_DECLARE_HOST_FUNCTION(Bun__Process__send);

extern "C" void Process__emitDisconnectEvent(Zig::GlobalObject* global);
extern "C" void Process__emitErrorEvent(Zig::GlobalObject* global, EncodedJSValue value);

extern "C" void Bun__suppressCrashOnProcessKillSelfIfDesired();

static Process* getProcessObject(JSC::JSGlobalObject* lexicalGlobalObject, JSValue thisValue);
bool setProcessExitCodeInner(JSC::JSGlobalObject* lexicalGlobalObject, Process* process, JSValue code);

static JSValue constructArch(VM& vm, JSObject* processObject)
{
#if CPU(X86_64)
    return JSC::jsString(vm, makeAtomString("x64"_s));
#elif CPU(ARM64)
    return JSC::jsString(vm, makeAtomString("arm64"_s));
#else
#error "Unknown architecture"
#endif
}

static JSValue constructPlatform(VM& vm, JSObject* processObject)
{
#if defined(__APPLE__)
    return JSC::jsString(vm, makeAtomString("darwin"_s));
#elif defined(__linux__)
    return JSC::jsString(vm, makeAtomString("linux"_s));
#elif OS(WINDOWS)
    return JSC::jsString(vm, makeAtomString("win32"_s));
#else
#error "Unknown platform"
#endif
}

static JSValue constructVersions(VM& vm, JSObject* processObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = processObject->globalObject();
    JSC::JSObject* object = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 24);
    RETURN_IF_EXCEPTION(scope, {});

    object->putDirect(vm, JSC::Identifier::fromString(vm, "node"_s), JSC::jsOwnedString(vm, makeAtomString(ASCIILiteral::fromLiteralUnsafe(REPORTED_NODEJS_VERSION))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "bun"_s), JSC::jsOwnedString(vm, String(ASCIILiteral::fromLiteralUnsafe(Bun__version)).substring(1)));

    // Use CMake-generated versions
    object->putDirect(vm, JSC::Identifier::fromString(vm, "boringssl"_s), JSC::jsOwnedString(vm, String(ASCIILiteral::fromLiteralUnsafe(BUN_VERSION_BORINGSSL))), 0);
    // https://github.com/oven-sh/bun/issues/7921
    // BoringSSL is a fork of OpenSSL 1.1.0, so we can report OpenSSL 1.1.0
    object->putDirect(vm, JSC::Identifier::fromString(vm, "openssl"_s), JSC::jsOwnedString(vm, String("1.1.0"_s)));
    // keep in sync with src/bun.js/bindings/node/http/llhttp/README.md
    object->putDirect(vm, JSC::Identifier::fromString(vm, "llhttp"_s), JSC::jsOwnedString(vm, String("9.3.0"_s)));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "libarchive"_s), JSC::jsOwnedString(vm, ASCIILiteral::fromLiteralUnsafe(BUN_VERSION_LIBARCHIVE)), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "mimalloc"_s), JSC::jsOwnedString(vm, ASCIILiteral::fromLiteralUnsafe(BUN_VERSION_MIMALLOC)), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "picohttpparser"_s), JSC::jsOwnedString(vm, ASCIILiteral::fromLiteralUnsafe(BUN_VERSION_PICOHTTPPARSER)), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "uwebsockets"_s), JSC::jsOwnedString(vm, ASCIILiteral::fromLiteralUnsafe(BUN_VERSION_UWS)), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "webkit"_s), JSC::jsOwnedString(vm, ASCIILiteral::fromLiteralUnsafe(BUN_VERSION_WEBKIT)), 0);
    // Zig version from CMake-generated header
    object->putDirect(vm, JSC::Identifier::fromString(vm, "zig"_s), JSC::jsOwnedString(vm, ASCIILiteral::fromLiteralUnsafe(BUN_VERSION_ZIG)), 0);

    // Use commit hash for zlib to match test expectations
    object->putDirect(vm, JSC::Identifier::fromString(vm, "zlib"_s), JSC::jsOwnedString(vm, ASCIILiteral::fromLiteralUnsafe(BUN_VERSION_ZLIB_HASH)), 0);

    object->putDirect(vm, JSC::Identifier::fromString(vm, "tinycc"_s), JSC::jsOwnedString(vm, ASCIILiteral::fromLiteralUnsafe(BUN_VERSION_TINYCC)), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "lolhtml"_s), JSC::jsOwnedString(vm, ASCIILiteral::fromLiteralUnsafe(BUN_VERSION_LOLHTML)), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "ares"_s), JSC::jsOwnedString(vm, ASCIILiteral::fromLiteralUnsafe(BUN_VERSION_C_ARES)), 0);

    // Use commit hash for libdeflate to match test expectations
    object->putDirect(vm, JSC::Identifier::fromString(vm, "libdeflate"_s), JSC::jsOwnedString(vm, ASCIILiteral::fromLiteralUnsafe(BUN_VERSION_LIBDEFLATE_HASH)), 0);

    object->putDirect(vm, JSC::Identifier::fromString(vm, "usockets"_s), JSC::jsOwnedString(vm, ASCIILiteral::fromLiteralUnsafe(BUN_VERSION_USOCKETS)), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "lshpack"_s), JSC::jsOwnedString(vm, ASCIILiteral::fromLiteralUnsafe(BUN_VERSION_LSHPACK)), 0);

    // Use commit hash for zstd (semantic version extraction not working yet)
    object->putDirect(vm, JSC::Identifier::fromString(vm, "zstd"_s), JSC::jsOwnedString(vm, ASCIILiteral::fromLiteralUnsafe(BUN_VERSION_ZSTD_HASH)), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "v8"_s), JSValue(JSC::jsOwnedString(vm, String("13.6.233.10-node.18"_s))), 0);
#if OS(WINDOWS)
    object->putDirect(vm, JSC::Identifier::fromString(vm, "uv"_s), JSValue(JSC::jsOwnedString(vm, String::fromLatin1(uv_version_string()))), 0);
#else
    object->putDirect(vm, JSC::Identifier::fromString(vm, "uv"_s), JSValue(JSC::jsOwnedString(vm, String("1.48.0"_s))), 0);
#endif
    object->putDirect(vm, JSC::Identifier::fromString(vm, "napi"_s), JSValue(JSC::jsOwnedString(vm, String("10"_s))), 0);

    object->putDirect(vm, JSC::Identifier::fromString(vm, "icu"_s), JSValue(JSC::jsOwnedString(vm, String(ASCIILiteral::fromLiteralUnsafe(U_ICU_VERSION)))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "unicode"_s), JSValue(JSC::jsOwnedString(vm, String(ASCIILiteral::fromLiteralUnsafe(U_UNICODE_VERSION)))), 0);

#define STRINGIFY_IMPL(x) #x
#define STRINGIFY(x) STRINGIFY_IMPL(x)
    object->putDirect(vm, JSC::Identifier::fromString(vm, "modules"_s), JSC::jsOwnedString(vm, String(ASCIILiteral::fromLiteralUnsafe(STRINGIFY(REPORTED_NODEJS_ABI_VERSION)))));
#undef STRINGIFY
#undef STRINGIFY_IMPL

    return object;
}

static JSValue constructProcessReleaseObject(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    auto* release = JSC::constructEmptyObject(globalObject);

    release->putDirect(vm, vm.propertyNames->name, jsOwnedString(vm, String("node"_s)), 0); // maybe this should be 'bun' eventually
    release->putDirect(vm, Identifier::fromString(vm, "sourceUrl"_s), jsOwnedString(vm, WTF::String(std::span { Bun__githubURL, strlen(Bun__githubURL) })), 0);
    release->putDirect(vm, Identifier::fromString(vm, "headersUrl"_s), jsOwnedString(vm, String("https://nodejs.org/download/release/v" REPORTED_NODEJS_VERSION "/node-v" REPORTED_NODEJS_VERSION "-headers.tar.gz"_s)), 0);

    return release;
}

static void dispatchExitInternal(JSC::JSGlobalObject* globalObject, Process* process, int exitCode)
{
    static bool processIsExiting = false;
    if (processIsExiting)
        return;
    processIsExiting = true;
    auto& emitter = process->wrapped();
    auto& vm = JSC::getVM(globalObject);

    if (vm.hasTerminationRequest() || vm.hasExceptionsAfterHandlingTraps())
        return;

    auto event = Identifier::fromString(vm, "exit"_s);
    if (!emitter.hasEventListeners(event)) {
        return;
    }
    process->putDirect(vm, Identifier::fromString(vm, "_exiting"_s), jsBoolean(true), 0);

    MarkedArgumentBuffer arguments;
    arguments.append(jsNumber(exitCode));
    emitter.emit(event, arguments);
}

// Function declarations - implementations in BunProcessFunctions.cpp
JSC_DECLARE_CUSTOM_SETTER(Process_defaultSetter);
JSC_DECLARE_HOST_FUNCTION(Process_functionDlopen);
JSC_DECLARE_HOST_FUNCTION(Process_functionUmask);
JSC_DECLARE_HOST_FUNCTION(Process_functionUptime);
JSC_DECLARE_HOST_FUNCTION(Process_functionExit);
JSC_DECLARE_HOST_FUNCTION(Process_setUncaughtExceptionCaptureCallback);
JSC_DECLARE_HOST_FUNCTION(Process_hasUncaughtExceptionCaptureCallback);
JSC_DECLARE_HOST_FUNCTION(Process_functionHRTime);
JSC_DECLARE_HOST_FUNCTION(Process_functionHRTimeBigInt);
JSC_DECLARE_HOST_FUNCTION(Process_functionChdir);
JSC_DECLARE_HOST_FUNCTION(jsFunction_emitWarning);
JSC_DECLARE_HOST_FUNCTION(jsFunction_throwValue);
JSC_DECLARE_HOST_FUNCTION(Process_functionAbort);
JSC_DECLARE_HOST_FUNCTION(Process_emitWarning);
JSC_DECLARE_HOST_FUNCTION(Process_functionGetReport);
JSC_DECLARE_HOST_FUNCTION(Process_functionWriteReport);
JSC_DECLARE_HOST_FUNCTION(Bun__Process__disconnect);
JSC_DECLARE_HOST_FUNCTION(Process_functiongetuid);
JSC_DECLARE_HOST_FUNCTION(Process_functiongeteuid);
JSC_DECLARE_HOST_FUNCTION(Process_functiongetegid);
JSC_DECLARE_HOST_FUNCTION(Process_functiongetgid);
JSC_DECLARE_HOST_FUNCTION(Process_functiongetgroups);
JSC_DECLARE_HOST_FUNCTION(Process_functionsetuid);
JSC_DECLARE_HOST_FUNCTION(Process_functionseteuid);
JSC_DECLARE_HOST_FUNCTION(Process_functionsetegid);
JSC_DECLARE_HOST_FUNCTION(Process_functionsetgid);
JSC_DECLARE_HOST_FUNCTION(Process_functionsetgroups);
JSC_DECLARE_HOST_FUNCTION(Process_functionAssert);
JSC_DECLARE_HOST_FUNCTION(Process_availableMemory);
JSC_DECLARE_HOST_FUNCTION(Process_functionBinding);
JSC_DECLARE_HOST_FUNCTION(Process_functionReallyExit);
JSC_DECLARE_HOST_FUNCTION(Process_functionConstrainedMemory);
JSC_DECLARE_HOST_FUNCTION(Process_functionResourceUsage);
JSC_DECLARE_HOST_FUNCTION(Process_functionCpuUsage);
JSC_DECLARE_HOST_FUNCTION(Process_functionMemoryUsage);
JSC_DECLARE_HOST_FUNCTION(Process_functionMemoryUsageRSS);
JSC_DECLARE_HOST_FUNCTION(Process_functionOpenStdin);
JSC_DECLARE_HOST_FUNCTION(Process_ref);
JSC_DECLARE_HOST_FUNCTION(Process_unref);
JSC_DECLARE_HOST_FUNCTION(Process_stubEmptyFunction);
JSC_DECLARE_HOST_FUNCTION(Process_setSourceMapsEnabled);
JSC_DECLARE_HOST_FUNCTION(Process_stubFunctionReturningArray);
JSC_DECLARE_HOST_FUNCTION(jsFunctionReportUncaughtException);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDrainMicrotaskQueue);
JSC_DECLARE_HOST_FUNCTION(Process_functionReallyKill);
JSC_DECLARE_HOST_FUNCTION(Process_functionKill);
JSC_DECLARE_HOST_FUNCTION(Process_functionLoadBuiltinModule);
JSC_DECLARE_HOST_FUNCTION(Process_functionEmitHelper);
JSC_DECLARE_CUSTOM_GETTER(processExitCode);
JSC_DECLARE_CUSTOM_SETTER(setProcessExitCode);
JSC_DECLARE_CUSTOM_GETTER(processConnected);
JSC_DECLARE_CUSTOM_SETTER(setProcessConnected);
JSC_DECLARE_CUSTOM_GETTER(processThrowDeprecation);
JSC_DECLARE_CUSTOM_SETTER(setProcessThrowDeprecation);
JSC_DECLARE_CUSTOM_GETTER(processArgv);
JSC_DECLARE_CUSTOM_SETTER(setProcessArgv);
JSC_DECLARE_CUSTOM_GETTER(processExecArgv);
JSC_DECLARE_CUSTOM_SETTER(setProcessExecArgv);
JSC_DECLARE_CUSTOM_GETTER(processGetEval);
JSC_DECLARE_CUSTOM_SETTER(setProcessGetEval);
JSC_DECLARE_CUSTOM_GETTER(processNoDeprecation);
JSC_DECLARE_CUSTOM_SETTER(setProcessNoDeprecation);
JSC_DECLARE_CUSTOM_GETTER(processDebugPort);
JSC_DECLARE_CUSTOM_SETTER(setProcessDebugPort);
JSC_DECLARE_CUSTOM_GETTER(processTitle);
JSC_DECLARE_CUSTOM_SETTER(setProcessTitle);

extern "C" bool Bun__resolveEmbeddedNodeFile(void*, BunString*);
#if OS(WINDOWS)
extern "C" HMODULE Bun__LoadLibraryBunString(BunString*);
#endif

/// Returns a pointer that needs to be freed with `delete[]`.
static char* toFileURI(std::string_view path)
{
    auto needs_escape = [](char ch) {
        return !(('a' <= ch && ch <= 'z') || ('A' <= ch && ch <= 'Z') || ('0' <= ch && ch <= '9')
            || ch == '_' || ch == '-' || ch == '.' || ch == '!' || ch == '~' || ch == '*' || ch == '\'' || ch == '(' || ch == ')' || ch == '/' || ch == ':');
    };

    auto to_hex = [](uint8_t nybble) -> char {
        if (nybble < 0xa) {
            return '0' + nybble;
        }

        return 'a' + (nybble - 0xa);
    };

    size_t escape_count = 0;
    for (char ch : path) {
#if OS(WINDOWS)
        if (needs_escape(ch) && ch != '\\') {
#else
        if (needs_escape(ch)) {
#endif
            ++escape_count;
        }
    }

#if OS(WINDOWS)
#define FILE_URI_START "file:///"
#else
#define FILE_URI_START "file://"
#endif

    const size_t string_size = sizeof(FILE_URI_START) + path.size() + 2 * escape_count; // null byte is included in the sizeof expression
    char* characters = new char[string_size];
    strncpy(characters, FILE_URI_START, sizeof(FILE_URI_START));
    size_t i = sizeof(FILE_URI_START) - 1;
    for (char ch : path) {
#if OS(WINDOWS)
        if (ch == '\\') {
            characters[i++] = '/';
            continue;
        }
#endif
        if (needs_escape(ch)) {
            characters[i++] = '%';
            characters[i++] = to_hex(static_cast<uint8_t>(ch) >> 4);
            characters[i++] = to_hex(ch & 0xf);
        } else {
            characters[i++] = ch;
        }
    }

    characters[i] = '\0';
    ASSERT(i + 1 == string_size);
    return characters;
}

static char* toFileURI(std::span<const char> span)
{
    return toFileURI(std::string_view(span.data(), span.size()));
}

extern "C" size_t Bun__process_dlopen_count;

// "Fire and forget" wrapper around unlink for c usage that handles EINTR
extern "C" void Bun__unlink(const char*, size_t);

extern "C" void CrashHandler__setDlOpenAction(const char* action);
extern "C" bool Bun__VM__allowAddons(void* vm);

extern "C" uint64_t Bun__readOriginTimer(void*);
extern "C" double Bun__readOriginTimerStart(void*);
extern "C" void Bun__VirtualMachine__exitDuringUncaughtException(void*);

// https://github.com/nodejs/node/blob/1936160c31afc9780e4365de033789f39b7cbc0c/src/api/hooks.cc#L49
extern "C" void Process__dispatchOnBeforeExit(Zig::GlobalObject* globalObject, uint8_t exitCode)
{
    if (!globalObject->hasProcessObject()) {
        return;
    }
    auto& vm = JSC::getVM(globalObject);
    auto* process = globalObject->processObject();
    MarkedArgumentBuffer arguments;
    arguments.append(jsNumber(exitCode));
    Bun__VirtualMachine__exitDuringUncaughtException(bunVM(vm));
    auto fired = process->wrapped().emit(Identifier::fromString(vm, "beforeExit"_s), arguments);
    if (fired) {
        if (globalObject->m_nextTickQueue) {
            auto nextTickQueue = globalObject->m_nextTickQueue.get();
            nextTickQueue->drain(vm, globalObject);
        }
    }
}

extern "C" void Process__dispatchOnExit(Zig::GlobalObject* globalObject, uint8_t exitCode)
{
    if (!globalObject->hasProcessObject()) {
        return;
    }

    auto* process = globalObject->processObject();
    if (exitCode > 0)
        process->m_isExitCodeObservable = true;
    dispatchExitInternal(globalObject, process, exitCode);
}

extern "C" uint64_t Bun__readOriginTimer(void*);

static HashMap<int, String>* signalNumberToNameMap = nullptr;
static HashMap<String, int>* signalNameToNumberMap = nullptr;

// On windows, signals need to have a handle to the uv_signal_t. When sigaction is used, this is kept track globally for you.
struct SignalHandleValue {
#if OS(WINDOWS)
    uv_signal_t* handle;
#endif
};
static HashMap<int, SignalHandleValue>* signalToContextIdsMap = nullptr;

static const NeverDestroyed<String>* getSignalNames()
{
    static const NeverDestroyed<String> signalNames[] = {
        MAKE_STATIC_STRING_IMPL("SIGHUP"),
        MAKE_STATIC_STRING_IMPL("SIGINT"),
        MAKE_STATIC_STRING_IMPL("SIGQUIT"),
        MAKE_STATIC_STRING_IMPL("SIGILL"),
        MAKE_STATIC_STRING_IMPL("SIGTRAP"),
        MAKE_STATIC_STRING_IMPL("SIGABRT"),
        MAKE_STATIC_STRING_IMPL("SIGIOT"),
        MAKE_STATIC_STRING_IMPL("SIGBUS"),
        MAKE_STATIC_STRING_IMPL("SIGFPE"),
        MAKE_STATIC_STRING_IMPL("SIGKILL"),
        MAKE_STATIC_STRING_IMPL("SIGUSR1"),
        MAKE_STATIC_STRING_IMPL("SIGSEGV"),
        MAKE_STATIC_STRING_IMPL("SIGUSR2"),
        MAKE_STATIC_STRING_IMPL("SIGPIPE"),
        MAKE_STATIC_STRING_IMPL("SIGALRM"),
        MAKE_STATIC_STRING_IMPL("SIGTERM"),
        MAKE_STATIC_STRING_IMPL("SIGCHLD"),
        MAKE_STATIC_STRING_IMPL("SIGCONT"),
        MAKE_STATIC_STRING_IMPL("SIGSTOP"),
        MAKE_STATIC_STRING_IMPL("SIGTSTP"),
        MAKE_STATIC_STRING_IMPL("SIGTTIN"),
        MAKE_STATIC_STRING_IMPL("SIGTTOU"),
        MAKE_STATIC_STRING_IMPL("SIGURG"),
        MAKE_STATIC_STRING_IMPL("SIGXCPU"),
        MAKE_STATIC_STRING_IMPL("SIGXFSZ"),
        MAKE_STATIC_STRING_IMPL("SIGVTALRM"),
        MAKE_STATIC_STRING_IMPL("SIGPROF"),
        MAKE_STATIC_STRING_IMPL("SIGWINCH"),
        MAKE_STATIC_STRING_IMPL("SIGIO"),
        MAKE_STATIC_STRING_IMPL("SIGINFO"),
        MAKE_STATIC_STRING_IMPL("SIGSYS"),
    };

    return signalNames;
}

static void loadSignalNumberMap()
{

    static std::once_flag signalNameToNumberMapOnceFlag;
    std::call_once(signalNameToNumberMapOnceFlag, [] {
        auto signalNames = getSignalNames();
        signalNameToNumberMap = new HashMap<String, int>();
        signalNameToNumberMap->reserveInitialCapacity(31);
#if OS(WINDOWS)
        // libuv supported signals
        signalNameToNumberMap->add(signalNames[1], SIGINT);
        signalNameToNumberMap->add(signalNames[2], SIGQUIT);
        signalNameToNumberMap->add(signalNames[9], SIGKILL);
        signalNameToNumberMap->add(signalNames[15], SIGTERM);
#else
        signalNameToNumberMap->add(signalNames[0], SIGHUP);
        signalNameToNumberMap->add(signalNames[1], SIGINT);
        signalNameToNumberMap->add(signalNames[2], SIGQUIT);
        signalNameToNumberMap->add(signalNames[3], SIGILL);
#ifdef SIGTRAP
        signalNameToNumberMap->add(signalNames[4], SIGTRAP);
#endif
        signalNameToNumberMap->add(signalNames[5], SIGABRT);
#ifdef SIGIOT
        signalNameToNumberMap->add(signalNames[6], SIGIOT);
#endif
#ifdef SIGBUS
        signalNameToNumberMap->add(signalNames[7], SIGBUS);
#endif
        signalNameToNumberMap->add(signalNames[8], SIGFPE);
        signalNameToNumberMap->add(signalNames[9], SIGKILL);
#ifdef SIGUSR1
        signalNameToNumberMap->add(signalNames[10], SIGUSR1);
#endif
        signalNameToNumberMap->add(signalNames[11], SIGSEGV);
#ifdef SIGUSR2
        signalNameToNumberMap->add(signalNames[12], SIGUSR2);
#endif
#ifdef SIGPIPE
        signalNameToNumberMap->add(signalNames[13], SIGPIPE);
#endif
#ifdef SIGALRM
        signalNameToNumberMap->add(signalNames[14], SIGALRM);
#endif
        signalNameToNumberMap->add(signalNames[15], SIGTERM);
#ifdef SIGCHLD
        signalNameToNumberMap->add(signalNames[16], SIGCHLD);
#endif
#ifdef SIGCONT
        signalNameToNumberMap->add(signalNames[17], SIGCONT);
#endif
#ifdef SIGSTOP
        signalNameToNumberMap->add(signalNames[18], SIGSTOP);
#endif
#ifdef SIGTSTP
        signalNameToNumberMap->add(signalNames[19], SIGTSTP);
#endif
#ifdef SIGTTIN
        signalNameToNumberMap->add(signalNames[20], SIGTTIN);
#endif
#ifdef SIGTTOU
        signalNameToNumberMap->add(signalNames[21], SIGTTOU);
#endif
#ifdef SIGURG
        signalNameToNumberMap->add(signalNames[22], SIGURG);
#endif
#ifdef SIGXCPU
        signalNameToNumberMap->add(signalNames[23], SIGXCPU);
#endif
#ifdef SIGXFSZ
        signalNameToNumberMap->add(signalNames[24], SIGXFSZ);
#endif
#ifdef SIGVTALRM
        signalNameToNumberMap->add(signalNames[25], SIGVTALRM);
#endif
#ifdef SIGPROF
        signalNameToNumberMap->add(signalNames[26], SIGPROF);
#endif
        signalNameToNumberMap->add(signalNames[27], SIGWINCH);
#ifdef SIGIO
        signalNameToNumberMap->add(signalNames[28], SIGIO);
#endif
#ifdef SIGINFO
        signalNameToNumberMap->add(signalNames[29], SIGINFO);
#endif

#ifndef SIGINFO
        signalNameToNumberMap->add(signalNames[29], 255);
#endif
#ifdef SIGSYS
        signalNameToNumberMap->add(signalNames[30], SIGSYS);
#endif
#endif
    });
}

bool isSignalName(WTF::String input)
{
    loadSignalNumberMap();
    return signalNameToNumberMap->contains(input);
}

extern "C" void Bun__onSignalForJS(int signalNumber, Zig::GlobalObject* globalObject)
{
    Process* process = globalObject->processObject();

    String signalName = signalNumberToNameMap->get(signalNumber);
    Identifier signalNameIdentifier = Identifier::fromString(JSC::getVM(globalObject), signalName);
    MarkedArgumentBuffer args;
    args.append(jsString(JSC::getVM(globalObject), signalNameIdentifier.string()));
    args.append(jsNumber(signalNumber));

    process->wrapped().emitForBindings(signalNameIdentifier, args);
}

#if OS(WINDOWS)
extern "C" uv_signal_t* Bun__UVSignalHandle__init(JSC::JSGlobalObject* lexicalGlobalObject, int signalNumber, void (*callback)(uv_signal_t*, int));
extern "C" uv_signal_t* Bun__UVSignalHandle__close(uv_signal_t*);
#endif

#if !OS(WINDOWS)
void signalHandler(int signalNumber)
#else
void signalHandler(uv_signal_t* signal, int signalNumber)
#endif
{
#if OS(WINDOWS)
    if (signalNumberToNameMap->find(signalNumber) == signalNumberToNameMap->end()) [[unlikely]]
        return;

    auto* context = ScriptExecutionContext::getMainThreadScriptExecutionContext();
    if (!context) [[unlikely]]
        return;
    // signal handlers can be run on any thread
    context->postTaskConcurrently([signalNumber](ScriptExecutionContext& context) {
        Bun__onSignalForJS(signalNumber, jsCast<Zig::GlobalObject*>(context.jsGlobalObject()));
    });
#else

#endif
};

extern "C" void Bun__logUnhandledException(JSC::EncodedJSValue exception);

extern "C" int Bun__handleUncaughtException(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue exception, int isRejection)
{
    if (!lexicalGlobalObject->inherits(Zig::GlobalObject::info()))
        return false;
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto* process = globalObject->processObject();
    auto& wrapped = process->wrapped();
    auto& vm = JSC::getVM(globalObject);

    MarkedArgumentBuffer args;
    args.append(exception);
    if (isRejection) {
        args.append(jsString(vm, String("unhandledRejection"_s)));
    } else {
        args.append(jsString(vm, String("uncaughtException"_s)));
    }

    auto uncaughtExceptionMonitor = Identifier::fromString(JSC::getVM(globalObject), "uncaughtExceptionMonitor"_s);
    if (wrapped.listenerCount(uncaughtExceptionMonitor) > 0) {
        wrapped.emit(uncaughtExceptionMonitor, args);
    }

    auto uncaughtExceptionIdent = Identifier::fromString(JSC::getVM(globalObject), "uncaughtException"_s);

    // if there is an uncaughtExceptionCaptureCallback, call it and consider the exception handled
    auto capture = process->getUncaughtExceptionCaptureCallback();
    if (!capture.isEmpty() && !capture.isUndefinedOrNull()) {
        auto scope = DECLARE_CATCH_SCOPE(vm);
        (void)call(lexicalGlobalObject, capture, args, "uncaughtExceptionCaptureCallback"_s);
        if (auto ex = scope.exception()) {
            scope.clearException();
            // if an exception is thrown in the uncaughtException handler, we abort
            Bun__logUnhandledException(JSValue::encode(JSValue(ex)));
            Bun__Process__exit(lexicalGlobalObject, 1);
        }
    } else if (wrapped.listenerCount(uncaughtExceptionIdent) > 0) {
        wrapped.emit(uncaughtExceptionIdent, args);
    } else {
        return false;
    }

    return true;
}
extern "C" bool Bun__promises__isErrorLike(JSC::JSGlobalObject* globalObject, JSC::JSValue obj)
{
    //   return typeof obj === 'object' &&
    //      obj !== null &&
    //      ObjectPrototypeHasOwnProperty(obj, 'stack');
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto object = obj.getObject();
    if (!object)
        return false;

    RELEASE_AND_RETURN(scope, JSC::objectPrototypeHasOwnProperty(globalObject, object, vm.propertyNames->stack));
}

extern "C" JSC::EncodedJSValue Bun__noSideEffectsToString(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue reason)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto decodedReason = JSValue::decode(reason);
    if (decodedReason.isSymbol()) {
        auto result = asSymbol(decodedReason)->tryGetDescriptiveString();
        if (result.has_value()) {
            RELEASE_AND_RETURN(scope, JSC::JSValue::encode(jsNontrivialString(globalObject->vm(), result.value())));
        }
        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(vm.smallStrings.symbolString()));
    }

    if (decodedReason.isInt32())
        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(jsString(vm, decodedReason.toWTFString(globalObject))));
    if (decodedReason.isDouble())
        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(jsString(vm, decodedReason.toWTFString(globalObject))));
    if (decodedReason.isTrue())
        return JSC::JSValue::encode(vm.smallStrings.trueString());
    if (decodedReason.isFalse())
        return JSC::JSValue::encode(vm.smallStrings.falseString());
    if (decodedReason.isNull())
        return JSC::JSValue::encode(vm.smallStrings.nullString());
    if (decodedReason.isUndefined())
        return JSC::JSValue::encode(vm.smallStrings.undefinedString());
    if (decodedReason.isString())
        return JSC::JSValue::encode(decodedReason);
    if (decodedReason.isBigInt())
        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(jsString(vm, decodedReason.toWTFString(globalObject))));
    return JSC::JSValue::encode(vm.smallStrings.objectObjectString());
}

extern "C" void Bun__promises__emitUnhandledRejectionWarning(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue reason, JSC::EncodedJSValue promise)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_CATCH_SCOPE(vm);
    auto warning = JSC::createError(globalObject, "Unhandled promise rejection. This error originated either by "
                                                  "throwing inside of an async function without a catch block, "
                                                  "or by rejecting a promise which was not handled with .catch(). "
                                                  "To terminate the bun process on unhandled promise "
                                                  "rejection, use the CLI flag `--unhandled-rejections=strict`."_s);
    warning->putDirect(vm, vm.propertyNames->name, jsString(vm, "UnhandledPromiseRejectionWarning"_str), JSC::PropertyAttribute::DontEnum | 0);

    JSValue reasonStack {};
    auto is_errorlike = Bun__promises__isErrorLike(globalObject, JSValue::decode(reason));
    CLEAR_IF_EXCEPTION(scope);
    if (is_errorlike) {
        reasonStack = JSValue::decode(reason).get(globalObject, vm.propertyNames->stack);
        CLEAR_IF_EXCEPTION(scope);
        warning->putDirect(vm, vm.propertyNames->stack, reasonStack);
    }
    if (!reasonStack) {
        reasonStack = JSValue::decode(Bun__noSideEffectsToString(vm, globalObject, reason));
        CLEAR_IF_EXCEPTION(scope);
    }
    if (!reasonStack) reasonStack = jsUndefined();

    Process::emitWarning(globalObject, reasonStack, jsString(globalObject->vm(), "UnhandledPromiseRejectionWarning"_str), jsUndefined(), jsUndefined());
    CLEAR_IF_EXCEPTION(scope);
    Process::emitWarningErrorInstance(globalObject, warning);
    CLEAR_IF_EXCEPTION(scope);
}

extern "C" int Bun__handleUnhandledRejection(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue reason, JSC::JSValue promise)
{
    if (!lexicalGlobalObject->inherits(Zig::GlobalObject::info()))
        return false;
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto* process = globalObject->processObject();

    auto eventType = Identifier::fromString(JSC::getVM(globalObject), "unhandledRejection"_s);
    auto& wrapped = process->wrapped();
    if (wrapped.listenerCount(eventType) > 0) {
        MarkedArgumentBuffer args;
        args.append(reason);
        args.append(promise);
        wrapped.emit(eventType, args);
        return true;
    }

    return false;
}

extern "C" bool Bun__VM__allowRejectionHandledWarning(void* vm);

extern "C" bool Bun__emitHandledPromiseEvent(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue promise)
{
    auto scope = DECLARE_CATCH_SCOPE(JSC::getVM(lexicalGlobalObject));
    if (!lexicalGlobalObject->inherits(Zig::GlobalObject::info()))
        return false;
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto* process = jsCast<Process*>(globalObject->processObject());

    auto eventType = Identifier::fromString(JSC::getVM(globalObject), "rejectionHandled"_s);

    if (Bun__VM__allowRejectionHandledWarning(globalObject->bunVM())) {
        Process::emitWarning(globalObject, jsString(globalObject->vm(), String("Promise rejection was handled asynchronously"_s)), jsString(globalObject->vm(), String("PromiseRejectionHandledWarning"_s)), jsUndefined(), jsUndefined());
        CLEAR_IF_EXCEPTION(scope);
    }
    auto& wrapped = process->wrapped();
    if (wrapped.listenerCount(eventType) > 0) {
        MarkedArgumentBuffer args;
        args.append(promise);
        wrapped.emit(eventType, args);
        return true;
    }

    return false;
}

extern "C" void Bun__refChannelUnlessOverridden(JSC::JSGlobalObject* globalObject);
extern "C" void Bun__unrefChannelUnlessOverridden(JSC::JSGlobalObject* globalObject);
extern "C" bool Bun__shouldIgnoreOneDisconnectEventListener(JSC::JSGlobalObject* globalObject);

extern "C" void Bun__ensureSignalHandler();
extern "C" bool Bun__isMainThreadVM();
extern "C" void Bun__onPosixSignal(int signalNumber);

__attribute__((noinline)) static void forwardSignal(int signalNumber)
{
    // We want a function that's equivalent to Bun__onPosixSignal but whose address is different.
    // This is so that we can be sure not to uninstall signal handlers that we didn't install here.
    Bun__onPosixSignal(signalNumber);
}

static void onDidChangeListeners(EventEmitter& eventEmitter, const Identifier& eventName, bool isAdded)
{
    if (Bun__isMainThreadVM()) {
        // IPC handlers
        if (eventName == "message" || eventName == "disconnect") {
            auto* global = jsCast<GlobalObject*>(eventEmitter.scriptExecutionContext()->jsGlobalObject());
            auto& vm = JSC::getVM(global);
            auto messageListenerCount = eventEmitter.listenerCount(vm.propertyNames->message);
            auto disconnectListenerCount = eventEmitter.listenerCount(Identifier::fromString(vm, "disconnect"_s));
            if (disconnectListenerCount >= 1 && Bun__shouldIgnoreOneDisconnectEventListener(global)) {
                disconnectListenerCount--;
            }
            auto totalListenerCount = messageListenerCount + disconnectListenerCount;
            if (isAdded) {
                if (Bun__GlobalObject__hasIPC(global)
                    && totalListenerCount == 1) {
                    Bun__ensureProcessIPCInitialized(global);
                    Bun__refChannelUnlessOverridden(global);
                }
            } else {
                if (Bun__GlobalObject__hasIPC(global)
                    && totalListenerCount == 0) {
                    Bun__unrefChannelUnlessOverridden(global);
                }
            }
            return;
        }

        // Signal Handlers
        loadSignalNumberMap();
        static std::once_flag signalNumberToNameMapOnceFlag;
        std::call_once(signalNumberToNameMapOnceFlag, [] {
            auto signalNames = getSignalNames();
            signalNumberToNameMap = new HashMap<int, String>();
            signalNumberToNameMap->reserveInitialCapacity(31);
            signalNumberToNameMap->add(SIGHUP, signalNames[0]);
            signalNumberToNameMap->add(SIGINT, signalNames[1]);
            signalNumberToNameMap->add(SIGQUIT, signalNames[2]);
            signalNumberToNameMap->add(SIGILL, signalNames[3]);
#ifdef SIGTRAP
            signalNumberToNameMap->add(SIGTRAP, signalNames[4]);
#endif
            signalNumberToNameMap->add(SIGABRT, signalNames[5]);
#ifdef SIGIOT
            signalNumberToNameMap->add(SIGIOT, signalNames[6]);
#endif
#ifdef SIGBUS
            signalNumberToNameMap->add(SIGBUS, signalNames[7]);
#endif
            signalNumberToNameMap->add(SIGFPE, signalNames[8]);
            signalNumberToNameMap->add(SIGKILL, signalNames[9]);
#ifdef SIGUSR1
            signalNumberToNameMap->add(SIGUSR1, signalNames[10]);
#endif
            signalNumberToNameMap->add(SIGSEGV, signalNames[11]);
#ifdef SIGUSR2
            signalNumberToNameMap->add(SIGUSR2, signalNames[12]);
#endif
#ifdef SIGPIPE
            signalNumberToNameMap->add(SIGPIPE, signalNames[13]);
#endif
#ifdef SIGALRM
            signalNumberToNameMap->add(SIGALRM, signalNames[14]);
#endif
            signalNumberToNameMap->add(SIGTERM, signalNames[15]);
#ifdef SIGCHLD
            signalNumberToNameMap->add(SIGCHLD, signalNames[16]);
#endif
#ifdef SIGCONT
            signalNumberToNameMap->add(SIGCONT, signalNames[17]);
#endif
#ifdef SIGSTOP
            signalNumberToNameMap->add(SIGSTOP, signalNames[18]);
#endif
#ifdef SIGTSTP
            signalNumberToNameMap->add(SIGTSTP, signalNames[19]);
#endif
#ifdef SIGTTIN
            signalNumberToNameMap->add(SIGTTIN, signalNames[20]);
#endif
#ifdef SIGTTOU
            signalNumberToNameMap->add(SIGTTOU, signalNames[21]);
#endif
#ifdef SIGURG
            signalNumberToNameMap->add(SIGURG, signalNames[22]);
#endif
#ifdef SIGXCPU
            signalNumberToNameMap->add(SIGXCPU, signalNames[23]);
#endif
#ifdef SIGXFSZ
            signalNumberToNameMap->add(SIGXFSZ, signalNames[24]);
#endif
#ifdef SIGVTALRM
            signalNumberToNameMap->add(SIGVTALRM, signalNames[25]);
#endif
#ifdef SIGPROF
            signalNumberToNameMap->add(SIGPROF, signalNames[26]);
#endif
            signalNumberToNameMap->add(SIGWINCH, signalNames[27]);
#ifdef SIGIO
            signalNumberToNameMap->add(SIGIO, signalNames[28]);
#endif
#ifdef SIGINFO
            signalNumberToNameMap->add(SIGINFO, signalNames[29]);
#endif
#ifdef SIGSYS
            signalNumberToNameMap->add(SIGSYS, signalNames[30]);
#endif
        });

        if (!signalToContextIdsMap) {
            signalToContextIdsMap = new HashMap<int, SignalHandleValue>();
        }

        if (auto signalNumber = signalNameToNumberMap->get(eventName.string())) {
#if OS(LINUX)
            // SIGKILL and SIGSTOP cannot be handled, and JSC needs its own signal handler to
            // suspend and resume the JS thread which we must not override.
            if (signalNumber != SIGKILL && signalNumber != SIGSTOP && signalNumber != g_wtfConfig.sigThreadSuspendResume) {
#elif OS(DARWIN)
            // these signals cannot be handled
            if (signalNumber != SIGKILL && signalNumber != SIGSTOP) {
#elif OS(WINDOWS)
            // windows has no SIGSTOP
            if (signalNumber != SIGKILL) {
#else
#error unknown OS
#endif

                if (isAdded) {
                    if (!signalToContextIdsMap->contains(signalNumber)) {
                        SignalHandleValue signal_handle = {
#if OS(WINDOWS)
                            .handle = nullptr,
#endif
                        };
#if !OS(WINDOWS)
                        Bun__ensureSignalHandler();
                        struct sigaction action;
                        memset(&action, 0, sizeof(struct sigaction));

                        // Set the handler in the action struct
                        action.sa_handler = forwardSignal;

                        // Clear the sa_mask
                        sigemptyset(&action.sa_mask);
                        sigaddset(&action.sa_mask, signalNumber);
                        action.sa_flags = SA_RESTART;

                        sigaction(signalNumber, &action, nullptr);
#else
                        signal_handle.handle = Bun__UVSignalHandle__init(
                            eventEmitter.scriptExecutionContext()->jsGlobalObject(),
                            signalNumber,
                            &signalHandler);

                        if (!signal_handle.handle) [[unlikely]]
                            return;
#endif

                        signalToContextIdsMap->set(signalNumber, signal_handle);
                    }
                } else {
                    if (signalToContextIdsMap->find(signalNumber) != signalToContextIdsMap->end()) {

#if !OS(WINDOWS)
                        if (void (*oldHandler)(int) = signal(signalNumber, SIG_DFL); oldHandler != forwardSignal) {
                            // Don't uninstall the old handler if it's not the one we installed.
                            signal(signalNumber, oldHandler);
                        }
#else
                        SignalHandleValue signal_handle = signalToContextIdsMap->get(signalNumber);
                        Bun__UVSignalHandle__close(signal_handle.handle);
#endif
                        signalToContextIdsMap->remove(signalNumber);
                    }
                }
            }
        }
    }
}

Process::~Process()
{
}

extern "C" bool Bun__NODE_NO_WARNINGS();

static bool isJSValueEqualToASCIILiteral(JSC::JSGlobalObject* globalObject, JSC::JSValue value, const ASCIILiteral literal)
{
    if (!value.isString()) {
        return false;
    }

    auto* str = value.toStringOrNull(globalObject);
    if (!str) {
        return false;
    }
    auto view = str->view(globalObject);
    return view == literal;
}

extern "C" void Bun__Process__emitWarning(Zig::GlobalObject* globalObject, EncodedJSValue warning, EncodedJSValue type, EncodedJSValue code, EncodedJSValue ctor)
{
    // ignoring return value -- emitWarning only ever returns undefined or throws
    (void)Process::emitWarning(
        globalObject,
        JSValue::decode(warning),
        JSValue::decode(type),
        JSValue::decode(code),
        JSValue::decode(ctor));
}

JSValue Process::emitWarningErrorInstance(JSC::JSGlobalObject* lexicalGlobalObject, JSValue errorInstance)
{
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* process = globalObject->processObject();

    auto warningName = errorInstance.get(lexicalGlobalObject, vm.propertyNames->name);
    RETURN_IF_EXCEPTION(scope, {});
    if (isJSValueEqualToASCIILiteral(globalObject, warningName, "DeprecationWarning"_s)) {
        if (Bun__Node__ProcessNoDeprecation) {
            return jsUndefined();
        }
        if (Bun__Node__ProcessThrowDeprecation) {
            // // Delay throwing the error to guarantee that all former warnings were properly logged.
            // return process.nextTick(() => {
            //    throw warning;
            // });
            auto func = JSFunction::create(vm, globalObject, 1, ""_s, jsFunction_throwValue, JSC::ImplementationVisibility::Private);
            process->queueNextTick(globalObject, func, errorInstance);
            RETURN_IF_EXCEPTION(scope, {});
            return jsUndefined();
        }
    }

    //   process.nextTick(doEmitWarning, warning);
    auto func = JSFunction::create(vm, globalObject, 1, ""_s, jsFunction_emitWarning, JSC::ImplementationVisibility::Private);
    process->queueNextTick(globalObject, func, errorInstance);
    RETURN_IF_EXCEPTION(scope, {});
    return jsUndefined();
}
JSValue Process::emitWarning(JSC::JSGlobalObject* lexicalGlobalObject, JSValue warning, JSValue type, JSValue code, JSValue ctor)
{
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue detail = jsUndefined();

    if (Bun__Node__ProcessNoDeprecation && isJSValueEqualToASCIILiteral(globalObject, type, "DeprecationWarning"_s)) {
        return jsUndefined();
    }

    if (!type.isNull() && type.isObject() && !isJSArray(type)) {
        ctor = type.get(globalObject, Identifier::fromString(vm, "ctor"_s));
        RETURN_IF_EXCEPTION(scope, {});

        code = type.get(globalObject, builtinNames(vm).codePublicName());
        RETURN_IF_EXCEPTION(scope, {});

        detail = type.get(globalObject, vm.propertyNames->detail);
        RETURN_IF_EXCEPTION(scope, {});
        if (!detail.isString()) detail = jsUndefined();

        type = type.get(globalObject, vm.propertyNames->type);
        RETURN_IF_EXCEPTION(scope, {});
        if (!type.toBoolean(globalObject)) type = jsString(vm, String("Warning"_s));
    } else if (type.isCallable()) {
        ctor = type;
        code = jsUndefined();
        type = jsString(vm, String("Warning"_s));
    }

    if (!type.isUndefined()) {
        Bun::V::validateString(scope, globalObject, type, "type"_s);
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        type = jsString(vm, String("Warning"_s));
    }

    if (code.isCallable()) {
        ctor = code;
        code = jsUndefined();
    } else if (!code.isUndefined()) {
        Bun::V::validateString(scope, globalObject, code, "code"_s);
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSObject* errorInstance;

    if (warning.isString()) {
        auto s = warning.getString(globalObject);
        errorInstance = createError(globalObject, !s.isEmpty() ? s : "Warning"_s);
        errorInstance->putDirect(vm, vm.propertyNames->name, type, JSC::PropertyAttribute::DontEnum | 0);
    } else if (warning.isCell() && warning.asCell()->type() == ErrorInstanceType) {
        errorInstance = warning.getObject();
    } else {
        return JSValue::decode(Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "warning"_s, "string or Error"_s, warning));
    }

    if (!code.isUndefined()) errorInstance->putDirect(vm, builtinNames(vm).codePublicName(), code, JSC::PropertyAttribute::DontEnum | 0);
    if (!detail.isUndefined()) errorInstance->putDirect(vm, vm.propertyNames->detail, detail, JSC::PropertyAttribute::DontEnum | 0);

    /*
    // TODO: ErrorCaptureStackTrace(warning, ctor || process.emitWarning);
    // This doesn't work, getStackTrace does not get any stack frames.
    Vector<StackFrame> stackTrace;
    const size_t framesToSkip = 1;
    JSValue caller;
    if (ctor.toBoolean(globalObject)) {
        caller = ctor;
    } else {
        auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
        auto* process = globalObject->processObject();
        caller = process->get(globalObject, Identifier::fromString(vm, String("emitWarning"_s)));
        RETURN_IF_EXCEPTION(scope, {});
    }
    vm.interpreter.getStackTrace(errorInstance, stackTrace, framesToSkip, globalObject->stackTraceLimit().value_or(0), caller.isCallable() ? caller.asCell() : nullptr);
    errorInstance->putDirect(vm, vm.propertyNames->stack, jsString(vm, Interpreter::stackTraceAsString(vm, stackTrace)), static_cast<unsigned>(PropertyAttribute::DontEnum));
    */

    RELEASE_AND_RETURN(scope, emitWarningErrorInstance(lexicalGlobalObject, errorInstance));
}

static JSValue constructReportObjectComplete(VM& vm, Zig::GlobalObject* globalObject, const String& fileName)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
#if !OS(WINDOWS)
    auto constructUserLimits = [&]() -> JSValue {
        JSC::JSObject* userLimits = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 11);
        RETURN_IF_EXCEPTION(scope, {});

        static constexpr int resourceLimits[] = {
            RLIMIT_CORE,
            RLIMIT_DATA,
            RLIMIT_FSIZE,
            RLIMIT_MEMLOCK,
            RLIMIT_RSS,
            RLIMIT_NOFILE,
            RLIMIT_STACK,
            RLIMIT_CPU,
            RLIMIT_NPROC,
            RLIMIT_AS,
        };

        static constexpr ASCIILiteral labels[] = {
            "core_file_size_blocks"_s,
            "data_seg_size_kbytes"_s,
            "file_size_blocks"_s,
            "max_locked_memory_bytes"_s,
            "max_memory_size_kbytes"_s,
            "open_files"_s,
            "stack_size_bytes"_s,
            "cpu_time_seconds"_s,
            "max_user_processes"_s,
            "virtual_memory_kbytes"_s,
        };

        for (size_t i = 0; i < std::size(resourceLimits); i++) {
            JSC::JSObject* limitObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
            RETURN_IF_EXCEPTION(scope, {});
            struct rlimit limit;
            getrlimit(resourceLimits[i], &limit);

            JSValue soft = limit.rlim_cur == RLIM_INFINITY ? JSC::jsString(vm, String("unlimited"_s)) : JSC::jsNumber(limit.rlim_cur);

            JSValue hard = limit.rlim_max == RLIM_INFINITY ? JSC::jsString(vm, String("unlimited"_s)) : JSC::jsNumber(limit.rlim_max);

            limitObject->putDirect(vm, JSC::Identifier::fromString(vm, "soft"_s), soft, 0);
            limitObject->putDirect(vm, JSC::Identifier::fromString(vm, "hard"_s), hard, 0);

            userLimits->putDirect(vm, JSC::Identifier::fromString(vm, labels[i]), limitObject, 0);
        }

        return userLimits;
    };

    auto constructResourceUsage = [&]() -> JSC::JSValue {
        JSC::JSObject* resourceUsage = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 11);
        RETURN_IF_EXCEPTION(scope, {});

        rusage usage;

        getrusage(RUSAGE_SELF, &usage);

        resourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "free_memory"_s), JSC::jsNumber(usage.ru_maxrss), 0);
        resourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "total_memory"_s), JSC::jsNumber(usage.ru_maxrss), 0);
        resourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "rss"_s), JSC::jsNumber(usage.ru_maxrss), 0);
        resourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "available_memory"_s), JSC::jsNumber(usage.ru_maxrss), 0);
        resourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "userCpuSeconds"_s), JSC::jsNumber(usage.ru_utime.tv_sec), 0);
        resourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "kernelCpuSeconds"_s), JSC::jsNumber(usage.ru_stime.tv_sec), 0);
        resourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "cpuConsumptionPercent"_s), JSC::jsNumber(usage.ru_utime.tv_sec), 0);
        resourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "userCpuConsumptionPercent"_s), JSC::jsNumber(usage.ru_utime.tv_sec), 0);
        resourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "kernelCpuConsumptionPercent"_s), JSC::jsNumber(usage.ru_utime.tv_sec), 0);
        resourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "maxRss"_s), JSC::jsNumber(usage.ru_maxrss), 0);

        JSC::JSObject* pageFaults = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
        RETURN_IF_EXCEPTION(scope, {});
        pageFaults->putDirect(vm, JSC::Identifier::fromString(vm, "IORequired"_s), JSC::jsNumber(usage.ru_majflt), 0);
        pageFaults->putDirect(vm, JSC::Identifier::fromString(vm, "IONotRequired"_s), JSC::jsNumber(usage.ru_minflt), 0);

        resourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "pageFaults"_s), pageFaults, 0);

        JSC::JSObject* fsActivity = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
        RETURN_IF_EXCEPTION(scope, {});
        fsActivity->putDirect(vm, JSC::Identifier::fromString(vm, "reads"_s), JSC::jsNumber(usage.ru_inblock), 0);
        fsActivity->putDirect(vm, JSC::Identifier::fromString(vm, "writes"_s), JSC::jsNumber(usage.ru_oublock), 0);

        resourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "fsActivity"_s), fsActivity, 0);

        return resourceUsage;
    };

    auto constructHeader = [&]() -> JSC::JSValue {
        JSC::JSObject* header = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype());
        RETURN_IF_EXCEPTION(scope, {});

        header->putDirect(vm, JSC::Identifier::fromString(vm, "reportVersion"_s), JSC::jsNumber(3), 0);
        header->putDirect(vm, JSC::Identifier::fromString(vm, "event"_s), JSC::jsString(vm, String("JavaScript API"_s)), 0);
        header->putDirect(vm, JSC::Identifier::fromString(vm, "trigger"_s), JSC::jsString(vm, String("GetReport"_s)), 0);
        if (fileName.isEmpty()) {
            header->putDirect(vm, JSC::Identifier::fromString(vm, "filename"_s), JSC::jsNull(), 0);
        } else {
            header->putDirect(vm, JSC::Identifier::fromString(vm, "filename"_s), JSC::jsString(vm, fileName), 0);
        }

        double time = WTF::jsCurrentTime();
        char timeBuf[64] = { 0 };
        Bun::toISOString(vm, time, timeBuf);
        auto timeStamp = WTF::String::fromLatin1(timeBuf);

        header->putDirect(vm, JSC::Identifier::fromString(vm, "dumpEventTime"_s), JSC::numberToString(vm, time, 10), 0);
        header->putDirect(vm, JSC::Identifier::fromString(vm, "dumpEventTimeStamp"_s), JSC::jsString(vm, timeStamp));
        header->putDirect(vm, JSC::Identifier::fromString(vm, "processId"_s), JSC::jsNumber(getpid()), 0);
        // TODO:
        header->putDirect(vm, JSC::Identifier::fromString(vm, "threadId"_s), JSC::jsNumber(0), 0);

        {
            char cwd[PATH_MAX] = { 0 };

            if (getcwd(cwd, PATH_MAX) == nullptr) {
                cwd[0] = '.';
                cwd[1] = '\0';
            }

            header->putDirect(vm, JSC::Identifier::fromString(vm, "cwd"_s), JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const Latin1Character*>(cwd), strlen(cwd) })), 0);
            RETURN_IF_EXCEPTION(scope, {});
        }

        header->putDirect(vm, JSC::Identifier::fromString(vm, "commandLine"_s), JSValue::decode(Bun__Process__createExecArgv(globalObject)), 0);
        RETURN_IF_EXCEPTION(scope, {});
        header->putDirect(vm, JSC::Identifier::fromString(vm, "nodejsVersion"_s), JSC::jsString(vm, String::fromLatin1(REPORTED_NODEJS_VERSION)), 0);
        header->putDirect(vm, JSC::Identifier::fromString(vm, "wordSize"_s), JSC::jsNumber(64), 0);
        header->putDirect(vm, JSC::Identifier::fromString(vm, "arch"_s), constructArch(vm, header), 0);
        header->putDirect(vm, JSC::Identifier::fromString(vm, "platform"_s), constructPlatform(vm, header), 0);
        header->putDirect(vm, JSC::Identifier::fromString(vm, "componentVersions"_s), constructVersions(vm, header), 0);
        RETURN_IF_EXCEPTION(scope, {});
        header->putDirect(vm, JSC::Identifier::fromString(vm, "release"_s), constructProcessReleaseObject(vm, header), 0);
        RETURN_IF_EXCEPTION(scope, {});

        {
            // uname
            struct utsname buf;
            if (uname(&buf) != 0) {
                memset(&buf, 0, sizeof(buf));
            }

            header->putDirect(vm, JSC::Identifier::fromString(vm, "osName"_s), JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const Latin1Character*>(buf.sysname), strlen(buf.sysname) })), 0);
            header->putDirect(vm, JSC::Identifier::fromString(vm, "osRelease"_s), JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const Latin1Character*>(buf.release), strlen(buf.release) })), 0);
            header->putDirect(vm, JSC::Identifier::fromString(vm, "osVersion"_s), JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const Latin1Character*>(buf.version), strlen(buf.version) })), 0);
            header->putDirect(vm, JSC::Identifier::fromString(vm, "osMachine"_s), JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const Latin1Character*>(buf.machine), strlen(buf.machine) })), 0);
        }

        // host
        {
            // TODO: use HOSTNAME_MAX
            char host[1024] = { 0 };
            if (gethostname(host, 1024) != 0) {
                host[0] = '0';
            }

            header->putDirect(vm, JSC::Identifier::fromString(vm, "host"_s), JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const Latin1Character*>(host), strlen(host) })), 0);
        }

#if OS(LINUX)
#ifdef __GNU_LIBRARY__
        header->putDirect(vm, JSC::Identifier::fromString(vm, "glibcVersionCompiler"_s), JSC::jsString(vm, makeString(__GLIBC__, '.', __GLIBC_MINOR__)), 0);
        header->putDirect(vm, JSC::Identifier::fromString(vm, "glibcVersionRuntime"_s), JSC::jsString(vm, String::fromUTF8(gnu_get_libc_version())), 0);
#else
#endif
#endif

        header->putDirect(vm, Identifier::fromString(vm, "cpus"_s), JSC::constructEmptyArray(globalObject, nullptr), 0);
        RETURN_IF_EXCEPTION(scope, {});
        header->putDirect(vm, Identifier::fromString(vm, "networkInterfaces"_s), JSC::constructEmptyArray(globalObject, nullptr), 0);
        RETURN_IF_EXCEPTION(scope, {});

        return header;
    };

    auto constructJavaScriptHeap = [&]() -> JSC::JSValue {
        JSC::JSObject* heap = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 16);
        RETURN_IF_EXCEPTION(scope, {});

        JSC::JSObject* heapSpaces = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 9);
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "read_only_space"_s), JSC::constructEmptyObject(globalObject), 0);
        RETURN_IF_EXCEPTION(scope, {});
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "new_space"_s), JSC::constructEmptyObject(globalObject), 0);
        RETURN_IF_EXCEPTION(scope, {});
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "old_space"_s), JSC::constructEmptyObject(globalObject), 0);
        RETURN_IF_EXCEPTION(scope, {});
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "code_space"_s), JSC::constructEmptyObject(globalObject), 0);
        RETURN_IF_EXCEPTION(scope, {});
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "shared_space"_s), JSC::constructEmptyObject(globalObject), 0);
        RETURN_IF_EXCEPTION(scope, {});
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "new_large_object_space"_s), JSC::constructEmptyObject(globalObject), 0);
        RETURN_IF_EXCEPTION(scope, {});
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "large_object_space"_s), JSC::constructEmptyObject(globalObject), 0);
        RETURN_IF_EXCEPTION(scope, {});
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "code_large_object_space"_s), JSC::constructEmptyObject(globalObject), 0);
        RETURN_IF_EXCEPTION(scope, {});
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "shared_large_object_space"_s), JSC::constructEmptyObject(globalObject), 0);
        RETURN_IF_EXCEPTION(scope, {});

        heap->putDirect(vm, JSC::Identifier::fromString(vm, "totalMemory"_s), JSC::jsNumber(WTF::ramSize()), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "executableMemory"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "totalCommittedMemory"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "availableMemory"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "totalGlobalHandlesMemory"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "usedGlobalHandlesMemory"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "usedMemory"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "memoryLimit"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "mallocedMemory"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "externalMemory"_s), JSC::jsNumber(vm.heap.externalMemorySize()), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "peakMallocedMemory"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "nativeContextCount"_s), JSC::jsNumber(1), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "detachedContextCount"_s), JSC::jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "doesZapGarbage"_s), JSC::jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "heapSpaces"_s), heapSpaces, 0);

        return heap;
    };

    auto constructUVThreadResourceUsage = [&]() -> JSC::JSValue {
        JSC::JSObject* uvthreadResourceUsage = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 6);
        RETURN_IF_EXCEPTION(scope, {});

        uvthreadResourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "userCpuSeconds"_s), JSC::jsNumber(0), 0);
        uvthreadResourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "kernelCpuSeconds"_s), JSC::jsNumber(0), 0);
        uvthreadResourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "cpuConsumptionPercent"_s), JSC::jsNumber(0), 0);
        uvthreadResourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "userCpuConsumptionPercent"_s), JSC::jsNumber(0), 0);
        uvthreadResourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "kernelCpuConsumptionPercent"_s), JSC::jsNumber(0), 0);

        JSC::JSObject* fsActivity = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
        RETURN_IF_EXCEPTION(scope, {});
        fsActivity->putDirect(vm, JSC::Identifier::fromString(vm, "reads"_s), JSC::jsNumber(0), 0);
        fsActivity->putDirect(vm, JSC::Identifier::fromString(vm, "writes"_s), JSC::jsNumber(0), 0);

        uvthreadResourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "fsActivity"_s), fsActivity, 0);

        return uvthreadResourceUsage;
    };

    auto constructJavaScriptStack = [&]() -> JSC::JSValue {
        JSC::JSObject* javascriptStack = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 3);
        RETURN_IF_EXCEPTION(scope, {});

        javascriptStack->putDirect(vm, vm.propertyNames->message, JSC::jsString(vm, String("Error [ERR_SYNTHETIC]: JavaScript Callstack"_s)), 0);

        // TODO: allow errors as an argument
        {
            WTF::Vector<JSC::StackFrame> stackFrames;
            vm.interpreter.getStackTrace(javascriptStack, stackFrames, 1);
            String name = "Error"_s;
            String message = "JavaScript Callstack"_s;
            OrdinalNumber line = OrdinalNumber::beforeFirst();
            OrdinalNumber column = OrdinalNumber::beforeFirst();
            WTF::String sourceURL;
            WTF::String stackProperty = Bun::formatStackTrace(
                vm, globalObject, globalObject, name, message,
                line, column,
                sourceURL, stackFrames, nullptr);

            WTF::String stack;
            // first line after "Error:"
            size_t firstLine = stackProperty.find('\n');
            if (firstLine != WTF::notFound) {
                stack = stackProperty.substring(firstLine + 1);
            }

            JSC::JSArray* stackArray = JSC::constructEmptyArray(globalObject, nullptr);
            RETURN_IF_EXCEPTION(scope, {});

            stack.split('\n', [&](const WTF::StringView& line) {
                stackArray->push(globalObject, JSC::jsString(vm, line.toString().trim(isASCIIWhitespace)));
                RETURN_IF_EXCEPTION(scope, );
            });
            RETURN_IF_EXCEPTION(scope, {});

            javascriptStack->putDirect(vm, vm.propertyNames->stack, stackArray, 0);
        }

        JSC::JSObject* errorProperties = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 1);
        RETURN_IF_EXCEPTION(scope, {});
        errorProperties->putDirect(vm, JSC::Identifier::fromString(vm, "code"_s), JSC::jsString(vm, String("ERR_SYNTHETIC"_s)), 0);
        javascriptStack->putDirect(vm, JSC::Identifier::fromString(vm, "errorProperties"_s), errorProperties, 0);
        return javascriptStack;
    };

    auto constructSharedObjects = [&]() -> JSC::JSValue {
        JSC::JSObject* sharedObjects = JSC::constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});

        // TODO:

        return sharedObjects;
    };

    auto constructLibUV = [&]() -> JSC::JSValue {
        JSC::JSObject* libuv = JSC::constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});

        // TODO:

        return libuv;
    };

    auto constructWorkers = [&]() -> JSC::JSValue {
        JSC::JSObject* workers = JSC::constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});

        // TODO:

        return workers;
    };

    auto constructEnvironmentVariables = [&]() -> JSC::JSValue {
        return globalObject->processEnvObject();
    };

    auto constructCpus = [&]() -> JSC::JSValue {
        JSC::JSObject* cpus = JSC::constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});

        // TODO:

        return cpus;
    };

    auto constructNetworkInterfaces = [&]() -> JSC::JSValue {
        JSC::JSObject* networkInterfaces = JSC::constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});

        // TODO:

        return networkInterfaces;
    };

    auto constructNativeStack = [&]() -> JSC::JSValue {
        JSC::JSObject* nativeStack = JSC::constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});

        // TODO:

        return nativeStack;
    };

    {
        JSC::JSObject* report = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 19);
        RETURN_IF_EXCEPTION(scope, {});

        report->putDirect(vm, JSC::Identifier::fromString(vm, "header"_s), constructHeader(), 0);
        RETURN_IF_EXCEPTION(scope, {});
        report->putDirect(vm, JSC::Identifier::fromString(vm, "javascriptStack"_s), constructJavaScriptStack(), 0);
        RETURN_IF_EXCEPTION(scope, {});
        report->putDirect(vm, JSC::Identifier::fromString(vm, "javascriptHeap"_s), constructJavaScriptHeap(), 0);
        RETURN_IF_EXCEPTION(scope, {});
        report->putDirect(vm, JSC::Identifier::fromString(vm, "nativeStack"_s), constructNativeStack(), 0);
        RETURN_IF_EXCEPTION(scope, {});
        report->putDirect(vm, JSC::Identifier::fromString(vm, "resourceUsage"_s), constructResourceUsage(), 0);
        RETURN_IF_EXCEPTION(scope, {});
        report->putDirect(vm, JSC::Identifier::fromString(vm, "uvthreadResourceUsage"_s), constructUVThreadResourceUsage(), 0);
        RETURN_IF_EXCEPTION(scope, {});
        report->putDirect(vm, JSC::Identifier::fromString(vm, "libuv"_s), constructLibUV(), 0);
        RETURN_IF_EXCEPTION(scope, {});
        report->putDirect(vm, JSC::Identifier::fromString(vm, "workers"_s), constructWorkers(), 0);
        RETURN_IF_EXCEPTION(scope, {});
        report->putDirect(vm, JSC::Identifier::fromString(vm, "environmentVariables"_s), constructEnvironmentVariables(), 0);
        RETURN_IF_EXCEPTION(scope, {});
        report->putDirect(vm, JSC::Identifier::fromString(vm, "userLimits"_s), constructUserLimits(), 0);
        RETURN_IF_EXCEPTION(scope, {});
        report->putDirect(vm, JSC::Identifier::fromString(vm, "sharedObjects"_s), constructSharedObjects(), 0);
        RETURN_IF_EXCEPTION(scope, {});
        report->putDirect(vm, JSC::Identifier::fromString(vm, "cpus"_s), constructCpus(), 0);
        RETURN_IF_EXCEPTION(scope, {});
        report->putDirect(vm, JSC::Identifier::fromString(vm, "networkInterfaces"_s), constructNetworkInterfaces(), 0);
        RETURN_IF_EXCEPTION(scope, {});

        return report;
    }
#else // OS(WINDOWS)
    // Forward declaration - implemented in BunProcessReportObjectWindows.cpp
    JSValue constructReportObjectWindows(VM & vm, Zig::GlobalObject * globalObject, Process * process);

    // Get the Process object - needed for accessing report settings
    Process* process = globalObject->processObject();

    return constructReportObjectWindows(vm, globalObject, process);
#endif
}

static JSValue constructProcessReportObject(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    // auto* globalObject = static_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto process = jsCast<Process*>(processObject);

    auto* report = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 10);
    report->putDirect(vm, JSC::Identifier::fromString(vm, "compact"_s), JSC::jsBoolean(false), 0);
    report->putDirect(vm, JSC::Identifier::fromString(vm, "directory"_s), JSC::jsEmptyString(vm), 0);
    report->putDirect(vm, JSC::Identifier::fromString(vm, "filename"_s), JSC::jsEmptyString(vm), 0);
    report->putDirect(vm, JSC::Identifier::fromString(vm, "getReport"_s), JSC::JSFunction::create(vm, globalObject, 0, String("getReport"_s), Process_functionGetReport, ImplementationVisibility::Public), 0);
    report->putDirect(vm, JSC::Identifier::fromString(vm, "reportOnFatalError"_s), JSC::jsBoolean(false), 0);
    report->putDirect(vm, JSC::Identifier::fromString(vm, "reportOnSignal"_s), JSC::jsBoolean(false), 0);
    report->putDirect(vm, JSC::Identifier::fromString(vm, "reportOnUncaughtException"_s), JSC::jsBoolean(process->m_reportOnUncaughtException), 0);
    report->putDirect(vm, JSC::Identifier::fromString(vm, "excludeEnv"_s), JSC::jsBoolean(false), 0);
    report->putDirect(vm, JSC::Identifier::fromString(vm, "excludeEnv"_s), JSC::jsString(vm, String("SIGUSR2"_s)), 0);
    report->putDirect(vm, JSC::Identifier::fromString(vm, "writeReport"_s), JSC::JSFunction::create(vm, globalObject, 1, String("writeReport"_s), Process_functionWriteReport, ImplementationVisibility::Public), 0);
    return report;
}

static JSValue constructProcessConfigObject(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    //   target_defaults:
    //    { cflags: [],
    //      default_configuration: 'Release',
    //      defines: [],
    //      include_dirs: [],
    //      libraries: [] },
    //   variables:
    //    {
    //      host_arch: 'x64',
    //      napi_build_version: 5,
    //      node_install_npm: 'true',
    //      node_prefix: '',
    //      node_shared_cares: 'false',
    //      node_shared_http_parser: 'false',
    //      node_shared_libuv: 'false',
    //      node_shared_zlib: 'false',
    //      node_use_openssl: 'true',
    //      node_shared_openssl: 'false',
    //      strict_aliasing: 'true',
    //      target_arch: 'x64',
    //      v8_use_snapshot: 1
    //    }
    // }
    JSC::JSObject* config = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
    JSC::JSObject* variables = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "v8_enable_i8n_support"_s), JSC::jsNumber(1), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "enable_lto"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "node_module_version"_s), JSC::jsNumber(REPORTED_NODEJS_ABI_VERSION), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "napi_build_version"_s), JSC::jsNumber(Napi::DEFAULT_NAPI_VERSION), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "node_builtin_shareable_builtins"_s), JSC::constructEmptyArray(globalObject, nullptr), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "node_byteorder"_s), JSC::jsString(vm, String("little"_s)), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "clang"_s), JSC::jsNumber(0), 0);

    config->putDirect(vm, JSC::Identifier::fromString(vm, "target_defaults"_s), JSC::constructEmptyObject(globalObject), 0);
    config->putDirect(vm, JSC::Identifier::fromString(vm, "variables"_s), variables, 0);

#if OS(WINDOWS)
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "control_flow_guard"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "coverage"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "dcheck_always_on"_s), JSC::jsNumber(0), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "debug_nghttp2"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "debug_node"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "enable_lto"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "enable_pgo_generate"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "enable_pgo_use"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "error_on_warn"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "force_dynamic_crt"_s), JSC::jsNumber(0), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "napi_build_version"_s), JSC::jsNumber(Napi::DEFAULT_NAPI_VERSION), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "nasm_version"_s), JSC::jsNumber(2), 0);
#elif OS(MACOS)
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "control_flow_guard"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "coverage"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "dcheck_always_on"_s), JSC::jsNumber(0), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "debug_nghttp2"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "debug_node"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "enable_lto"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "enable_pgo_generate"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "enable_pgo_use"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "error_on_warn"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "force_dynamic_crt"_s), JSC::jsNumber(0), 0);
#if CPU(ARM64)
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "arm_fpu"_s), JSC::jsString(vm, String("neon"_s)), 0);
#endif
#elif OS(LINUX)
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "control_flow_guard"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "coverage"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "dcheck_always_on"_s), JSC::jsNumber(0), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "debug_nghttp2"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "debug_node"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "enable_lto"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "enable_pgo_generate"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "enable_pgo_use"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "error_on_warn"_s), JSC::jsBoolean(false), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "force_dynamic_crt"_s), JSC::jsNumber(0), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "napi_build"_s), JSC::jsString(vm, String("0.0"_s)), 0);
#else
#error "Unsupported OS"
#endif

#if CPU(X86_64)
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "host_arch"_s), JSC::jsString(vm, String("x64"_s)), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "target_arch"_s), JSC::jsString(vm, String("x64"_s)), 0);
#elif CPU(ARM64)
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "host_arch"_s), JSC::jsString(vm, String("arm64"_s)), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "target_arch"_s), JSC::jsString(vm, String("arm64"_s)), 0);
#else
#error "Unsupported architecture"
#endif

#if ASAN_ENABLED
    // TODO: figure out why this causes v8.test.ts to fail.
    // variables->putDirect(vm, JSC::Identifier::fromString(vm, "asan"_s), JSC::jsNumber(1), 0);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "asan"_s), JSC::jsNumber(0), 0);
#else
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "asan"_s), JSC::jsNumber(0), 0);
#endif

    config->freeze(vm);
    return config;
}

static JSValue constructProcessHrtimeObject(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    JSC::JSFunction* hrtime = JSC::JSFunction::create(vm, globalObject, 0, String("hrtime"_s), Process_functionHRTime, ImplementationVisibility::Public);

    JSC::JSFunction* hrtimeBigInt = JSC::JSFunction::create(vm, globalObject, 0, String("bigint"_s), Process_functionHRTimeBigInt, ImplementationVisibility::Public);

    hrtime->putDirect(vm, JSC::Identifier::fromString(vm, "bigint"_s), hrtimeBigInt);

    return hrtime;
}
enum class BunProcessStdinFdType : int32_t {
    file = 0,
    pipe = 1,
    socket = 2,
};
extern "C" BunProcessStdinFdType Bun__Process__getStdinFdType(void*, int fd);

extern "C" void Bun__ForceFileSinkToBeSynchronousForProcessObjectStdio(JSC::JSGlobalObject*, JSC::EncodedJSValue);
static JSValue constructStdioWriteStream(JSC::JSGlobalObject* globalObject, JSC::JSObject* processObject, int fd)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_CATCH_SCOPE(vm);

    JSC::JSFunction* getStdioWriteStream = JSC::JSFunction::create(vm, globalObject, processObjectInternalsGetStdioWriteStreamCodeGenerator(vm), globalObject);
    JSC::MarkedArgumentBuffer args;
    args.append(processObject);
    args.append(JSC::jsNumber(fd));
    args.append(jsBoolean(bun_stdio_tty[fd]));
    BunProcessStdinFdType fdType = Bun__Process__getStdinFdType(Bun::vm(vm), fd);
    args.append(jsNumber(static_cast<int32_t>(fdType)));

    JSC::CallData callData = JSC::getCallData(getStdioWriteStream);

    auto result = JSC::profiledCall(globalObject, ProfilingReason::API, getStdioWriteStream, callData, globalObject->globalThis(), args);
    if (auto* exception = scope.exception()) {
        Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
        scope.clearException();
        return jsUndefined();
    }

    ASSERT_WITH_MESSAGE(JSC::isJSArray(result), "Expected an array from getStdioWriteStream");
    JSC::JSArray* resultObject = JSC::jsCast<JSC::JSArray*>(result);

    // process.stdout and process.stderr differ from other Node.js streams in important ways:
    // 1. They are used internally by console.log() and console.error(), respectively.
    // 2. Writes may be synchronous depending on what the stream is connected to and whether the system is Windows or POSIX:
    // Files: synchronous on Windows and POSIX
    // TTYs (Terminals): asynchronous on Windows, synchronous on POSIX
    // Pipes (and sockets): synchronous on Windows, asynchronous on POSIX
    bool forceSync = false;
#if OS(WINDOWS)
    forceSync = fdType == BunProcessStdinFdType::file || fdType == BunProcessStdinFdType::pipe;
#else
    // Note: files are always sync anyway.
    // forceSync = fdType == BunProcessStdinFdType::file || bun_stdio_tty[fd];

    // TODO: once console.* is wired up to write/read through the same buffering mechanism as FileSink for process.stdout, process.stderr, we can make this non-blocking for sockets on POSIX.
    // Until then, we have to force it to be sync EVEN for sockets or else console.log() may flush at a different time than process.stdout.write.
    forceSync = true;
#endif
    if (forceSync) {
        Bun__ForceFileSinkToBeSynchronousForProcessObjectStdio(globalObject, JSValue::encode(resultObject->getIndex(globalObject, 1)));
    }

    return resultObject->getIndex(globalObject, 0);
}

static JSValue constructStdout(VM& vm, JSObject* processObject)
{
    return constructStdioWriteStream(processObject->globalObject(), processObject, 1);
}

static JSValue constructStderr(VM& vm, JSObject* processObject)
{
    return constructStdioWriteStream(processObject->globalObject(), processObject, 2);
}

#if OS(WINDOWS)
#define STDIN_FILENO 0
#endif

static JSValue constructStdin(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    auto scope = DECLARE_CATCH_SCOPE(vm);
    JSC::JSFunction* getStdinStream = JSC::JSFunction::create(vm, globalObject, processObjectInternalsGetStdinStreamCodeGenerator(vm), globalObject);
    JSC::MarkedArgumentBuffer args;
    args.append(processObject);
    args.append(JSC::jsNumber(STDIN_FILENO));
    args.append(jsBoolean(bun_stdio_tty[STDIN_FILENO]));
    BunProcessStdinFdType fdType = Bun__Process__getStdinFdType(Bun::vm(vm), STDIN_FILENO);
    args.append(jsNumber(static_cast<int32_t>(fdType)));
    JSC::CallData callData = JSC::getCallData(getStdinStream);

    auto result = JSC::profiledCall(globalObject, ProfilingReason::API, getStdinStream, callData, globalObject, args);
    if (auto* exception = scope.exception()) {
        Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
        scope.clearException();
        return jsUndefined();
    }
    return result;
}

static JSValue constructProcessSend(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    if (Bun__GlobalObject__hasIPC(globalObject)) {
        return JSC::JSFunction::create(vm, globalObject, 1, String("send"_s), Bun__Process__send, ImplementationVisibility::Public);
    } else {
        return jsUndefined();
    }
}

static JSValue constructProcessDisconnect(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    if (Bun__GlobalObject__hasIPC(globalObject)) {
        return JSC::JSFunction::create(vm, globalObject, 1, String("disconnect"_s), Bun__Process__disconnect, ImplementationVisibility::Public);
    } else {
        return jsUndefined();
    }
}

static JSValue constructProcessChannel(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    if (Bun__GlobalObject__hasIPC(globalObject)) {
        auto& vm = JSC::getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        JSC::JSFunction* getControl = JSC::JSFunction::create(vm, globalObject, processObjectInternalsGetChannelCodeGenerator(vm), globalObject);
        JSC::MarkedArgumentBuffer args;
        JSC::CallData callData = JSC::getCallData(getControl);

        auto result = JSC::profiledCall(globalObject, ProfilingReason::API, getControl, callData, globalObject->globalThis(), args);
        RETURN_IF_EXCEPTION(scope, {});
        return result;
    } else {
        return jsUndefined();
    }
}

#if OS(WINDOWS)
#define getpid _getpid
#endif

static JSValue constructPid(VM& vm, JSObject* processObject)
{
    return jsNumber(getpid());
}

static JSValue constructPpid(VM& vm, JSObject* processObject)
{
#if OS(WINDOWS)
    return jsNumber(uv_os_getppid());
#else
    return jsNumber(getppid());
#endif
}

static JSValue constructArgv0(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    return JSValue::decode(Bun__Process__createArgv0(globalObject));
}

static JSValue constructExecPath(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    return JSValue::decode(Bun__Process__getExecPath(globalObject));
}

// get from zig
extern "C" EncodedJSValue Bun__Process__getArgv(JSGlobalObject* lexicalGlobalObject)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* process = globalObject->processObject();
    if (!process) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(process->getArgv(globalObject));
}

// get from js

JSValue Process::getArgv(JSGlobalObject* globalObject)
{
    if (auto argv = m_argv.get()) {
        return argv;
    }

    JSValue argv = JSValue::decode(Bun__Process__createArgv(globalObject));
    setArgv(globalObject, argv);
    return argv;
}

void Process::setArgv(JSGlobalObject* globalObject, JSValue value)
{
    auto& vm = globalObject->vm();
    m_argv.set(vm, this, value);
}

extern "C" EncodedJSValue Bun__Process__getExecArgv(JSGlobalObject* lexicalGlobalObject)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* process = globalObject->processObject();
    if (!process) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(process->getExecArgv(globalObject));
}

JSValue Process::getExecArgv(JSGlobalObject* globalObject)
{
    if (auto argv = m_execArgv.get()) {
        return argv;
    }

    JSValue argv = JSValue::decode(Bun__Process__createExecArgv(globalObject));
    setExecArgv(globalObject, argv);
    return argv;
}

void Process::setExecArgv(JSGlobalObject* globalObject, JSValue value)
{
    auto& vm = globalObject->vm();
    m_execArgv.set(vm, this, value);
}

static JSValue constructBrowser(VM& vm, JSObject* processObject)
{
    return jsBoolean(false);
}

static JSValue constructVersion(VM& vm, JSObject* processObject)
{
    return JSC::jsString(vm, makeString("v"_s, ASCIILiteral::fromLiteralUnsafe(REPORTED_NODEJS_VERSION)));
}

static JSValue constructIsBun(VM& vm, JSObject* processObject)
{
    return jsBoolean(true);
}

static JSValue constructRevision(VM& vm, JSObject* processObject)
{
    return JSC::jsString(vm, makeAtomString(ASCIILiteral::fromLiteralUnsafe(Bun__version_sha)));
}

static JSValue constructEnv(VM& vm, JSObject* processObject)
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(processObject->globalObject());
    return globalObject->processEnvObject();
}

#if !OS(WINDOWS)

static JSValue maybe_uid_by_name(JSC::ThrowScope& throwScope, JSGlobalObject* globalObject, JSValue value)
{
    if (!value.isNumber() && !value.isString()) return JSValue::decode(Bun::ERR::INVALID_ARG_TYPE(throwScope, globalObject, "id"_s, "number or string"_s, value));
    if (!value.isString()) return value;

    auto str = value.getString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    auto utf8 = str.utf8();
    auto name = utf8.data();
    struct passwd pwd;
    struct passwd* pp = nullptr;
    char buf[8192];

    if (getpwnam_r(name, &pwd, buf, sizeof(buf), &pp) == 0 && pp != nullptr) {
        return jsNumber(pp->pw_uid);
    }

    auto message = makeString("User identifier does not exist: "_s, str);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_UNKNOWN_CREDENTIAL, message));
    return {};
}

static JSValue maybe_gid_by_name(JSC::ThrowScope& throwScope, JSGlobalObject* globalObject, JSValue value)
{
    if (!value.isNumber() && !value.isString()) return JSValue::decode(Bun::ERR::INVALID_ARG_TYPE(throwScope, globalObject, "id"_s, "number or string"_s, value));
    if (!value.isString()) return value;

    auto str = value.getString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    auto utf8 = str.utf8();
    auto name = utf8.data();
    struct group pwd;
    struct group* pp = nullptr;
    char buf[8192];

    if (getgrnam_r(name, &pwd, buf, sizeof(buf), &pp) == 0 && pp != nullptr) {
        return jsNumber(pp->gr_gid);
    }

    auto message = makeString("Group identifier does not exist: "_s, str);
    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_UNKNOWN_CREDENTIAL, message));
    return {};
}

#endif

extern "C" uint64_t Bun__Os__getFreeMemory(void);

#define PROCESS_BINDING_NOT_IMPLEMENTED_ISSUE(str, issue)                                                                                                                                                                                \
    {                                                                                                                                                                                                                                    \
        throwScope.throwException(globalObject, createError(globalObject, String("process.binding(\"" str "\") is not implemented in Bun. Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/" issue ""_s))); \
        return JSValue::encode(JSValue {});                                                                                                                                                                                              \
    }

#define PROCESS_BINDING_NOT_IMPLEMENTED(str)                                                                                                                                                                                            \
    {                                                                                                                                                                                                                                   \
        throwScope.throwException(globalObject, createError(globalObject, String("process.binding(\"" str "\") is not implemented in Bun. If that breaks something, please file an issue and include a reproducible code sample."_s))); \
        return JSValue::encode(JSValue {});                                                                                                                                                                                             \
    }

inline JSValue processBindingUtil(Zig::GlobalObject* globalObject, JSC::VM& vm)
{
    return globalObject->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::NodeUtilTypes);
}

inline JSValue processBindingConfig(Zig::GlobalObject* globalObject, JSC::VM& vm)
{
    auto config = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 9);
#ifdef BUN_DEBUG
    config->putDirect(vm, Identifier::fromString(vm, "isDebugBuild"_s), jsBoolean(true), 0);
#else
    config->putDirect(vm, Identifier::fromString(vm, "isDebugBuild"_s), jsBoolean(false), 0);
#endif
    config->putDirect(vm, Identifier::fromString(vm, "hasOpenSSL"_s), jsBoolean(true), 0);
    config->putDirect(vm, Identifier::fromString(vm, "fipsMode"_s), jsBoolean(true), 0);
    config->putDirect(vm, Identifier::fromString(vm, "hasIntl"_s), jsBoolean(true), 0);
    config->putDirect(vm, Identifier::fromString(vm, "hasTracing"_s), jsBoolean(true), 0);
    config->putDirect(vm, Identifier::fromString(vm, "hasNodeOptions"_s), jsBoolean(true), 0);
    config->putDirect(vm, Identifier::fromString(vm, "hasInspector"_s), jsBoolean(true), 0);
    config->putDirect(vm, Identifier::fromString(vm, "noBrowserGlobals"_s), jsBoolean(false), 0);
    config->putDirect(vm, Identifier::fromString(vm, "bits"_s), jsNumber(64), 0);
    return config;
}

JSValue createCryptoX509Object(JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto cryptoX509 = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 1);
    cryptoX509->putDirect(vm, JSC::Identifier::fromString(vm, "isX509Certificate"_s), JSC::JSFunction::create(vm, globalObject, 1, String("isX509Certificate"_s), jsIsX509Certificate, ImplementationVisibility::Public), 0);
    return cryptoX509;
}

template<typename Visitor>
void Process::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    Process* thisObject = jsCast<Process*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_uncaughtExceptionCaptureCallback);
    visitor.append(thisObject->m_nextTickFunction);
    visitor.append(thisObject->m_cachedCwd);
    visitor.append(thisObject->m_argv);
    visitor.append(thisObject->m_execArgv);

    thisObject->m_cpuUsageStructure.visit(visitor);
    thisObject->m_resourceUsageStructure.visit(visitor);
    thisObject->m_memoryUsageStructure.visit(visitor);
    thisObject->m_bindingUV.visit(visitor);
    thisObject->m_bindingNatives.visit(visitor);
    thisObject->m_emitHelperFunction.visit(visitor);
}

DEFINE_VISIT_CHILDREN(Process);

constexpr uint32_t cpuUsageStructureInlineCapacity = std::min<uint32_t>(JSFinalObject::maxInlineCapacity, std::max<uint32_t>(2, JSFinalObject::defaultInlineCapacity));

static Structure* constructCPUUsageStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    JSC::Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), cpuUsageStructureInlineCapacity);
    PropertyOffset offset;
    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "user"_s),
        0,
        offset);
    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "system"_s),
        0,
        offset);
    return structure;
}

constexpr uint32_t resourceUsageStructureInlineCapacity = std::min<uint32_t>(JSFinalObject::maxInlineCapacity, std::max<uint32_t>(16, JSFinalObject::defaultInlineCapacity));

static Structure* constructResourceUsageStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    JSC::Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), resourceUsageStructureInlineCapacity);
    PropertyOffset offset;
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "userCPUTime"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "systemCPUTime"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "maxRSS"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "sharedMemorySize"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "unsharedDataSize"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "unsharedStackSize"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "minorPageFault"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "majorPageFault"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "swappedOut"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "fsRead"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "fsWrite"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "ipcSent"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "ipcReceived"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "signalsCount"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "voluntaryContextSwitches"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "involuntaryContextSwitches"_s), 0, offset);
    return structure;
}

constexpr uint32_t memoryUsageStructureInlineCapacity = std::min<uint32_t>(JSFinalObject::maxInlineCapacity, std::max<uint32_t>(5, JSFinalObject::defaultInlineCapacity));

static Structure* constructMemoryUsageStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    JSC::Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), memoryUsageStructureInlineCapacity);
    PropertyOffset offset;
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "rss"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "heapTotal"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "heapUsed"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "external"_s), 0, offset);
    structure = structure->addPropertyTransition(vm, structure, JSC::Identifier::fromString(vm, "arrayBuffers"_s), 0, offset);
    return structure;
}

static Process* getProcessObject(JSC::JSGlobalObject* lexicalGlobalObject, JSValue thisValue)
{
    Process* process = jsDynamicCast<Process*>(thisValue);

    // Handle "var memoryUsage = process.memoryUsage; memoryUsage()"
    if (!process) [[unlikely]] {
        // Handle calling this function from inside a node:vm
        Zig::GlobalObject* zigGlobalObject = defaultGlobalObject(lexicalGlobalObject);

        return zigGlobalObject->processObject();
    }

    return process;
}

extern "C" int getRSS(size_t* rss)
{
#if defined(__APPLE__)
    mach_msg_type_number_t count;
    task_basic_info_data_t info;
    kern_return_t err;

    count = TASK_BASIC_INFO_COUNT;
    err = task_info(mach_task_self(),
        TASK_BASIC_INFO,
        reinterpret_cast<task_info_t>(&info),
        &count);

    if (err == KERN_SUCCESS) {
        *rss = (size_t)info.resident_size;
        return 0;
    }

    return -1;
#elif defined(__linux__)
    // Taken from libuv.
    char buf[1024];
    const char* s;
    ssize_t n;
    long val;
    int fd;
    int i;

    do
        fd = open("/proc/self/stat", O_RDONLY);
    while (fd == -1 && errno == EINTR);

    if (fd == -1)
        return errno;

    do
        n = read(fd, buf, sizeof(buf) - 1);
    while (n == -1 && errno == EINTR);

    int closeErrno = 0;
    do {
        closeErrno = close(fd);
    } while (closeErrno == -1 && errno == EINTR);

    if (n == -1)
        return errno;
    buf[n] = '\0';

    s = strchr(buf, ' ');
    if (s == NULL)
        goto err;

    s += 1;
    if (*s != '(')
        goto err;

    s = strchr(s, ')');
    if (s == NULL)
        goto err;

    for (i = 1; i <= 22; i++) {
        s = strchr(s + 1, ' ');
        if (s == NULL)
            goto err;
    }

    errno = 0;
    val = strtol(s, NULL, 10);
    if (errno != 0)
        goto err;
    if (val < 0)
        goto err;

    *rss = val * getpagesize();
    return 0;

err:
    return EINVAL;
#elif OS(WINDOWS)
    return uv_resident_set_memory(rss);
#else
#error "Unknown platform"
#endif
}

static JSValue Process_stubEmptyArray(VM& vm, JSObject* processObject)
{
    return JSC::constructEmptyArray(processObject->globalObject(), nullptr);
}

static JSValue Process_stubEmptySet(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    return JSSet::create(vm, globalObject->setStructure());
}

static JSValue constructMemoryUsage(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    JSC::JSFunction* memoryUsage = JSC::JSFunction::create(vm, globalObject, 0, String("memoryUsage"_s), Process_functionMemoryUsage, ImplementationVisibility::Public);

    JSC::JSFunction* rss = JSC::JSFunction::create(vm, globalObject, 0, String("rss"_s), Process_functionMemoryUsageRSS, ImplementationVisibility::Public);

    memoryUsage->putDirect(vm, JSC::Identifier::fromString(vm, "rss"_s), rss, 0);
    return memoryUsage;
}

void Process::queueNextTick(JSC::JSGlobalObject* globalObject, const ArgList& args)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue nextTick;
    if (!this->m_nextTickFunction) {
        nextTick = this->get(globalObject, Identifier::fromString(vm, "nextTick"_s));
        RETURN_IF_EXCEPTION(scope, void());
    }

    ASSERT(!args.isEmpty());
    JSObject* nextTickFn = this->m_nextTickFunction.get();
    if (!nextTickFn) [[unlikely]] {
        if (nextTick && nextTick.isObject())
            nextTickFn = asObject(nextTick);
        else {
            throwVMError(globalObject, scope, "Failed to call nextTick"_s);
            return;
        }
    }
    ASSERT_WITH_MESSAGE(!args.at(0).inherits<AsyncContextFrame>(), "queueNextTick must not pass an AsyncContextFrame. This will cause a crash.");
    JSC::call(globalObject, nextTickFn, args, "Failed to call nextTick"_s);
    RELEASE_AND_RETURN(scope, void());
}

void Process::queueNextTick(JSC::JSGlobalObject* globalObject, JSValue value)
{
    ASSERT_WITH_MESSAGE(value.isCallable(), "Must be a function for us to call");
    MarkedArgumentBuffer args;
    if (!value.isEmpty())
        args.append(value);
    this->queueNextTick(globalObject, args);
}

void Process::queueNextTick(JSC::JSGlobalObject* globalObject, JSValue value, JSValue arg1)
{
    ASSERT_WITH_MESSAGE(value.isCallable(), "Must be a function for us to call");
    MarkedArgumentBuffer args;
    if (!value.isEmpty()) {
        args.append(value);
        if (!arg1.isEmpty()) {
            args.append(arg1);
        }
    }
    this->queueNextTick(globalObject, args);
}

template<size_t NumArgs>
void Process::queueNextTick(JSC::JSGlobalObject* globalObject, JSValue func, const JSValue (&args)[NumArgs])
{
    ASSERT_WITH_MESSAGE(func.isCallable() || func.inherits<AsyncContextFrame>(), "Must be a function for us to call");
    MarkedArgumentBuffer argsBuffer;
    argsBuffer.ensureCapacity(NumArgs + 1);
    if (!func.isEmpty()) {
        argsBuffer.append(func);
        for (size_t i = 0; i < NumArgs; i++) {
            argsBuffer.append(args[i]);
        }
    }
    this->queueNextTick(globalObject, argsBuffer);
}

void Process::emitOnNextTick(Zig::GlobalObject* globalObject, ASCIILiteral eventName, JSValue event)
{
    auto& vm = getVM(globalObject);
    auto* function = m_emitHelperFunction.getInitializedOnMainThread(this);
    JSValue args[] = { jsString(vm, String(eventName)), event };
    queueNextTick(globalObject, function, args);
}

extern "C" void Bun__Process__queueNextTick1(GlobalObject* globalObject, EncodedJSValue func, EncodedJSValue arg1)
{
    auto process = globalObject->processObject();
    JSValue function = JSValue::decode(func);

    process->queueNextTick(globalObject, function, JSValue::decode(arg1));
}
extern "C" void Bun__Process__queueNextTick2(GlobalObject* globalObject, EncodedJSValue func, EncodedJSValue arg1, EncodedJSValue arg2)
{
    auto process = globalObject->processObject();
    JSValue function = JSValue::decode(func);

    process->queueNextTick<2>(globalObject, function, { JSValue::decode(arg1), JSValue::decode(arg2) });
}

// This does the equivalent of
// return require.cache.get(Bun.main)
static JSValue constructMainModuleProperty(VM& vm, JSObject* processObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(processObject->globalObject());
    auto* bun = globalObject->bunObject();
    RETURN_IF_EXCEPTION(scope, {});
    auto& builtinNames = Bun::builtinNames(vm);
    JSValue mainValue = bun->get(globalObject, builtinNames.mainPublicName());
    RETURN_IF_EXCEPTION(scope, {});
    auto* requireMap = globalObject->requireMap();
    RETURN_IF_EXCEPTION(scope, {});
    JSValue mainModule = requireMap->get(globalObject, mainValue);
    RETURN_IF_EXCEPTION(scope, {});
    return mainModule;
}

JSValue Process::constructNextTickFn(JSC::VM& vm, Zig::GlobalObject* globalObject)
{
    JSNextTickQueue* nextTickQueueObject;
    if (!globalObject->m_nextTickQueue) {
        nextTickQueueObject = JSNextTickQueue::create(globalObject);
        globalObject->m_nextTickQueue.set(vm, globalObject, nextTickQueueObject);
    } else {
        nextTickQueueObject = globalObject->m_nextTickQueue.get();
    }

    JSC::JSFunction* initializer = JSC::JSFunction::create(vm, globalObject, processObjectInternalsInitializeNextTickQueueCodeGenerator(vm), globalObject);

    JSC::MarkedArgumentBuffer args;
    args.append(this);
    args.append(nextTickQueueObject);
    args.append(JSC::JSFunction::create(vm, globalObject, 1, String(), jsFunctionDrainMicrotaskQueue, ImplementationVisibility::Private));
    args.append(JSC::JSFunction::create(vm, globalObject, 1, String(), jsFunctionReportUncaughtException, ImplementationVisibility::Private));

    JSValue nextTickFunction = JSC::profiledCall(globalObject, ProfilingReason::API, initializer, JSC::getCallData(initializer), globalObject->globalThis(), args);
    if (nextTickFunction && nextTickFunction.isObject()) {
        this->m_nextTickFunction.set(vm, this, nextTickFunction.getObject());
    }

    return nextTickFunction;
}

static JSValue constructProcessNextTickFn(VM& vm, JSObject* processObject)
{
    JSGlobalObject* lexicalGlobalObject = processObject->globalObject();
    Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    return jsCast<Process*>(processObject)->constructNextTickFn(JSC::getVM(globalObject), globalObject);
}

static JSValue constructFeatures(VM& vm, JSObject* processObject)
{
    // {
    //     inspector: true,
    //     debug: false,
    //     uv: true,
    //     ipv6: true,
    //     tls_alpn: true,
    //     tls_sni: true,
    //     tls_ocsp: true,
    //     tls: true,
    //     cached_builtins: [Getter]
    // }
    auto* globalObject = processObject->globalObject();
    auto* object = constructEmptyObject(globalObject);

    object->putDirect(vm, Identifier::fromString(vm, "inspector"_s), jsBoolean(true));
#ifdef BUN_DEBUG
    object->putDirect(vm, Identifier::fromString(vm, "debug"_s), jsBoolean(true));
#else
    object->putDirect(vm, Identifier::fromString(vm, "debug"_s), jsBoolean(false));
#endif
    // lying
    object->putDirect(vm, Identifier::fromString(vm, "uv"_s), jsBoolean(true));

    object->putDirect(vm, Identifier::fromString(vm, "ipv6"_s), jsBoolean(true));
    object->putDirect(vm, Identifier::fromString(vm, "tls_alpn"_s), jsBoolean(true));
    object->putDirect(vm, Identifier::fromString(vm, "tls_sni"_s), jsBoolean(true));
    object->putDirect(vm, Identifier::fromString(vm, "tls_ocsp"_s), jsBoolean(true));
    object->putDirect(vm, Identifier::fromString(vm, "tls"_s), jsBoolean(true));
    object->putDirect(vm, Identifier::fromString(vm, "cached_builtins"_s), jsBoolean(true));
    object->putDirect(vm, Identifier::fromString(vm, "openssl_is_boringssl"_s), jsBoolean(true));
    object->putDirect(vm, Identifier::fromString(vm, "require_module"_s), jsBoolean(true));
    object->putDirect(vm, Identifier::fromString(vm, "typescript"_s), jsString(vm, String("transform"_s)));

    return object;
}

static inline JSValue getCachedCwd(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/bootstrap/switches/does_own_process_state.js#L142-L146
    auto* processObject = defaultGlobalObject(globalObject)->processObject();
    if (auto* cached = processObject->cachedCwd()) {
        return cached;
    }

    auto cwd = Bun__Process__getCwd(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSString* cwdStr = jsCast<JSString*>(JSValue::decode(cwd));
    processObject->setCachedCwd(vm, cwdStr);
    RELEASE_AND_RETURN(scope, cwdStr);
}

extern "C" EncodedJSValue Process__getCachedCwd(JSC::JSGlobalObject* globalObject)
{
    return JSValue::encode(getCachedCwd(globalObject));
}

extern "C" void Process__emitMessageEvent(Zig::GlobalObject* global, EncodedJSValue value, EncodedJSValue handle)
{
    auto* process = global->processObject();
    auto& vm = JSC::getVM(global);

    auto ident = vm.propertyNames->message;
    if (process->wrapped().hasEventListeners(ident)) {
        JSC::MarkedArgumentBuffer args;
        args.append(JSValue::decode(value));
        args.append(JSValue::decode(handle));
        process->wrapped().emit(ident, args);
    }
}

extern "C" void Process__emitDisconnectEvent(Zig::GlobalObject* global)
{
    auto* process = global->processObject();
    auto& vm = JSC::getVM(global);
    auto ident = Identifier::fromString(vm, "disconnect"_s);
    if (process->wrapped().hasEventListeners(ident)) {
        JSC::MarkedArgumentBuffer args;
        process->wrapped().emit(ident, args);
    }
}

extern "C" void Process__emitErrorEvent(Zig::GlobalObject* global, EncodedJSValue value)
{
    auto* process = global->processObject();
    auto& vm = JSC::getVM(global);
    if (process->wrapped().hasEventListeners(vm.propertyNames->error)) {
        JSC::MarkedArgumentBuffer args;
        args.append(JSValue::decode(value));
        process->wrapped().emit(vm.propertyNames->error, args);
    }
}

/* Source for Process.lut.h
@begin processObjectTable
  _debugEnd                        Process_stubEmptyFunction                           Function 0
  _debugProcess                    Process_stubEmptyFunction                           Function 0
  _eval                            processGetEval                                      CustomAccessor
  _fatalException                  Process_stubEmptyFunction                           Function 1
  _getActiveHandles                Process_stubFunctionReturningArray                  Function 0
  _getActiveRequests               Process_stubFunctionReturningArray                  Function 0
  _kill                            Process_functionReallyKill                          Function 2
  _linkedBinding                   Process_stubEmptyFunction                           Function 0
  _preload_modules                 Process_stubEmptyArray                              PropertyCallback
  _rawDebug                        Process_stubEmptyFunction                           Function 0
  _startProfilerIdleNotifier       Process_stubEmptyFunction                           Function 0
  _stopProfilerIdleNotifier        Process_stubEmptyFunction                           Function 0
  _tickCallback                    Process_stubEmptyFunction                           Function 0
  abort                            Process_functionAbort                               Function 1
  allowedNodeEnvironmentFlags      Process_stubEmptySet                                PropertyCallback
  arch                             constructArch                                       PropertyCallback
  argv                             processArgv                                         CustomAccessor
  argv0                            constructArgv0                                      PropertyCallback
  assert                           Process_functionAssert                              Function 1
  availableMemory                  Process_availableMemory                             Function 0
  binding                          Process_functionBinding                             Function 1
  browser                          constructBrowser                                    PropertyCallback
  channel                          constructProcessChannel                             PropertyCallback
  chdir                            Process_functionChdir                               Function 1
  config                           constructProcessConfigObject                        PropertyCallback
  connected                        processConnected                                    CustomAccessor
  constrainedMemory                Process_functionConstrainedMemory                   Function 0
  cpuUsage                         Process_functionCpuUsage                            Function 1
  cwd                              Process_functionCwd                                 Function 1
  debugPort                        processDebugPort                                    CustomAccessor
  disconnect                       constructProcessDisconnect                          PropertyCallback
  dlopen                           Process_functionDlopen                              Function 1
  emitWarning                      Process_emitWarning                                 Function 1
  env                              constructEnv                                        PropertyCallback
  execArgv                         processExecArgv                                     CustomAccessor
  execPath                         constructExecPath                                   PropertyCallback
  exit                             Process_functionExit                                Function 1
  exitCode                         processExitCode                                     CustomAccessor|DontDelete
  features                         constructFeatures                                   PropertyCallback
  getActiveResourcesInfo           Process_stubFunctionReturningArray                  Function 0
  getBuiltinModule                 Process_functionLoadBuiltinModule                   Function 1
  hasUncaughtExceptionCaptureCallback Process_hasUncaughtExceptionCaptureCallback      Function 0
  hrtime                           constructProcessHrtimeObject                        PropertyCallback
  isBun                            constructIsBun                                      PropertyCallback
  kill                             Process_functionKill                                Function 2
  mainModule                       constructMainModuleProperty                         PropertyCallback
  memoryUsage                      constructMemoryUsage                                PropertyCallback
  moduleLoadList                   Process_stubEmptyArray                              PropertyCallback
  nextTick                         constructProcessNextTickFn                          PropertyCallback
  noDeprecation                    processNoDeprecation                                CustomAccessor
  openStdin                        Process_functionOpenStdin                           Function 0
  pid                              constructPid                                        PropertyCallback
  platform                         constructPlatform                                   PropertyCallback
  ppid                             constructPpid                                       PropertyCallback
  reallyExit                       Process_functionReallyExit                          Function 1
  ref                              Process_ref                                         Function 1
  release                          constructProcessReleaseObject                       PropertyCallback
  report                           constructProcessReportObject                        PropertyCallback
  resourceUsage                    Process_functionResourceUsage                       Function 0
  revision                         constructRevision                                   PropertyCallback
  send                             constructProcessSend                                PropertyCallback
  setSourceMapsEnabled             Process_setSourceMapsEnabled                           Function 1
  setUncaughtExceptionCaptureCallback Process_setUncaughtExceptionCaptureCallback      Function 1
  stderr                           constructStderr                                     PropertyCallback
  stdin                            constructStdin                                      PropertyCallback
  stdout                           constructStdout                                     PropertyCallback
  throwDeprecation                 processThrowDeprecation                             CustomAccessor
  title                            processTitle                                        CustomAccessor
  umask                            Process_functionUmask                               Function 1
  unref                            Process_unref                                       Function 1
  uptime                           Process_functionUptime                              Function 1
  version                          constructVersion                                    PropertyCallback
  versions                         constructVersions                                   PropertyCallback

#if !OS(WINDOWS)
  getegid                          Process_functiongetegid                             Function 0
  geteuid                          Process_functiongeteuid                             Function 0
  getgid                           Process_functiongetgid                              Function 0
  getgroups                        Process_functiongetgroups                           Function 0
  getuid                           Process_functiongetuid                              Function 0

  setegid                          Process_functionsetegid                             Function 1
  seteuid                          Process_functionseteuid                             Function 1
  setgid                           Process_functionsetgid                              Function 1
  setgroups                        Process_functionsetgroups                           Function 1
  setuid                           Process_functionsetuid                              Function 1
#endif
@end
*/
#include "BunProcess.lut.h"

const JSC::ClassInfo Process::s_info
    = { "Process"_s, &Base::s_info, &processObjectTable, nullptr,
          CREATE_METHOD_TABLE(Process) };

void Process::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);

    wrapped().onDidChangeListener = &onDidChangeListeners;

    m_cpuUsageStructure.initLater([](const JSC::LazyProperty<Process, JSC::Structure>::Initializer& init) {
        init.set(constructCPUUsageStructure(init.vm, init.owner->globalObject()));
    });

    m_resourceUsageStructure.initLater([](const JSC::LazyProperty<Process, JSC::Structure>::Initializer& init) {
        init.set(constructResourceUsageStructure(init.vm, init.owner->globalObject()));
    });

    m_memoryUsageStructure.initLater([](const JSC::LazyProperty<Process, JSC::Structure>::Initializer& init) {
        init.set(constructMemoryUsageStructure(init.vm, init.owner->globalObject()));
    });

    m_bindingUV.initLater([](const JSC::LazyProperty<Process, JSC::JSObject>::Initializer& init) {
        init.set(Bun::ProcessBindingUV::create(init.vm, init.owner->globalObject()));
    });
    m_bindingNatives.initLater([](const JSC::LazyProperty<Process, JSC::JSObject>::Initializer& init) {
        init.set(Bun::ProcessBindingNatives::create(init.vm, ProcessBindingNatives::createStructure(init.vm, init.owner->globalObject())));
    });
    m_emitHelperFunction.initLater([](const JSC::LazyProperty<Process, JSFunction>::Initializer& init) {
        init.set(JSFunction::create(init.vm, init.owner->globalObject(), 2, "emit"_s, Process_functionEmitHelper, ImplementationVisibility::Private));
    });

    putDirect(vm, vm.propertyNames->toStringTagSymbol, jsString(vm, String("process"_s)), 0);
    putDirect(vm, Identifier::fromString(vm, "_exiting"_s), jsBoolean(false), 0);
}

} // namespace Bun
