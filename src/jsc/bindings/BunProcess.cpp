#include "ModuleLoader.h"
#include "napi.h"

#include "BunProcess.h"
#include "DLHandleMap.h"
#include "WebCoreJSBuiltins.h"
#include "v8/node.h"

// Include the CMake-generated dependency versions header
#include "bun_dependency_versions.h"
#include <node_version.h>
#include <wtf/Scope.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSMicrotask.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/NumberPrototype.h>
#include "JSCommonJSModule.h"
#include "ErrorCode+List.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/TopExceptionScope.h"
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
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include "wtf-bindings.h"
#include "EventLoopTask.h"
#include "JSEventListener.h"
#include <JavaScriptCore/StructureCache.h>

#include <webcore/SerializedScriptValue.h>
#include "ProcessBindingTTYWrap.h"
#include "wtf/Threading.h"
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
#include <fcntl.h>
#include <signal.h>
#include <sys/resource.h>
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

#if OS(DARWIN)
#include <unicode/uversion.h>
#endif

#pragma mark - Node.js Process

#if defined(__APPLE__)
#include <mach/mach.h>
#include <mach/mach_time.h>
#include <spawn.h>
#endif

#if defined(__linux__) || defined(__FreeBSD__)
#include <sys/resource.h>
#include <sys/time.h>
#include <sys/stat.h>
#include <fcntl.h>
#endif

#if defined(__FreeBSD__)
#include <sys/types.h>
#include <sys/sysctl.h>
#include <sys/user.h>
#endif

#if !defined(_MSC_VER)
#include <unistd.h> // setuid, getuid
#endif

#include <cstring>
#include "ErrorStackTrace.h"
extern "C" bool Bun__Node__ProcessNoDeprecation;
extern "C" bool Bun__Node__ProcessNoWarnings;
extern "C" bool Bun__Node__ProcessTraceWarnings;
extern "C" bool Bun__Node__ProcessTraceDeprecation;
extern "C" bool Bun__Node__ProcessPendingDeprecation;
extern "C" BunString Bun__Node__getRedirectWarnings();
extern "C" size_t Bun__Node__getDisabledWarnings(const uint8_t** bufs, size_t* lens, size_t cap);
extern "C" bool Bun__getEnvValue(JSC::JSGlobalObject* globalObject, const EncodedSlice* name, EncodedSlice* value);
extern "C" bool Bun__Node__ProcessThrowDeprecation;
extern "C" bool Bun__Node__ProcessPendingDeprecation;
extern "C" void Bun__writeProfilesBeforeSelfKill();
extern "C" int32_t bun_stdio_tty[3];

namespace Bun {

// Out-of-line so the many cold object builders below (process.report,
// process.config, ...) don't each inline Identifier creation + putDirect.
NEVER_INLINE void putDirectNamed(JSC::VM& vm, JSC::JSObject* object, ASCIILiteral name, JSC::JSValue value)
{
    object->putDirect(vm, JSC::Identifier::fromString(vm, name), value, 0);
}

using namespace JSC;

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
extern "C" void Bun__setExitCode(void*, uint8_t);
extern "C" void Bun__closeChildIPC(JSGlobalObject*);

extern "C" bool Bun__GlobalObject__connectedIPC(JSGlobalObject*);
extern "C" bool Bun__GlobalObject__hasIPC(JSGlobalObject*);
extern "C" void Bun__ensureProcessIPCInitialized(JSGlobalObject*);
extern "C" const char* Bun__githubURL;
extern "C" const char* Bun__sqlite3_version();
BUN_DECLARE_HOST_FUNCTION(Bun__Process__send);

extern "C" void Process__emitDisconnectEvent(Zig::GlobalObject* global);
extern "C" void Process__emitErrorEvent(Zig::GlobalObject* global, EncodedJSValue value);

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
#elif defined(__ANDROID__)
    return JSC::jsString(vm, makeAtomString("android"_s));
#elif defined(__linux__)
    return JSC::jsString(vm, makeAtomString("linux"_s));
#elif defined(__FreeBSD__)
    return JSC::jsString(vm, makeAtomString("freebsd"_s));
#elif OS(WINDOWS)
    return JSC::jsString(vm, makeAtomString("win32"_s));
#else
#error "Unknown platform"
#endif
}

// macOS links the system libicucore dynamically, so the compile-time U_ICU_VERSION can be newer than what actually runs.
static inline String icuVersionString()
{
#if OS(DARWIN)
    UVersionInfo version;
    char buf[U_MAX_VERSION_STRING_LENGTH];
    u_getVersion(version);
    u_versionToString(version, buf);
    return String::fromLatin1(buf);
#else
    return String(U_ICU_VERSION ""_s);
#endif
}

static inline String unicodeVersionString()
{
#if OS(DARWIN)
    UVersionInfo version;
    char buf[U_MAX_VERSION_STRING_LENGTH];
    u_getUnicodeVersion(version);
    u_versionToString(version, buf);
    return String::fromLatin1(buf);
#else
    return String(U_UNICODE_VERSION ""_s);
#endif
}

static JSValue constructVersions(VM& vm, JSObject* processObject)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* globalObject = processObject->globalObject();
    JSC::JSObject* object = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 24);
    RETURN_IF_EXCEPTION(scope, {});

    putDirectNamed(vm, object, "node"_s, JSC::jsOwnedString(vm, makeAtomString(ASCIILiteral::fromLiteralUnsafe(REPORTED_NODEJS_VERSION))));
    putDirectNamed(vm, object, "bun"_s, JSC::jsOwnedString(vm, String(ASCIILiteral::fromLiteralUnsafe(Bun__version)).substring(1)));

    struct VersionEntry {
        const char* name;
        const char* version;
    };
    // Use CMake-generated versions
    static constexpr VersionEntry versions[] = {
        { "boringssl", BUN_VERSION_BORINGSSL },
        // https://github.com/oven-sh/bun/issues/7921
        // BoringSSL is a fork of OpenSSL 1.1.0, so we can report OpenSSL 1.1.0
        { "openssl", "1.1.0" },
        // keep in sync with src/jsc/bindings/node/http/llhttp/README.md
        { "llhttp", "9.3.0" },
        { "libarchive", BUN_VERSION_LIBARCHIVE },
        { "mimalloc", BUN_VERSION_MIMALLOC },
        { "picohttpparser", BUN_VERSION_PICOHTTPPARSER },
        { "uwebsockets", BUN_VERSION_UWS },
        { "webkit", BUN_VERSION_WEBKIT },
        { "zig", BUN_VERSION_ZIG },
        // Use commit hash for zlib to match test expectations
        { "zlib", BUN_VERSION_ZLIB_HASH },
        { "tinycc", BUN_VERSION_TINYCC },
        { "lolhtml", BUN_VERSION_LOLHTML },
        { "ares", BUN_VERSION_C_ARES },
        // Use commit hash for libdeflate to match test expectations
        { "libdeflate", BUN_VERSION_LIBDEFLATE_HASH },
        { "usockets", BUN_VERSION_USOCKETS },
        { "lshpack", BUN_VERSION_LSHPACK },
        // Use commit hash for zstd (semantic version extraction not working yet)
        { "zstd", BUN_VERSION_ZSTD_HASH },
        { "v8", REPORTED_NODEJS_V8_VERSION },
#if !OS(WINDOWS)
        { "uv", "1.48.0" },
#endif
    };
    auto putVersion = [&](const char* name, String&& version) {
        object->putDirect(vm, JSC::Identifier::fromString(vm, ASCIILiteral::fromLiteralUnsafe(name)), JSC::jsOwnedString(vm, version), 0);
    };
    for (auto& entry : versions)
        putVersion(entry.name, String(ASCIILiteral::fromLiteralUnsafe(entry.version)));
#if OS(WINDOWS)
    putDirectNamed(vm, object, "uv"_s, JSValue(JSC::jsOwnedString(vm, String::fromLatin1(uv_version_string()))));
#endif
#define STRINGIFY_IMPL(x) #x
#define STRINGIFY(x) STRINGIFY_IMPL(x)
    putVersion("napi", STRINGIFY(NODE_API_SUPPORTED_VERSION_MAX) ""_s);
    putVersion("icu", icuVersionString());
    putVersion("unicode", unicodeVersionString());
    putVersion("sqlite", String::fromLatin1(Bun__sqlite3_version()));
    putVersion("modules", STRINGIFY(REPORTED_NODEJS_ABI_VERSION) ""_s);
#undef STRINGIFY
#undef STRINGIFY_IMPL

    return object;
}

static JSValue constructProcessReleaseObject(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* release = JSC::constructEmptyObject(globalObject);

    release->putDirect(vm, vm.propertyNames->name, jsOwnedString(vm, String("node"_s)), 0); // maybe this should be 'bun' eventually
    putDirectNamed(vm, release, "sourceUrl"_s, jsOwnedString(vm, WTF::String(std::span { Bun__githubURL, strlen(Bun__githubURL) })));
    putDirectNamed(vm, release, "headersUrl"_s, jsOwnedString(vm, String("https://nodejs.org/download/release/v" REPORTED_NODEJS_VERSION "/node-v" REPORTED_NODEJS_VERSION "-headers.tar.gz"_s)));

    RETURN_IF_EXCEPTION(scope, {});
    return release;
}

static void dispatchExitInternal(JSC::JSGlobalObject* globalObject, Process* process, int exitCode)
{
    if (process->m_isExiting)
        return;
    process->m_isExiting = true;
    auto& emitter = process->wrapped();
    auto& vm = JSC::getVM(globalObject);

    if (vm.hasTerminationRequest() || vm.hasExceptionsAfterHandlingTraps())
        return;

    putDirectNamed(vm, process, "_exiting"_s, jsBoolean(true));
    auto event = Identifier::fromString(vm, "exit"_s);
    if (!emitter.hasEventListeners(event)) {
        return;
    }

    MarkedArgumentBuffer arguments;
    arguments.append(jsNumber(exitCode));
    emitter.emit(event, arguments);
}

JSC_DEFINE_CUSTOM_SETTER(Process_defaultSetter, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    auto& vm = JSC::getVM(globalObject);

    JSC::JSObject* thisObject = dynamicDowncast<JSC::JSObject>(JSValue::decode(thisValue));
    if (value)
        thisObject->putDirect(vm, propertyName, JSValue::decode(value), 0);

    return true;
}

extern "C" BunString Bun__resolveEmbeddedNodeFile(const BunString*);
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

extern "C" void CrashHandler__setDlOpenAction(const char* action);
extern "C" bool Bun__VM__allowAddons(void* vm);
extern "C" int32_t Bun__addonNeedsGlibcOnMusl(const char* path, size_t len, char* soname_out, size_t soname_cap);

JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(Process_functionDlopen, __attribute__((minsize)), (JSC::JSGlobalObject * globalObject_, JSC::CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(globalObject_);
    auto callCountAtStart = globalObject->napiModuleRegisterCallCount;
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    auto& vm = JSC::getVM(globalObject);

    if (!Bun__VM__allowAddons(globalObject->bunVM())) {
        return ERR::DLOPEN_DISABLED(scope, globalObject, "Cannot load native addon because loading addons is disabled."_s);
    }

    auto argCount = callFrame->argumentCount();
    if (argCount < 2) {
        JSC::throwTypeError(globalObject, scope, "dlopen requires 2 arguments"_s);
        return {};
    }

    JSC::JSValue moduleValue = callFrame->uncheckedArgument(0);
    JSC::JSObject* moduleObject = dynamicDowncast<JSC::JSObject>(moduleValue);
    if (!moduleObject) [[unlikely]] {
        JSC::throwTypeError(globalObject, scope, "dlopen requires an object as first argument"_s);
        return {};
    }

    JSValue exports = moduleObject->getIfPropertyExists(globalObject, builtinNames(vm).exportsPublicName());
    RETURN_IF_EXCEPTION(scope, {});

    if (!exports) [[unlikely]] {
        JSC::throwTypeError(globalObject, scope, "dlopen requires an object with an exports property"_s);
        return {};
    }

    globalObject->m_pendingNapiModuleAndExports[0].set(vm, globalObject, moduleObject);
    globalObject->m_pendingNapiModuleAndExports[1].set(vm, globalObject, exports);

    Strong<JSC::Unknown> strongExports;

    if (exports.isCell()) {
        strongExports = { vm, exports.asCell() };
    }

    Strong<JSC::JSObject> strongModule = { vm, moduleObject };

    WTF::String filename = callFrame->uncheckedArgument(1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (filename.isEmpty()) {
        JSC::throwTypeError(globalObject, scope, "dlopen requires a non-empty string as the second argument"_s);
        return {};
    }

    if (filename.startsWith("file://"_s)) {
        WTF::URL fileURL = WTF::URL(filename);
        if (!fileURL.isValid() || !fileURL.protocolIsFile()) {
            JSC::throwTypeError(globalObject, scope, "invalid file: URL passed to dlopen"_s);
            return {};
        }

        filename = fileURL.fileSystemPath();
    }

    CString utf8;

    // Support embedded .node files
    // See src/standalone_graph/StandaloneModuleGraph.rs for what this "$bunfs" thing is
#if OS(WINDOWS)
#define StandaloneModuleGraph__base_path "B:/~BUN/"_s
#else
#define StandaloneModuleGraph__base_path "/$bunfs/"_s
#endif
    [[maybe_unused]] bool fromEmbedded = false;
    if (filename.startsWith(StandaloneModuleGraph__base_path)) {
        BunString bunStr = Bun::toString(filename);
        BunString resolved = Bun__resolveEmbeddedNodeFile(&bunStr);
        if (!resolved.isDead()) {
            filename = resolved.transferToWTFString();
            // The extracted file is content-hashed and shared across dlopens
            // and restarts (#29587), so it is never deleted here.
            fromEmbedded = true;
        }
    }

    RETURN_IF_EXCEPTION(scope, {});

    // Handle known yet-to-be-working in Bun
    {
        static constexpr ASCIILiteral better_sqlite3_node = "better_sqlite3.node"_s;
        static constexpr ASCIILiteral better_sqlite3_message = "'better-sqlite3' is not yet supported in Bun.\nTrack the status in https://github.com/oven-sh/bun/issues/4290\nIn the meantime, you could try bun:sqlite which has a similar API."_s;
        if (filename.endsWith(better_sqlite3_node)) {
            return throwError(globalObject, scope, ErrorCode::ERR_DLOPEN_FAILED,
                better_sqlite3_message);
        }
    }

    {
        auto utf8_filename = filename.tryGetUTF8(ConversionMode::LenientConversion);
        if (!utf8_filename) [[unlikely]] {
            JSC::throwTypeError(globalObject, scope, "process.dlopen requires a valid UTF-8 string for the filename"_s);
            return {};
        }
        utf8 = *utf8_filename;
    }

    Bun__process_dlopen_count++;

#if OS(WINDOWS)
    BunString filename_str = Bun::toString(filename);
    HMODULE handle = Bun__LoadLibraryBunString(&filename_str);
#else
#if OS(LINUX)
    // A glibc-linked addon loaded into a musl process segfaults inside the
    // loader (gcompat provides the soname but not the ABI). Inspect the ELF
    // DT_NEEDED list first so the user sees a catchable error instead of a
    // crash report. Skipped for addons embedded via `bun build --compile`.
    // See https://github.com/oven-sh/bun/issues/15753.
    if (!fromEmbedded) {
        char soname[64] = { 0 };
        if (Bun__addonNeedsGlibcOnMusl(utf8.data(), utf8.length(), soname, sizeof(soname))) [[unlikely]] {
            WTF::StringBuilder msg;
            msg.append(filename);
            msg.append(" is linked against glibc (DT_NEEDED "_s);
            msg.append(WTF::StringView::fromLatin1(soname));
            msg.append("), but this Bun build uses musl. glibc-targeted native addons cannot be loaded on Alpine/musl even with gcompat. Use a glibc-based image (e.g. oven/bun:debian) or install a musl build of this addon."_s);
            return throwError(globalObject, scope, ErrorCode::ERR_DLOPEN_FAILED, msg.toString());
        }
    }
#endif
    CrashHandler__setDlOpenAction(utf8.data());
    void* handle = dlopen(utf8.data(), RTLD_LAZY);
    CrashHandler__setDlOpenAction(nullptr);
#endif

    globalObject->m_pendingNapiModuleDlopenHandle = handle;

    if (!handle) {
#if OS(WINDOWS)
        DWORD errorId = GetLastError();
        LPWSTR messageBuffer = nullptr;
        DWORD charCount = FormatMessageW(
            FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS | FORMAT_MESSAGE_MAX_WIDTH_MASK, // Prevents automatic line breaks
            NULL, // No source needed when using FORMAT_MESSAGE_FROM_SYSTEM
            errorId,
            MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT), // Default language
            (LPWSTR)&messageBuffer, // Buffer will be allocated by the function
            0, // Minimum size to allocate - 0 means "determine size automatically"
            NULL // No arguments since we're using FORMAT_MESSAGE_IGNORE_INSERTS
        );

        WTF::StringBuilder errorBuilder;
        errorBuilder.append("LoadLibrary failed: "_s);
        if (messageBuffer && charCount > 0) {
            // Trim trailing whitespace, carriage returns, and newlines that FormatMessageW often includes
            while (charCount > 0 && (messageBuffer[charCount - 1] == L'\r' || messageBuffer[charCount - 1] == L'\n' || messageBuffer[charCount - 1] == L' '))
                charCount--;

            errorBuilder.append(WTF::StringView(messageBuffer, charCount, false));
        } else {
            errorBuilder.append("error code "_s);
            errorBuilder.append(WTF::String::number(errorId));
        }

        WTF::String msg = errorBuilder.toString();
        if (messageBuffer)
            LocalFree(messageBuffer); // Free the buffer allocated by FormatMessageW
#else
        WTF::String msg = WTF::String::fromUTF8(dlerror());
#endif
        return throwError(globalObject, scope, ErrorCode::ERR_DLOPEN_FAILED, msg);
    }

    if (callCountAtStart != globalObject->napiModuleRegisterCallCount) {
        // Module self-registered via static constructor(s).
        // Move pending registrations into locals before iterating: an
        // nm_register_func can itself call napi_module_register(), which
        // appends to m_pendingNapiModules. Appending to a WTF::Vector while
        // range-for iterating it reallocates the buffer and leaves the
        // iterator dangling.
        auto pendingNapiModules = std::exchange(globalObject->m_pendingNapiModules, {});
        auto pendingV8Modules = std::exchange(globalObject->m_pendingV8Modules, {});
        // Whatever happens below, no registration state may leak into the next dlopen().
        auto resetPendingRegistrations = WTF::makeScopeExit([&] {
            globalObject->m_pendingV8Modules.clear();
            globalObject->m_pendingNapiModules.clear();
            globalObject->napiModuleRegisterCallCount = 0;
            globalObject->m_pendingNapiModuleAndExports[0].clear();
            globalObject->m_pendingNapiModuleAndExports[1].clear();
        });

        if (handle) {
            // Save all NAPI module registrations
            for (auto& mod : pendingNapiModules) {
                auto* heapModule = new napi_module(mod);
                Bun::DLHandleMap::singleton().add(handle, heapModule);
            }

            // Save all V8 C++ module registrations
            for (auto* mod : pendingV8Modules) {
                Bun::DLHandleMap::singleton().add(handle, mod);
            }
        }

        // A V8-style module's nm_register_func already ran inside dlopen() (node_module_register)
        // and may have thrown.
        RETURN_IF_EXCEPTION(scope, {});

        // Execute all NAPI modules. If an nm_register_func registers more
        // modules re-entrantly, they accumulate back in m_pendingNapiModules;
        // drain those too once the current batch is done.
        for (;;) {
            for (auto& mod : pendingNapiModules) {
                // Restore dlopen handle for this module before execution
                // executePendingNapiModule clears it, so we must set it for each module
                globalObject->m_pendingNapiModuleDlopenHandle = handle;
                globalObject->m_pendingNapiModule = mod;
                Napi::executePendingNapiModule(globalObject);
                globalObject->m_pendingNapiModule = {};
                RETURN_IF_EXCEPTION(scope, {});
            }
            if (globalObject->m_pendingNapiModules.isEmpty())
                break;
            pendingNapiModules = std::exchange(globalObject->m_pendingNapiModules, {});
        }

        JSValue resultValue = globalObject->m_pendingNapiModuleAndExports[0].get();
        if (resultValue && resultValue != strongModule.get()) {
            if (resultValue.isCell() && resultValue.getObject()->isErrorInstance()) {
                JSC::throwException(globalObject, scope, resultValue);
                return {};
            }
        }

        return JSValue::encode(jsUndefined());
    }

    // Module didn't self-register on this load. Check if we have cached registrations.
    if (auto cachedModules = Bun::DLHandleMap::singleton().get(handle)) {
        // (The V8 registrations are already in DLHandleMap; nothing here re-saves them.)
        auto resetPendingRegistrations = WTF::makeScopeExit([&] {
            globalObject->m_pendingV8Modules.clear();
            globalObject->m_pendingNapiModules.clear();
            globalObject->napiModuleRegisterCallCount = 0;
            globalObject->m_pendingNapiModuleAndExports[0].clear();
            globalObject->m_pendingNapiModuleAndExports[1].clear();
        });

        // Replay all registrations from this handle. napi ones only queue into
        // m_pendingNapiModules; a V8 one runs its nm_register_func right here.
        for (auto& registration : *cachedModules) {
            if (auto* const* nodeModule = std::get_if<node::node_module*>(&registration)) {
                node::node_module_register(*nodeModule);
                RETURN_IF_EXCEPTION(scope, {});
            } else {
                napi_module_register(std::get<napi_module*>(registration));
            }
        }

        // Execute all NAPI modules that were just registered. Move to a
        // local first and drain so re-entrant napi_module_register() calls
        // from inside nm_register_func can't invalidate our iterator.
        while (!globalObject->m_pendingNapiModules.isEmpty()) {
            auto pendingNapiModules = std::exchange(globalObject->m_pendingNapiModules, {});
            for (auto& mod : pendingNapiModules) {
                // Restore dlopen handle for this module before execution
                // executePendingNapiModule clears it, so we must set it for each module
                globalObject->m_pendingNapiModuleDlopenHandle = handle;
                globalObject->m_pendingNapiModule = mod;
                Napi::executePendingNapiModule(globalObject);
                globalObject->m_pendingNapiModule = {};
                RETURN_IF_EXCEPTION(scope, {});
            }
        }

        JSValue resultValue = globalObject->m_pendingNapiModuleAndExports[0].get();
        if (resultValue && resultValue != strongModule.get()) {
            if (resultValue.isCell() && resultValue.getObject()->isErrorInstance()) {
                JSC::throwException(globalObject, scope, resultValue);
                return {};
            }
        }

        return JSValue::encode(jsUndefined());
    }

#if OS(WINDOWS)
#define dlsym GetProcAddress
#endif

    // TODO(@190n) look for node_register_module_vXYZ according to BuildOptions.reported_nodejs_version
    // and the table at https://github.com/nodejs/node/blob/main/doc/abi_version_registry.json
    auto napi_register_module_v1 = reinterpret_cast<napi_value (*)(napi_env, napi_value)>(dlsym(handle, "napi_register_module_v1"));

    auto node_api_module_get_api_version_v1 = reinterpret_cast<int32_t (*)()>(dlsym(handle, "node_api_module_get_api_version_v1"));

#if OS(WINDOWS)
#undef dlsym
#endif

    if (!napi_register_module_v1) {
#if OS(WINDOWS)
        FreeLibrary(handle);
#else
        dlclose(handle);
#endif

        if (!scope.exception()) [[likely]] {
            JSC::throwTypeError(globalObject, scope, "symbol 'napi_register_module_v1' not found in native module. Is this a Node API (napi) module?"_s);
        }
        return {};
    }

    // TODO(@heimskr): get the API version without node_api_module_get_api_version_v1 a different way
    int module_version = 8;
    if (node_api_module_get_api_version_v1) {
        module_version = node_api_module_get_api_version_v1();
    }

    NapiHandleScope handleScope(globalObject);

    EncodedJSValue exportsValue = JSC::JSValue::encode(exports);

    char* filename_cstr = toFileURI(utf8.span());

    napi_module nmodule {
        .nm_version = module_version,
        .nm_flags = 0,
        .nm_filename = filename_cstr,
        .nm_register_func = nullptr,
        .nm_modname = "[no modname]",
        .nm_priv = nullptr,
        .reserved = {},
    };

    static_assert(sizeof(napi_value) == sizeof(EncodedJSValue), "EncodedJSValue must be reinterpretable as a pointer");

    auto env = globalObject->makeNapiEnv(nmodule);
    env->filename = filename_cstr;

    auto encoded = reinterpret_cast<EncodedJSValue>(napi_register_module_v1(env.ptr(), reinterpret_cast<napi_value>(exportsValue)));
    env->throwPendingException();
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue resultValue = encoded == 0 ? exports : JSValue::decode(encoded);

    if (auto resultObject = resultValue.getObject()) {
#if OS(DARWIN) || OS(LINUX) || OS(FREEBSD)
        // If this is a native bundler plugin we want to store the handle from dlopen
        // as we are going to call `dlsym()` on it later to get the plugin implementation.
        const char** pointer_to_plugin_name = (const char**)dlsym(handle, "BUN_PLUGIN_NAME");
#elif OS(WINDOWS)
        const char** pointer_to_plugin_name = (const char**)GetProcAddress(handle, "BUN_PLUGIN_NAME");
#endif
        if (pointer_to_plugin_name) {
            // TODO: think about the finalizer here
            // currently we do not dealloc napi modules so we don't have to worry about it right now
            auto* meta = new Bun::NapiModuleMeta(globalObject->m_pendingNapiModuleDlopenHandle);
            Bun::NapiExternal* napi_external = Bun::NapiExternal::create(vm, globalObject->NapiExternalStructure(), meta, nullptr, nullptr, env.ptr());
            bool success = resultObject->putDirect(vm, WebCore::builtinNames(vm).napiDlopenHandlePrivateName(), napi_external, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
            ASSERT(success);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    globalObject->m_pendingNapiModuleAndExports[0].clear();
    globalObject->m_pendingNapiModuleAndExports[1].clear();
    globalObject->m_pendingNapiModuleDlopenHandle = nullptr;

    // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/src/node_api.cc#L734-L742
    // https://github.com/oven-sh/bun/issues/1288
    if (!resultValue.isEmpty() && (!strongExports || resultValue != strongExports.get())) {
        PutPropertySlot slot(strongModule.get(), false);
        strongModule->put(strongModule.get(), globalObject, builtinNames(vm).exportsPublicName(), resultValue, slot);
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSValue::encode(resultValue);
}

JSC_DEFINE_HOST_FUNCTION(Process_functionUmask, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    if (callFrame->argumentCount() == 0 || callFrame->argument(0).isUndefined()) {
        mode_t currentMask = umask(0);
        umask(currentMask);
        return JSValue::encode(jsNumber(currentMask));
    }

    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto value = callFrame->argument(0);

    mode_t newUmask;
    if (value.isString()) {
        auto str = value.getString(globalObject);
        RETURN_IF_EXCEPTION(throwScope, {});
        auto policy = WTF::TrailingJunkPolicy::Disallow;
        auto opt = str.is8Bit() ? WTF::parseInteger<mode_t, uint8_t>(str.span8(), 8, policy) : WTF::parseInteger<mode_t, char16_t>(str.span16(), 8, policy);
        if (!opt.has_value()) return Bun::ERR::INVALID_ARG_VALUE(throwScope, globalObject, "mask"_s, value, "must be a 32-bit unsigned integer or an octal string"_s);
        newUmask = opt.value();
    } else {
        Bun::V::validateUint32(throwScope, globalObject, value, "mask"_s, jsUndefined());
        RETURN_IF_EXCEPTION(throwScope, {});
        newUmask = JSC::toUInt32(value.asNumber());
    }

    return JSC::JSValue::encode(JSC::jsNumber(umask(newUmask)));
}

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
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* process = globalObject->processObject();
    MarkedArgumentBuffer arguments;
    arguments.append(jsNumber(exitCode));
    Bun__VirtualMachine__exitDuringUncaughtException(bunVM(vm));
    auto fired = process->wrapped().emit(Identifier::fromString(vm, "beforeExit"_s), arguments);
    RETURN_IF_EXCEPTION(scope, );
    if (fired) {
        if (globalObject->m_nextTickQueue) {
            auto nextTickQueue = globalObject->m_nextTickQueue.get();
            nextTickQueue->drain(vm, globalObject);
            RETURN_IF_EXCEPTION(scope, );
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

JSC_DEFINE_HOST_FUNCTION(Process_functionUptime, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    double now = static_cast<double>(Bun__readOriginTimer(bunVM(lexicalGlobalObject)));
    double result = (now / 1000000.0) / 1000.0;
    return JSC::JSValue::encode(JSC::jsNumber(result));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionExit, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* zigGlobal = defaultGlobalObject(globalObject);
    auto process = zigGlobal->processObject();

    auto code = callFrame->argument(0);

    setProcessExitCodeInner(globalObject, process, code);
    RETURN_IF_EXCEPTION(throwScope, {});

    Process__dispatchOnExit(zigGlobal, Bun__getExitCode(bunVM(zigGlobal)));
    RETURN_IF_EXCEPTION(throwScope, {});

    // process.reallyExit(process.exitCode) — re-read: an 'exit' listener may have set it.
    auto reallyExitVal = process->get(globalObject, Identifier::fromString(vm, "reallyExit"_s));
    RETURN_IF_EXCEPTION(throwScope, {});
    MarkedArgumentBuffer args;
    args.append(jsNumber(Bun__getExitCode(bunVM(zigGlobal))));
    JSC::call(globalObject, reallyExitVal, args, ""_s);
    RETURN_IF_EXCEPTION(throwScope, {});

    return JSC::JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(Process_setUncaughtExceptionCaptureCallback, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto* globalObject = static_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto arg0 = callFrame->argument(0);
    auto process = globalObject->processObject();

    if (arg0.isNull()) {
        process->setUncaughtExceptionCaptureCallback(arg0);
        process->m_reportOnUncaughtException = false;
        return JSC::JSValue::encode(jsUndefined());
    }
    if (!arg0.isCallable()) {
        return Bun::ERR::INVALID_ARG_TYPE(throwScope, globalObject, "fn"_s, "function or null"_s, arg0);
    }
    if (process->m_reportOnUncaughtException) {
        return Bun::ERR::UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET(throwScope, globalObject);
    }

    process->setUncaughtExceptionCaptureCallback(arg0);
    process->m_reportOnUncaughtException = true;
    return JSC::JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(Process_hasUncaughtExceptionCaptureCallback, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* zigGlobal = defaultGlobalObject(globalObject);
    JSValue cb = zigGlobal->processObject()->getUncaughtExceptionCaptureCallback();
    if (cb.isEmpty() || !cb.isCell()) {
        return JSValue::encode(jsBoolean(false));
    }

    return JSValue::encode(jsBoolean(true));
}

extern "C" uint64_t Bun__readOriginTimer(void*);

JSC_DEFINE_HOST_FUNCTION(Process_functionHRTime, (JSC::JSGlobalObject * globalObject_, JSC::CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(globalObject_);
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    uint64_t time = Bun__readOriginTimer(globalObject->bunVM());
    double seconds = static_cast<double>(time / 1000000000);
    double nanoseconds = static_cast<double>(time % 1000000000);

    auto arg0 = callFrame->argument(0);
    if (callFrame->argumentCount() > 0 && !arg0.isUndefined()) {
        JSArray* relativeArray = dynamicDowncast<JSC::JSArray>(arg0);
        if (!relativeArray) {
            return Bun::ERR::INVALID_ARG_INSTANCE(throwScope, globalObject, "time"_s, "Array"_s, arg0);
        }
        if (relativeArray->length() != 2) return Bun::ERR::OUT_OF_RANGE(throwScope, globalObject_, "time"_s, "2"_s, jsNumber(relativeArray->length()));

        JSValue relativeSecondsValue = relativeArray->getIndex(globalObject, 0);
        RETURN_IF_EXCEPTION(throwScope, {});
        JSValue relativeNanosecondsValue = relativeArray->getIndex(globalObject, 1);
        RETURN_IF_EXCEPTION(throwScope, {});

        // Node subtracts the tuple in JS, so the elements go through ToNumber and
        // non-numeric ones propagate NaN rather than reaching an int64 conversion.
        double relativeSeconds = relativeSecondsValue.toNumber(globalObject);
        RETURN_IF_EXCEPTION(throwScope, {});
        double relativeNanoseconds = relativeNanosecondsValue.toNumber(globalObject);
        RETURN_IF_EXCEPTION(throwScope, {});

        bool needsBorrow = nanoseconds < relativeNanoseconds;
        seconds = needsBorrow ? seconds - relativeSeconds - 1 : seconds - relativeSeconds;
        nanoseconds = needsBorrow ? nanoseconds + 1000000000 - relativeNanoseconds : nanoseconds - relativeNanoseconds;
    }

    JSC::JSArray* array = nullptr;
    {
        JSC::ObjectInitializationScope initializationScope(vm);
        if ((array = JSC::JSArray::tryCreateUninitializedRestricted(
                 initializationScope, nullptr,
                 globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
                 2))) {

            array->initializeIndex(initializationScope, 0, JSC::jsNumber(seconds));
            array->initializeIndex(initializationScope, 1, JSC::jsNumber(nanoseconds));
        }
    }

    if (!array) [[unlikely]] {
        JSC::throwOutOfMemoryError(globalObject, throwScope);
        return {};
    }

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(array));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionHRTimeBigInt, (JSC::JSGlobalObject * globalObject_, JSC::CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(globalObject_);
    return JSC::JSValue::encode(JSValue(JSC::JSBigInt::createFrom(globalObject, Bun__readOriginTimer(globalObject->bunVM()))));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionChdir, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto value = callFrame->argument(0);
    Bun::V::validateString(scope, globalObject, value, "directory"_s);
    RETURN_IF_EXCEPTION(scope, {});

    WTF::String directory = value.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    EncodedSlice str = Zig::toEncodedSlice(directory);
    JSC::JSValue result = JSC::JSValue::decode(Bun__Process__setCwd(globalObject, &str));
    RETURN_IF_EXCEPTION(scope, {});

    auto* processObject = defaultGlobalObject(globalObject)->processObject();
    // Node clears its cwd cache on chdir (does_own_process_state.js) and lets
    // the next process.cwd() re-query the OS - do not re-populate it here.
    processObject->clearCachedCwd();
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(result));
}

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
        MAKE_STATIC_STRING_IMPL("SIGBREAK"),
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
        // libuv-supported console-control signals on Windows:
        // CTRL_C_EVENT → SIGINT, CTRL_BREAK_EVENT → SIGBREAK,
        // CTRL_CLOSE_EVENT → SIGHUP, plus SIGWINCH on console resize.
        signalNameToNumberMap->add(signalNames[0], SIGHUP);
        signalNameToNumberMap->add(signalNames[1], SIGINT);
        signalNameToNumberMap->add(signalNames[2], SIGQUIT);
        signalNameToNumberMap->add(signalNames[9], SIGKILL);
        signalNameToNumberMap->add(signalNames[15], SIGTERM);
        signalNameToNumberMap->add(signalNames[27], SIGWINCH);
        signalNameToNumberMap->add(signalNames[31], SIGBREAK);
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

static void loadSignalNumberToNameMap()
{
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
#ifdef SIGBREAK
        signalNumberToNameMap->add(SIGBREAK, signalNames[31]);
#endif
    });
}

extern "C" bool Bun__onSignalForJS(int signalNumber, Zig::GlobalObject* globalObject)
{
    Process* process = globalObject->processObject();

    loadSignalNumberToNameMap();
    auto entry = signalNumberToNameMap->find(signalNumber);
    // Identifier::fromString dereferences the null String of a missing key.
    if (entry == signalNumberToNameMap->end()) [[unlikely]]
        return false;
    const String& signalName = entry->value;
    Identifier signalNameIdentifier = Identifier::fromString(JSC::getVM(globalObject), signalName);
    MarkedArgumentBuffer args;
    args.append(jsString(JSC::getVM(globalObject), signalNameIdentifier.string()));
    args.append(jsNumber(signalNumber));

    return process->wrapped().emitForBindings(signalNameIdentifier, args);
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
    // uv_signal_t callbacks fire on the uv_run thread (JS thread), but defer to avoid
    // re-entering JS from inside the libuv poll loop
    context->postTaskConcurrently([signalNumber](ScriptExecutionContext& context) {
        Bun__onSignalForJS(signalNumber, uncheckedDowncast<Zig::GlobalObject>(context.jsGlobalObject()));
    });
#else

#endif
};

extern "C" void Bun__logUnhandledException(JSC::EncodedJSValue exception);

extern "C" int Bun__handleUncaughtException(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue exception, int isRejection)
{
    if (!lexicalGlobalObject->inherits(Zig::GlobalObject::info()))
        return false;
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto* process = globalObject->processObject();
    auto& wrapped = process->wrapped();
    auto& vm = JSC::getVM(globalObject);
    if (vm.hasPendingTerminationException()) [[unlikely]]
        return true;

    // Node exits with code 6 (InvalidFatalExceptionMonkeyPatching) when process._fatalException
    // is replaced with a non-callable. Top exception scope: no caller declares a ThrowScope
    // around this call (Rust FFI and Process_functionFatalException).
    {
        auto fatalScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        JSValue fatalException = process->get(globalObject, Identifier::fromString(vm, "_fatalException"_s));
        if (fatalScope.exception()) [[unlikely]] {
            (void)fatalScope.tryClearException();
            if (vm.hasPendingTerminationException()) [[unlikely]]
                return true;
        } else if (!fatalException.isCallable()) {
            Bun__Process__exit(globalObject, 6);
            // Bun__Process__exit returns in a worker (only requests termination); don't
            // fall through to the emit logic and report handled so exit code is preserved.
            return true;
        }
    }

    MarkedArgumentBuffer args;
    args.append(exception);
    if (isRejection) {
        args.append(jsString(vm, String("unhandledRejection"_s)));
    } else {
        args.append(jsString(vm, String("uncaughtException"_s)));
    }

    auto uncaughtExceptionMonitor = Identifier::fromString(JSC::getVM(globalObject), "uncaughtExceptionMonitor"_s);
    if (wrapped.listenerCount(uncaughtExceptionMonitor) > 0) {
        auto monitorScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        wrapped.emit(uncaughtExceptionMonitor, args);
        RETURN_IF_EXCEPTION(monitorScope, true);
    }

    auto uncaughtExceptionIdent = Identifier::fromString(JSC::getVM(globalObject), "uncaughtException"_s);

    // if there is an uncaughtExceptionCaptureCallback, call it and consider the exception handled
    auto capture = process->getUncaughtExceptionCaptureCallback();
    if (!capture.isEmpty() && !capture.isUndefinedOrNull()) {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        (void)call(lexicalGlobalObject, capture, args, "uncaughtExceptionCaptureCallback"_s);
        if (auto ex = scope.exception()) {
            (void)scope.tryClearException();
            if (vm.hasPendingTerminationException()) [[unlikely]]
                return true;
            // if an exception is thrown in the uncaughtException handler, we abort
            Bun__logUnhandledException(JSValue::encode(JSValue(ex)));
            Bun__Process__exit(lexicalGlobalObject, 1);
        }
    } else if (wrapped.listenerCount(uncaughtExceptionIdent) > 0) {
        auto emitScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        wrapped.emit(uncaughtExceptionIdent, args);
        RETURN_IF_EXCEPTION(emitScope, true);
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
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    if (vm.hasPendingTerminationException()) [[unlikely]]
        return;
    auto warning = JSC::createError(globalObject, "Unhandled promise rejection. This error originated either by "
                                                  "throwing inside of an async function without a catch block, "
                                                  "or by rejecting a promise which was not handled with .catch(). "
                                                  "To terminate the bun process on unhandled promise "
                                                  "rejection, use the CLI flag `--unhandled-rejections=strict`."_s);
    warning->putDirect(vm, vm.propertyNames->name, jsString(vm, "UnhandledPromiseRejectionWarning"_str), JSC::PropertyAttribute::DontEnum | 0);

    JSValue reasonStack {};
    auto is_errorlike = Bun__promises__isErrorLike(globalObject, JSValue::decode(reason));
    CLEAR_IF_EXCEPTION(scope);
    if (vm.hasPendingTerminationException()) [[unlikely]]
        return;
    if (is_errorlike) {
        reasonStack = JSValue::decode(reason).get(globalObject, vm.propertyNames->stack);
        CLEAR_IF_EXCEPTION(scope);
        if (vm.hasPendingTerminationException()) [[unlikely]]
            return;
        warning->putDirect(vm, vm.propertyNames->stack, reasonStack);
    }
    if (!reasonStack) {
        reasonStack = JSValue::decode(Bun__noSideEffectsToString(vm, globalObject, reason));
        CLEAR_IF_EXCEPTION(scope);
        if (vm.hasPendingTerminationException()) [[unlikely]]
            return;
    }
    if (!reasonStack) reasonStack = jsUndefined();

    Process::emitWarning(globalObject, reasonStack, jsString(globalObject->vm(), "UnhandledPromiseRejectionWarning"_str), jsUndefined(), jsUndefined());
    CLEAR_IF_EXCEPTION(scope);
    if (vm.hasPendingTerminationException()) [[unlikely]]
        return;
    Process::emitWarningErrorInstance(globalObject, warning);
    CLEAR_IF_EXCEPTION(scope);
}

extern "C" int Bun__handleUnhandledRejection(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue reason, JSC::JSValue promise)
{
    if (!lexicalGlobalObject->inherits(Zig::GlobalObject::info()))
        return false;
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    if (vm.hasPendingTerminationException()) [[unlikely]]
        return true;
    auto* process = globalObject->processObject();

    auto eventType = Identifier::fromString(vm, "unhandledRejection"_s);
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
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    if (!lexicalGlobalObject->inherits(Zig::GlobalObject::info()))
        return false;
    if (vm.hasPendingTerminationException()) [[unlikely]]
        return true;
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto* process = globalObject->processObject();

    auto eventType = Identifier::fromString(vm, "rejectionHandled"_s);

    if (Bun__VM__allowRejectionHandledWarning(globalObject->bunVM())) {
        Process::emitWarning(globalObject, jsString(vm, String("Promise rejection was handled asynchronously"_s)), jsString(vm, String("PromiseRejectionHandledWarning"_s)), jsUndefined(), jsUndefined());
        CLEAR_IF_EXCEPTION(scope);
        if (vm.hasPendingTerminationException()) [[unlikely]]
            return true;
    }
    auto& wrapped = process->wrapped();
    if (wrapped.listenerCount(eventType) > 0) {
        MarkedArgumentBuffer args;
        args.append(promise);
        wrapped.emit(eventType, args);
        RETURN_IF_EXCEPTION(scope, true);
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
extern "C" void Bun__onSignalListenerCountChanged(int signalNumber, int listenerCount);

__attribute__((noinline)) static void forwardSignal(int signalNumber)
{
    // We want a function that's equivalent to Bun__onPosixSignal but whose address is different.
    // This is so that we can be sure not to uninstall signal handlers that we didn't install here.
    Bun__onPosixSignal(signalNumber);
}

// `bun run --watch` keeps this signal's handler installed for the process
// lifetime (node's watcher process owns SIGINT the same way), so the
// listener-removal path below must never restore SIG_DFL for it.
static int watchModeStickySignal = 0;

#if !OS(WINDOWS)
static void installForwardSignalHandler(int signalNumber)
{
    struct sigaction action;
    memset(&action, 0, sizeof(struct sigaction));
    action.sa_handler = forwardSignal;
    sigemptyset(&action.sa_mask);
    sigaddset(&action.sa_mask, signalNumber);
    action.sa_flags = SA_RESTART;
    sigaction(signalNumber, &action, nullptr);
}

extern "C" void Bun__installWatchModeSignalHandler(int signalNumber)
{
    Bun__ensureSignalHandler();
    watchModeStickySignal = signalNumber;
    installForwardSignalHandler(signalNumber);
}
#endif

extern "C" void Bun__MemoryPressure__install(JSC::JSGlobalObject* global);
extern "C" void Bun__MemoryPressure__uninstall(JSC::JSGlobalObject* global);

static void onDidChangeListeners(EventEmitter& eventEmitter, const Identifier& eventName, bool isAdded)
{
    if (Bun__isMainThreadVM()) {
        if (eventName == "memoryPressure") {
            auto* global = eventEmitter.scriptExecutionContext()->jsGlobalObject();
            if (isAdded) {
                if (eventEmitter.listenerCount(eventName) == 1) {
                    Bun__MemoryPressure__install(global);
                }
            } else if (eventEmitter.listenerCount(eventName) == 0) {
                Bun__MemoryPressure__uninstall(global);
            }
            return;
        }

        // IPC handlers
        if (eventName == "message" || eventName == "disconnect") {
            auto* global = uncheckedDowncast<GlobalObject>(eventEmitter.scriptExecutionContext()->jsGlobalObject());
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
        loadSignalNumberToNameMap();

        if (!signalToContextIdsMap) {
            signalToContextIdsMap = new HashMap<int, SignalHandleValue>();
        }

        if (auto signalNumber = signalNameToNumberMap->get(eventName.string())) {
            int listenerCount = eventEmitter.listenerCount(eventName);
            // Mirror the count for the watcher thread's --watch-kill-signal check.
            Bun__onSignalListenerCountChanged(signalNumber, listenerCount);
#if OS(LINUX)
            // SIGKILL and SIGSTOP cannot be handled, and JSC needs its own signal handler to
            // suspend and resume the JS thread which we must not override.
            if (signalNumber != SIGKILL && signalNumber != SIGSTOP && signalNumber != g_wtfConfig.sigThreadSuspendResume) {
#elif OS(DARWIN) || OS(FREEBSD)
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
                        installForwardSignalHandler(signalNumber);
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
                    if (signalToContextIdsMap->find(signalNumber) != signalToContextIdsMap->end() && listenerCount == 0) {
                        // The watch-mode sticky signal keeps its OS handler installed; only the
                        // handler teardown is skipped. The map entry is still removed — it is the
                        // "has JS listeners" source of truth that e.g. self-kill flush consults.
                        if (signalNumber != watchModeStickySignal) {
#if !OS(WINDOWS)
                            if (void (*oldHandler)(int) = signal(signalNumber, SIG_DFL); oldHandler != forwardSignal) {
                                // Don't uninstall the old handler if it's not the one we installed.
                                signal(signalNumber, oldHandler);
                            }
#else
                            SignalHandleValue signal_handle = signalToContextIdsMap->get(signalNumber);
                            Bun__UVSignalHandle__close(signal_handle.handle);
#endif
                        }
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

JSObject* Process::ensureOnWarning(Zig::GlobalObject* globalObject)
{
    if (auto* onWarning = m_onWarning.get())
        return onWarning;
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* factory = JSC::JSFunction::create(vm, globalObject, processObjectInternalsCreateOnWarningCodeGenerator(vm), globalObject);
    JSC::MarkedArgumentBuffer args;
    args.append(this);
    // --redirect-warnings, then NODE_REDIRECT_WARNINGS.
    JSValue redirectPath = jsUndefined();
    BunString redirect = Bun__Node__getRedirectWarnings();
    if (!redirect.isDead()) {
        redirectPath = jsString(vm, redirect.transferToWTFString());
    } else {
        EncodedSlice name = toEncodedSlice("NODE_REDIRECT_WARNINGS"_s);
        EncodedSlice value = { nullptr, 0 };
        if (Bun__getEnvValue(globalObject, &name, &value) && value.len > 0)
            redirectPath = jsString(vm, Zig::toStringCopy(value));
    }
    args.append(redirectPath);
    // --disable-warning entries as a JS array (write-once at CLI parse), so
    // onWarning builds a Set once instead of an FFI + utf8() + mutex per emit.
    JSValue disabled = jsUndefined();
    size_t nDisabled = Bun__Node__getDisabledWarnings(nullptr, nullptr, 0);
    if (nDisabled > 0) {
        Vector<const uint8_t*, 8> bufs;
        Vector<size_t, 8> lens;
        bufs.grow(nDisabled);
        lens.grow(nDisabled);
        Bun__Node__getDisabledWarnings(bufs.begin(), lens.begin(), nDisabled);
        auto* array = JSC::constructEmptyArray(globalObject, nullptr, static_cast<unsigned>(nDisabled));
        RETURN_IF_EXCEPTION(scope, nullptr);
        for (size_t i = 0; i < nDisabled; i++) {
            array->putDirectIndex(globalObject, static_cast<unsigned>(i),
                jsString(vm, WTF::String::fromUTF8(std::span { bufs[i], lens[i] })));
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
        disabled = array;
    }
    args.append(disabled);
    JSValue onWarning = JSC::profiledCall(globalObject, ProfilingReason::API, factory, JSC::getCallData(factory), jsUndefined(), args);
    RETURN_IF_EXCEPTION(scope, nullptr);
    m_onWarning.set(vm, this, asObject(onWarning));
    return asObject(onWarning);
}

JSC_DEFINE_HOST_FUNCTION(Process_functionDefaultOnWarning, (JSC::JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // The emitter invokes with the process it was registered on (setThisObject below);
    // fall back for a listener plucked out of listeners('warning') and called bare.
    auto* process = dynamicDowncast<Process>(callFrame->thisValue());
    if (!process)
        process = defaultGlobalObject(lexicalGlobalObject)->processObject();
    auto* globalObject = defaultGlobalObject(process->globalObject());
    auto* onWarning = process->ensureOnWarning(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::MarkedArgumentBuffer args;
    args.append(callFrame->argument(0));
    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::profiledCall(globalObject, ProfilingReason::API, onWarning, JSC::getCallData(onWarning), process, args)));
}

// Node registers its printer as an ordinary 'warning' listener during bootstrap
// (lib/internal/process/pre_execution.js setupWarningHandler), so user code observes
// listenerCount('warning') === 1 and removeAllListeners('warning') silences it. Only this
// stub is registered up front; the printer behind it is built on the first warning.
void Process::installDefaultWarningListener(JSC::VM& vm)
{
    if (Bun__NODE_NO_WARNINGS() || Bun__Node__ProcessNoWarnings)
        return;
    auto* globalObject = defaultGlobalObject(this->globalObject());
    auto* onWarning = JSFunction::create(vm, globalObject, 1, "onWarning"_s, Process_functionDefaultOnWarning, ImplementationVisibility::Public);
    wrapped().addListener(builtinNames(vm).warningPublicName(), WebCore::JSEventListener::create(*onWarning, *this, false, globalObject->world()), false, false);
    // The listener map holds the function weakly and is only marked through this object.
    vm.writeBarrier(this, onWarning);
    wrapped().setThisObject(this);
}

// Node's doEmitWarning: process.emit('warning', warning). The default print is a real
// 'warning' listener (onWarning), so filtering/trace/property reads live in JS like Node.
JSC_DEFINE_HOST_FUNCTION(jsFunction_emitWarning, (JSC::JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* process = globalObject->processObject();
    auto value = callFrame->argument(0);

    auto ident = builtinNames(vm).warningPublicName();
    JSC::MarkedArgumentBuffer args;
    args.append(value);
    process->wrapped().emit(ident, args);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

static JSValue constructRawDebug(VM& vm, JSObject* processObject)
{
    auto* globalObject = defaultGlobalObject(processObject->globalObject());
    return JSC::JSFunction::create(vm, globalObject, processObjectInternalsRawDebugCodeGenerator(vm), globalObject);
}

static JSValue constructLoadEnvFile(VM& vm, JSObject* processObject)
{
    auto* globalObject = defaultGlobalObject(processObject->globalObject());
    return JSC::JSFunction::create(vm, globalObject, processObjectInternalsLoadEnvFileCodeGenerator(vm), globalObject);
}

// TopExceptionScope, not ThrowScope: JSC checks a failed builder with vm.exceptionForInspection().
static JSValue callLazyProcessBuilder(VM& vm, JSC::JSGlobalObject* globalObject, JSC::FunctionExecutable* (*generator)(VM&), const JSC::ArgList& args)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* function = JSC::JSFunction::create(vm, globalObject, generator(vm), globalObject);
    auto result = JSC::profiledCall(globalObject, ProfilingReason::API, function, JSC::getCallData(function), globalObject->globalThis(), args);
    RETURN_IF_EXCEPTION(scope, {});
    return result;
}

static JSValue constructFinalization(VM& vm, JSObject* processObject)
{
    auto* globalObject = defaultGlobalObject(processObject->globalObject());
    JSC::MarkedArgumentBuffer args;
    args.append(processObject);
    return callLazyProcessBuilder(vm, globalObject, processObjectInternalsCreateProcessFinalizationCodeGenerator, JSC::ArgList(args));
}

static JSValue constructAllowedNodeEnvironmentFlags(VM& vm, JSObject* processObject)
{
    auto* globalObject = defaultGlobalObject(processObject->globalObject());
    return callLazyProcessBuilder(vm, globalObject, processObjectInternalsBuildAllowedNodeEnvironmentFlagsCodeGenerator, JSC::ArgList());
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_throwValue, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto value = callFrame->argument(0);
    scope.throwException(globalObject, value);
    return {};
}

#if !OS(WINDOWS)
static void restoreDefaultSignalDisposition(int signalNumber)
{
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = SIG_DFL;
    sigemptyset(&sa.sa_mask);
    sigaction(signalNumber, &sa, nullptr);
}
#endif

JSC_DEFINE_HOST_FUNCTION(Process_functionAbort, (JSGlobalObject * globalObject, CallFrame*))
{
#if OS(WINDOWS)
    // Raising SIGABRT is handled in the CRT in windows, calling _exit() with ambiguous code "3" by default.
    // This adjustment to the abort behavior gives a more sane exit code on abort, by calling _exit directly with code 134.
    _exit(134);
#else
    // process.abort() is user-requested; bypass the crash handler so it does
    // not print "Bun has crashed" or upload a report.
    restoreDefaultSignalDisposition(SIGABRT);
    abort();
#endif
}

#if !OS(WINDOWS)
#if OS(LINUX) || OS(FREEBSD)
extern "C" ssize_t bun_close_range(unsigned int start, unsigned int end, unsigned int flags);
#endif

// Records the stdio fds whose FD_CLOEXEC bit execve() clears so a failed
// execve(2) can put them back: the failure now throws back to JS, and Node
// likewise restores exactly the flags it changed.
struct ExecveCloexecRestorer {
    WTF::Vector<std::pair<int, int>, 8> changed; // (fd, original flags)

    bool setFlags(int fd, int oldFlags, int newFlags)
    {
        if (newFlags == oldFlags)
            return true;
        if (fcntl(fd, F_SETFD, newFlags) < 0)
            return false;
        changed.append({ fd, oldFlags });
        return true;
    }
    void restore()
    {
        for (auto& entry : changed)
            fcntl(entry.first, F_SETFD, entry.second);
    }
};
#endif

JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(Process_functionExecve, __attribute__((minsize)), (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Reject workers before doing any other work. The experimental warning is
    // queued on nextTick; scheduling it on a worker VM that is about to throw
    // (and likely be torn down by the main thread's process.exit) is a race we
    // don't need, and a worker call shouldn't consume the process-wide
    // once_flag anyway.
    if (!Bun__isMainThreadVM()) {
        scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_WORKER_UNSUPPORTED_OPERATION, "Calling process.execve is not supported in workers"_s));
        return {};
    }

    static std::once_flag experimentalWarningFlag;
    std::call_once(experimentalWarningFlag, [&] {
        Process::emitWarning(globalObject,
            jsString(vm, String("process.execve is an experimental feature and might change at any time"_s)),
            jsString(vm, String("ExperimentalWarning"_s)), jsUndefined(), jsUndefined());
    });
    RETURN_IF_EXCEPTION(scope, {});

#if OS(WINDOWS)
    scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_FEATURE_UNAVAILABLE_ON_PLATFORM, "The feature process.execve is unavailable on the current platform, which is being used to run Node.js"_s));
    return {};
#else
    JSValue execPathValue = callFrame->argument(0);
    JSValue argsValue = callFrame->argument(1);
    JSValue envValue = callFrame->argument(2);

    Bun::V::validateString(scope, globalObject, execPathValue, "execPath"_s);
    RETURN_IF_EXCEPTION(scope, {});

    // Node declares execve(execPath, args = [], env = process.env), so an
    // omitted args parameter is valid and means "no extra argv entries".
    if (!argsValue.isUndefined()) {
        bool isArr = JSC::isArray(globalObject, argsValue);
        RETURN_IF_EXCEPTION(scope, {});
        if (!isArr)
            return Bun::ERR::INVALID_ARG_TYPE_INSTANCE(scope, globalObject, "args"_s, "Array"_s, argsValue);
    }

    WTF::String execPath = execPathValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (execPath.contains(static_cast<char16_t>(0))) {
        return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "execPath"_s,
            execPathValue, "must be a string without null bytes"_s);
    }

    JSObject* argsObject = argsValue.isUndefined() ? nullptr : argsValue.getObject();
    unsigned argsLength = 0;
    if (argsObject) {
        argsLength = static_cast<unsigned>(toLength(globalObject, argsObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    Vector<CString> argvStorage;
    argvStorage.reserveInitialCapacity(argsLength);

    for (unsigned i = 0; i < argsLength; i++) {
        JSValue item = argsObject->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        bool invalid = !item.isString();
        WTF::String str;
        if (!invalid) {
            str = item.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            invalid = str.contains(static_cast<char16_t>(0));
        }
        if (invalid) {
            return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, makeString("args["_s, i, "]"_s),
                item, "must be a string without null bytes"_s);
        }
        argvStorage.append(str.utf8());
    }

    // Node declares env = process.env as the default, so an omitted env
    // inherits the current environment rather than exec'ing with an empty
    // one.
    if (envValue.isUndefined()) {
        envValue = globalObject->processEnvObject();
        RETURN_IF_EXCEPTION(scope, {});
    }

    Vector<CString> envStorage;
    {
        Bun::V::validateObject(scope, globalObject, envValue, "env"_s);
        RETURN_IF_EXCEPTION(scope, {});

        JSObject* envObject = envValue.getObject();
        JSC::PropertyNameArrayBuilder envNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
        envObject->methodTable()->getOwnPropertyNames(envObject, globalObject, envNames, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, {});

        envStorage.reserveInitialCapacity(envNames.size());

        for (unsigned i = 0; i < envNames.size(); i++) {
            JSValue value = envObject->get(globalObject, envNames[i]);
            RETURN_IF_EXCEPTION(scope, {});
            // The accessor-backed keys (TZ, NODE_TLS_REJECT_UNAUTHORIZED,
            // BUN_CONFIG_VERBOSE_FETCH) read back undefined for an unset /
            // empty value; skip rather than rejecting the defaulted env.
            if (value.isUndefined())
                continue;
            const WTF::String& keyStr = envNames[i].string();
            bool invalid = !value.isString();
            WTF::String valueStr;
            if (!invalid) {
                valueStr = value.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                invalid = keyStr.contains(static_cast<char16_t>(0)) || valueStr.contains(static_cast<char16_t>(0));
            }
            if (invalid) {
                return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "env"_s,
                    envValue, "must be an object with string keys and values without null bytes"_s);
            }
            envStorage.append(makeString(keyStr, '=', valueStr).utf8());
        }
    }

    CString execPathUtf8 = execPath.utf8();

    // Build the null-terminated argv/envp pointer arrays only after the
    // backing storage is fully populated so there is no risk of pointers
    // becoming stale across any intermediate Vector growth.
    Vector<char*> argv;
    argv.reserveInitialCapacity(argvStorage.size() + 1);
    for (auto& s : argvStorage)
        argv.append(const_cast<char*>(s.data()));
    argv.append(nullptr);

    Vector<char*> envp;
    envp.reserveInitialCapacity(envStorage.size() + 1);
    for (auto& s : envStorage)
        envp.append(const_cast<char*>(s.data()));
    envp.append(nullptr);

    // Set stdin, stdout and stderr to be non-close-on-exec so that the new
    // process will inherit them. Record the previous flags so a failed
    // execve(2), which throws back to JS, leaves them unchanged.
    ExecveCloexecRestorer cloexecRestorer;
    for (int fd = 0; fd <= 2; fd++) {
        int flags = fcntl(fd, F_GETFD);
        if (flags < 0 || !cloexecRestorer.setFlags(fd, flags, flags & ~FD_CLOEXEC)) {
            int fcntlErrno = errno;
            cloexecRestorer.restore();
            throwSystemError(scope, globalObject, "fcntl"_s, fcntlErrno);
            return {};
        }
    }

    int savedErrno;

#if OS(DARWIN)
    // macOS lacks SOCK_CLOEXEC/close_range, so use posix_spawn with the Apple
    // extensions: POSIX_SPAWN_SETEXEC makes posix_spawn(2) behave like a more
    // featureful execve(2) (replace the current image rather than fork), and
    // POSIX_SPAWN_CLOEXEC_DEFAULT atomically closes every descriptor that
    // isn't explicitly inherited via file actions.
    posix_spawnattr_t attrs;
    posix_spawn_file_actions_t actions;
    posix_spawnattr_init(&attrs);
    posix_spawn_file_actions_init(&actions);

    // Reset the blocked signal mask, but don't touch dispositions:
    // POSIX_SPAWN_SETEXEC already gives execve(2) semantics (caught handlers
    // become SIG_DFL; SIG_IGN is preserved), which matches the non-Darwin
    // path and Node. SETSIGDEF with a full set would additionally force
    // SIG_IGN dispositions (e.g. Bun's SIGPIPE) back to SIG_DFL, diverging
    // from Linux.
    sigset_t emptyMask;
    sigemptyset(&emptyMask);
    posix_spawnattr_setsigmask(&attrs, &emptyMask);
    posix_spawnattr_setflags(&attrs,
        POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETEXEC | POSIX_SPAWN_SETSIGMASK);

    posix_spawn_file_actions_addinherit_np(&actions, 0);
    posix_spawn_file_actions_addinherit_np(&actions, 1);
    posix_spawn_file_actions_addinherit_np(&actions, 2);

    pid_t pid;
    savedErrno = posix_spawn(&pid, execPathUtf8.data(), &actions, &attrs, argv.begin(), envp.begin());
    // With POSIX_SPAWN_SETEXEC a successful call never returns; reaching
    // here means it failed and the return value is the errno.
    posix_spawn_file_actions_destroy(&actions);
    posix_spawnattr_destroy(&attrs);
#else
    // Ensure all other file descriptors are close-on-exec so they don't leak
    // into the replacement process. Bun opens descriptors with
    // O_CLOEXEC/SOCK_CLOEXEC where available, so the loop is a best-effort
    // fallback for kernels without close_range(2). This is intentionally not
    // undone if execve(2) fails: FD_CLOEXEC only takes effect at the next
    // exec, so the still-running image is unaffected.
#if OS(LINUX) || OS(FREEBSD)
    if (bun_close_range(3, ~0U, /* CLOSE_RANGE_CLOEXEC */ (1U << 2)) != 0)
#endif
    {
        int maxfd = static_cast<int>(sysconf(_SC_OPEN_MAX));
        if (maxfd < 0 || maxfd > 65536) maxfd = 65536;
        for (int fd = 3; fd < maxfd; fd++) {
            int flags = fcntl(fd, F_GETFD);
            if (flags >= 0) fcntl(fd, F_SETFD, flags | FD_CLOEXEC);
        }
    }

    // Reset the signal mask so the new process starts with defaults. execve(2)
    // resets handlers for caught signals but preserves the blocked mask.
    sigset_t emptyMask;
    sigset_t previousMask;
    sigemptyset(&emptyMask);
    pthread_sigmask(SIG_SETMASK, &emptyMask, &previousMask);

    ::execve(execPathUtf8.data(), argv.begin(), envp.begin());
    savedErrno = errno;

    // execve(2) failed; put back the signal mask we cleared above.
    pthread_sigmask(SIG_SETMASK, &previousMask, nullptr);
#endif

    // execve(2) failed and the original image is still running. Restore the
    // FD_CLOEXEC flags we cleared on stdio, then throw back to JS so the
    // caller can handle it and recover. Node does the same (nodejs/node#62878).
    cloexecRestorer.restore();

    // Match Node's ErrnoException: a plain Error with errno/code/syscall/path.
    auto errName = String::fromLatin1(Bun__errnoName(savedErrno));
    auto& names = WebCore::builtinNames(vm);
    auto* error = JSC::createError(globalObject, makeString(errName, ", "_s, String::fromLatin1(strerror(savedErrno)), " '"_s, execPath, "'"_s));
    error->putDirect(vm, names.errnoPublicName(), jsNumber(savedErrno), 0);
    error->putDirect(vm, names.codePublicName(), jsString(vm, errName), 0);
    error->putDirect(vm, names.syscallPublicName(), jsString(vm, String("execve"_s)), 0);
    error->putDirect(vm, names.pathPublicName(), jsString(vm, execPath), 0);
    scope.throwException(globalObject, error);
    return {};
#endif
}

static bool isJSValueEqualToASCIILiteral(JSC::JSGlobalObject* globalObject, JSC::JSValue value, const ASCIILiteral literal)
{
    if (!value.isString()) {
        return false;
    }

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* str = value.toStringOrNull(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    if (!str) {
        return false;
    }
    auto view = str->view(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
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
    bool isDeprecationWarning = isJSValueEqualToASCIILiteral(globalObject, warningName, "DeprecationWarning"_s);
    RETURN_IF_EXCEPTION(scope, {});
    if (isDeprecationWarning) {
        // Read the per-Process data properties (per-Worker), not the CLI seed:
        // a Worker's `process.throwDeprecation = true` must not affect other VMs.
        JSValue noDep = process->getIfPropertyExists(globalObject, Identifier::fromString(vm, "noDeprecation"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (noDep && noDep.toBoolean(globalObject))
            return jsUndefined();
        JSValue throwDep = process->getIfPropertyExists(globalObject, Identifier::fromString(vm, "throwDeprecation"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (throwDep && throwDep.toBoolean(globalObject)) {
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
__attribute__((minsize)) JSValue Process::emitWarning(JSC::JSGlobalObject* lexicalGlobalObject, JSValue warning, JSValue type, JSValue code, JSValue ctor)
{
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue detail = jsUndefined();

    bool isDeprecationWarning = isJSValueEqualToASCIILiteral(globalObject, type, "DeprecationWarning"_s);
    RETURN_IF_EXCEPTION(scope, {});
    if (isDeprecationWarning) {
        JSValue noDep = globalObject->processObject()->getIfPropertyExists(globalObject, Identifier::fromString(vm, "noDeprecation"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (noDep && noDep.toBoolean(globalObject))
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
        RETURN_IF_EXCEPTION(scope, {});
        errorInstance = createError(globalObject, !s.isEmpty() ? s : "Warning"_s);
        errorInstance->putDirect(vm, vm.propertyNames->name, type, JSC::PropertyAttribute::DontEnum | 0);
    } else if (warning.isCell() && warning.asCell()->type() == ErrorInstanceType) {
        errorInstance = warning.getObject();
    } else {
        return JSValue::decode(Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "warning"_s, "string or Error"_s, warning));
    }

    if (!code.isUndefined()) errorInstance->putDirect(vm, builtinNames(vm).codePublicName(), code, JSC::PropertyAttribute::DontEnum | 0);
    if (!detail.isUndefined()) errorInstance->putDirect(vm, vm.propertyNames->detail, detail, JSC::PropertyAttribute::DontEnum | 0);

    RELEASE_AND_RETURN(scope, emitWarningErrorInstance(lexicalGlobalObject, errorInstance));
}

JSC_DEFINE_HOST_FUNCTION(Process_emitWarning, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto warning = callFrame->argument(0);
    auto type = callFrame->argument(1);
    auto code = callFrame->argument(2);
    auto ctor = callFrame->argument(3);
    return JSValue::encode(Process::emitWarning(globalObject, warning, type, code, ctor));
}

JSC_DEFINE_CUSTOM_GETTER(processExitCode, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName name))
{
    Process* process = dynamicDowncast<Process>(JSValue::decode(thisValue));
    if (!process) {
        return JSValue::encode(jsUndefined());
    }
    if (!process->m_isExitCodeObservable) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsNumber(Bun__getExitCode(process->globalObject()->bunVM())));
}

bool setProcessExitCodeInner(JSC::JSGlobalObject* lexicalGlobalObject, Process* process, JSValue code)
{
    auto throwScope = DECLARE_THROW_SCOPE(process->vm());

    if (!code.isUndefinedOrNull()) {
        if (code.isString()) {
            auto codeString = code.getString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(throwScope, false);
            if (!codeString.isEmpty()) {
                auto num = code.toNumber(lexicalGlobalObject);
                RETURN_IF_EXCEPTION(throwScope, {});
                if (!std::isnan(num)) {
                    code = jsNumber(num);
                }
            }
        }
        ssize_t exitCodeInt;
        Bun::V::validateInteger(throwScope, lexicalGlobalObject, code, "code"_s, jsUndefined(), jsUndefined(), &exitCodeInt);
        RETURN_IF_EXCEPTION(throwScope, false);

        process->m_isExitCodeObservable = true;
        void* ptr = process->globalObject()->bunVM();
        Bun__setExitCode(ptr, static_cast<uint8_t>(exitCodeInt % 256));
    }
    return true;
}
JSC_DEFINE_CUSTOM_SETTER(setProcessExitCode, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, JSC::PropertyName))
{
    Process* process = dynamicDowncast<Process>(JSValue::decode(thisValue));
    if (!process) {
        return false;
    }
    auto throwScope = DECLARE_THROW_SCOPE(process->vm());
    auto code = JSValue::decode(value);

    RELEASE_AND_RETURN(throwScope, setProcessExitCodeInner(lexicalGlobalObject, process, code));
}

JSC_DEFINE_CUSTOM_GETTER(processConnected, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName name))
{
    Process* process = dynamicDowncast<Process>(JSValue::decode(thisValue));
    if (!process) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsBoolean(Bun__GlobalObject__connectedIPC(process->globalObject())));
}
JSC_DEFINE_CUSTOM_SETTER(setProcessConnected, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, JSC::PropertyName))
{
    return false;
}

// process.report.getReport(): cold and large, favour size.
__attribute__((minsize)) static JSValue constructReportObjectComplete(VM& vm, Zig::GlobalObject* globalObject, const String& fileName)
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

            putDirectNamed(vm, limitObject, "soft"_s, soft);
            putDirectNamed(vm, limitObject, "hard"_s, hard);

            userLimits->putDirect(vm, JSC::Identifier::fromString(vm, labels[i]), limitObject, 0);
        }

        return userLimits;
    };

    auto constructResourceUsage = [&]() -> JSC::JSValue {
        JSC::JSObject* resourceUsage = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 11);
        RETURN_IF_EXCEPTION(scope, {});

        rusage usage;

        getrusage(RUSAGE_SELF, &usage);

        putDirectNamed(vm, resourceUsage, "free_memory"_s, JSC::jsNumber(usage.ru_maxrss));
        putDirectNamed(vm, resourceUsage, "total_memory"_s, JSC::jsNumber(usage.ru_maxrss));
        putDirectNamed(vm, resourceUsage, "rss"_s, JSC::jsNumber(usage.ru_maxrss));
        putDirectNamed(vm, resourceUsage, "available_memory"_s, JSC::jsNumber(usage.ru_maxrss));
        putDirectNamed(vm, resourceUsage, "userCpuSeconds"_s, JSC::jsNumber(usage.ru_utime.tv_sec));
        putDirectNamed(vm, resourceUsage, "kernelCpuSeconds"_s, JSC::jsNumber(usage.ru_stime.tv_sec));
        putDirectNamed(vm, resourceUsage, "cpuConsumptionPercent"_s, JSC::jsNumber(usage.ru_utime.tv_sec));
        putDirectNamed(vm, resourceUsage, "userCpuConsumptionPercent"_s, JSC::jsNumber(usage.ru_utime.tv_sec));
        putDirectNamed(vm, resourceUsage, "kernelCpuConsumptionPercent"_s, JSC::jsNumber(usage.ru_utime.tv_sec));
        putDirectNamed(vm, resourceUsage, "maxRss"_s, JSC::jsNumber(usage.ru_maxrss));

        JSC::JSObject* pageFaults = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, pageFaults, "IORequired"_s, JSC::jsNumber(usage.ru_majflt));
        putDirectNamed(vm, pageFaults, "IONotRequired"_s, JSC::jsNumber(usage.ru_minflt));

        putDirectNamed(vm, resourceUsage, "pageFaults"_s, pageFaults);

        JSC::JSObject* fsActivity = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, fsActivity, "reads"_s, JSC::jsNumber(usage.ru_inblock));
        putDirectNamed(vm, fsActivity, "writes"_s, JSC::jsNumber(usage.ru_oublock));

        putDirectNamed(vm, resourceUsage, "fsActivity"_s, fsActivity);

        return resourceUsage;
    };

    auto constructHeader = [&]() -> JSC::JSValue {
        JSC::JSObject* header = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype());
        RETURN_IF_EXCEPTION(scope, {});

        putDirectNamed(vm, header, "reportVersion"_s, JSC::jsNumber(3));
        putDirectNamed(vm, header, "event"_s, JSC::jsString(vm, String("JavaScript API"_s)));
        putDirectNamed(vm, header, "trigger"_s, JSC::jsString(vm, String("GetReport"_s)));
        if (fileName.isEmpty()) {
            putDirectNamed(vm, header, "filename"_s, JSC::jsNull());
        } else {
            putDirectNamed(vm, header, "filename"_s, JSC::jsString(vm, fileName));
        }

        double time = WTF::jsCurrentTime();
        char timeBuf[64] = { 0 };
        Bun::toISOString(vm, time, timeBuf);
        auto timeStamp = WTF::String::fromLatin1(timeBuf);

        putDirectNamed(vm, header, "dumpEventTime"_s, JSC::numberToString(vm, time, 10));
        putDirectNamed(vm, header, "dumpEventTimeStamp"_s, JSC::jsString(vm, timeStamp));
        putDirectNamed(vm, header, "processId"_s, JSC::jsNumber(getpid()));
        // TODO:
        putDirectNamed(vm, header, "threadId"_s, JSC::jsNumber(0));

        {
            char cwd[PATH_MAX] = { 0 };

            if (getcwd(cwd, PATH_MAX) == nullptr) {
                cwd[0] = '.';
                cwd[1] = '\0';
            }

            putDirectNamed(vm, header, "cwd"_s, JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const Latin1Character*>(cwd), strlen(cwd) })));
            RETURN_IF_EXCEPTION(scope, {});
        }

        JSValue commandLine = JSValue::decode(Bun__Process__createExecArgv(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, header, "commandLine"_s, commandLine);
        putDirectNamed(vm, header, "nodejsVersion"_s, JSC::jsString(vm, String::fromLatin1(REPORTED_NODEJS_VERSION)));
        putDirectNamed(vm, header, "wordSize"_s, JSC::jsNumber(64));
        putDirectNamed(vm, header, "arch"_s, constructArch(vm, header));
        putDirectNamed(vm, header, "platform"_s, constructPlatform(vm, header));
        JSValue componentVersions = constructVersions(vm, header);
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, header, "componentVersions"_s, componentVersions);
        JSValue release = constructProcessReleaseObject(vm, header);
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, header, "release"_s, release);

        {
            // uname
            struct utsname buf;
            if (uname(&buf) != 0) {
                memset(&buf, 0, sizeof(buf));
            }

            putDirectNamed(vm, header, "osName"_s, JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const Latin1Character*>(buf.sysname), strlen(buf.sysname) })));
            putDirectNamed(vm, header, "osRelease"_s, JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const Latin1Character*>(buf.release), strlen(buf.release) })));
            putDirectNamed(vm, header, "osVersion"_s, JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const Latin1Character*>(buf.version), strlen(buf.version) })));
            putDirectNamed(vm, header, "osMachine"_s, JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const Latin1Character*>(buf.machine), strlen(buf.machine) })));
        }

        // host
        {
            // TODO: use HOSTNAME_MAX
            char host[1024] = { 0 };
            if (gethostname(host, 1024) != 0) {
                host[0] = '0';
            }

            putDirectNamed(vm, header, "host"_s, JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const Latin1Character*>(host), strlen(host) })));
        }

#if OS(LINUX)
#ifdef __GNU_LIBRARY__
        putDirectNamed(vm, header, "glibcVersionCompiler"_s, JSC::jsString(vm, makeString(__GLIBC__, '.', __GLIBC_MINOR__)));
        putDirectNamed(vm, header, "glibcVersionRuntime"_s, JSC::jsString(vm, String::fromUTF8(gnu_get_libc_version())));
#else
#endif
#endif

        auto* cpusArray = JSC::constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, header, "cpus"_s, cpusArray);
        auto* networkInterfacesArray = JSC::constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, header, "networkInterfaces"_s, networkInterfacesArray);

        return header;
    };

    auto constructJavaScriptHeap = [&]() -> JSC::JSValue {
        JSC::JSObject* heap = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 16);
        RETURN_IF_EXCEPTION(scope, {});

        JSC::JSObject* heapSpaces = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 9);
        putDirectNamed(vm, heapSpaces, "read_only_space"_s, JSC::constructEmptyObject(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, heapSpaces, "new_space"_s, JSC::constructEmptyObject(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, heapSpaces, "old_space"_s, JSC::constructEmptyObject(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, heapSpaces, "code_space"_s, JSC::constructEmptyObject(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, heapSpaces, "shared_space"_s, JSC::constructEmptyObject(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, heapSpaces, "new_large_object_space"_s, JSC::constructEmptyObject(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, heapSpaces, "large_object_space"_s, JSC::constructEmptyObject(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, heapSpaces, "code_large_object_space"_s, JSC::constructEmptyObject(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, heapSpaces, "shared_large_object_space"_s, JSC::constructEmptyObject(globalObject));
        RETURN_IF_EXCEPTION(scope, {});

        putDirectNamed(vm, heap, "totalMemory"_s, JSC::jsNumber(WTF::ramSize()));
        putDirectNamed(vm, heap, "executableMemory"_s, jsNumber(0));
        putDirectNamed(vm, heap, "totalCommittedMemory"_s, jsNumber(0));
        putDirectNamed(vm, heap, "availableMemory"_s, jsNumber(0));
        putDirectNamed(vm, heap, "totalGlobalHandlesMemory"_s, jsNumber(0));
        putDirectNamed(vm, heap, "usedGlobalHandlesMemory"_s, jsNumber(0));
        putDirectNamed(vm, heap, "usedMemory"_s, jsNumber(0));
        putDirectNamed(vm, heap, "memoryLimit"_s, jsNumber(0));
        putDirectNamed(vm, heap, "mallocedMemory"_s, jsNumber(0));
        putDirectNamed(vm, heap, "externalMemory"_s, JSC::jsNumber(vm.heap.externalMemorySize()));
        putDirectNamed(vm, heap, "peakMallocedMemory"_s, jsNumber(0));
        putDirectNamed(vm, heap, "nativeContextCount"_s, JSC::jsNumber(1));
        putDirectNamed(vm, heap, "detachedContextCount"_s, JSC::jsNumber(0));
        putDirectNamed(vm, heap, "doesZapGarbage"_s, JSC::jsNumber(0));
        putDirectNamed(vm, heap, "heapSpaces"_s, heapSpaces);

        return heap;
    };

    auto constructUVThreadResourceUsage = [&]() -> JSC::JSValue {
        JSC::JSObject* uvthreadResourceUsage = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 6);
        RETURN_IF_EXCEPTION(scope, {});

        putDirectNamed(vm, uvthreadResourceUsage, "userCpuSeconds"_s, JSC::jsNumber(0));
        putDirectNamed(vm, uvthreadResourceUsage, "kernelCpuSeconds"_s, JSC::jsNumber(0));
        putDirectNamed(vm, uvthreadResourceUsage, "cpuConsumptionPercent"_s, JSC::jsNumber(0));
        putDirectNamed(vm, uvthreadResourceUsage, "userCpuConsumptionPercent"_s, JSC::jsNumber(0));
        putDirectNamed(vm, uvthreadResourceUsage, "kernelCpuConsumptionPercent"_s, JSC::jsNumber(0));

        JSC::JSObject* fsActivity = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, fsActivity, "reads"_s, JSC::jsNumber(0));
        putDirectNamed(vm, fsActivity, "writes"_s, JSC::jsNumber(0));

        putDirectNamed(vm, uvthreadResourceUsage, "fsActivity"_s, fsActivity);

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
            RETURN_IF_EXCEPTION(scope, {});

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
        putDirectNamed(vm, errorProperties, "code"_s, JSC::jsString(vm, String("ERR_SYNTHETIC"_s)));
        putDirectNamed(vm, javascriptStack, "errorProperties"_s, errorProperties);
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

        JSValue header = constructHeader();
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, report, "header"_s, header);
        JSValue javascriptStack = constructJavaScriptStack();
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, report, "javascriptStack"_s, javascriptStack);
        JSValue javascriptHeap = constructJavaScriptHeap();
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, report, "javascriptHeap"_s, javascriptHeap);
        JSValue nativeStack = constructNativeStack();
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, report, "nativeStack"_s, nativeStack);
        JSValue resourceUsage = constructResourceUsage();
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, report, "resourceUsage"_s, resourceUsage);
        JSValue uvthreadResourceUsage = constructUVThreadResourceUsage();
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, report, "uvthreadResourceUsage"_s, uvthreadResourceUsage);
        JSValue libuv = constructLibUV();
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, report, "libuv"_s, libuv);
        JSValue workers = constructWorkers();
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, report, "workers"_s, workers);
        JSValue environmentVariables = constructEnvironmentVariables();
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, report, "environmentVariables"_s, environmentVariables);
        JSValue userLimits = constructUserLimits();
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, report, "userLimits"_s, userLimits);
        JSValue sharedObjects = constructSharedObjects();
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, report, "sharedObjects"_s, sharedObjects);
        JSValue cpus = constructCpus();
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, report, "cpus"_s, cpus);
        JSValue networkInterfaces = constructNetworkInterfaces();
        RETURN_IF_EXCEPTION(scope, {});
        putDirectNamed(vm, report, "networkInterfaces"_s, networkInterfaces);

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

JSC_DEFINE_HOST_FUNCTION(Process_functionGetReport, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    // TODO: node:vm
    return JSValue::encode(constructReportObjectComplete(vm, uncheckedDowncast<Zig::GlobalObject>(globalObject), String()));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionWriteReport, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // TODO:
    return JSValue::encode(callFrame->argument(0));
}

static JSValue constructProcessReportObject(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    auto process = uncheckedDowncast<Process>(processObject);

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* report = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 10);
    putDirectNamed(vm, report, "compact"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, report, "directory"_s, JSC::jsEmptyString(vm));
    putDirectNamed(vm, report, "filename"_s, JSC::jsEmptyString(vm));
    putDirectNamed(vm, report, "getReport"_s, JSC::JSFunction::create(vm, globalObject, 0, String("getReport"_s), Process_functionGetReport, ImplementationVisibility::Public));
    putDirectNamed(vm, report, "reportOnFatalError"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, report, "reportOnSignal"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, report, "reportOnUncaughtException"_s, JSC::jsBoolean(process->m_reportOnUncaughtException));
    putDirectNamed(vm, report, "excludeEnv"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, report, "excludeEnv"_s, JSC::jsString(vm, String("SIGUSR2"_s)));
    putDirectNamed(vm, report, "writeReport"_s, JSC::JSFunction::create(vm, globalObject, 1, String("writeReport"_s), Process_functionWriteReport, ImplementationVisibility::Public));
    RETURN_IF_EXCEPTION(scope, {});
    return report;
}

__attribute__((minsize)) static JSValue constructProcessConfigObject(VM& vm, JSObject* processObject)
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
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::JSObject* config = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
    JSC::JSObject* variables = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
    JSC::JSArray* shareableBuiltins = JSC::constructEmptyArray(globalObject, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    putDirectNamed(vm, variables, "v8_enable_i18n_support"_s, JSC::jsNumber(1));
    putDirectNamed(vm, variables, "enable_lto"_s, JSC::jsBoolean(false));
    // Node 26's common.gypi evaluates enable_thin_lto/lto_jobs conditions; gyp
    // hard-fails on undefined variables, so node-gyp builds need them present.
    putDirectNamed(vm, variables, "enable_thin_lto"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "lto_jobs"_s, JSC::jsString(vm, String(""_s)));
    putDirectNamed(vm, variables, "node_module_version"_s, JSC::jsNumber(REPORTED_NODEJS_ABI_VERSION));
    putDirectNamed(vm, variables, "napi_build_version"_s, JSC::jsNumber(Napi::DEFAULT_NAPI_VERSION));
    putDirectNamed(vm, variables, "node_builtin_shareable_builtins"_s, shareableBuiltins);
    putDirectNamed(vm, variables, "node_byteorder"_s, JSC::jsString(vm, String("little"_s)));
    // Bun does not parse the NODE_OPTIONS environment variable, so report the
    // same value as a Node build compiled --without-node-options; upstream
    // tests gate NODE_OPTIONS-dependent cases on this key.
    putDirectNamed(vm, variables, "node_without_node_options"_s, JSC::jsBoolean(true));
    putDirectNamed(vm, variables, "clang"_s, JSC::jsNumber(0));

    putDirectNamed(vm, config, "target_defaults"_s, JSC::constructEmptyObject(globalObject));
    putDirectNamed(vm, config, "variables"_s, variables);

#if OS(WINDOWS)
    putDirectNamed(vm, variables, "control_flow_guard"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "coverage"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "dcheck_always_on"_s, JSC::jsNumber(0));
    putDirectNamed(vm, variables, "debug_nghttp2"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "debug_node"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "enable_lto"_s, JSC::jsBoolean(false));
    // Node 26's common.gypi evaluates enable_thin_lto/lto_jobs conditions; gyp
    // hard-fails on undefined variables, so node-gyp builds need them present.
    putDirectNamed(vm, variables, "enable_thin_lto"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "lto_jobs"_s, JSC::jsString(vm, String(""_s)));
    putDirectNamed(vm, variables, "enable_pgo_generate"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "enable_pgo_use"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "error_on_warn"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "force_dynamic_crt"_s, JSC::jsNumber(0));
    putDirectNamed(vm, variables, "napi_build_version"_s, JSC::jsNumber(Napi::DEFAULT_NAPI_VERSION));
    putDirectNamed(vm, variables, "nasm_version"_s, JSC::jsNumber(2));
#elif OS(MACOS)
    // Real Node on macOS reports clang=1; common.gypi only applies
    // CLANG_CXX_LANGUAGE_STANDARD (gnu++20) to addon builds when clang==1,
    // and Apple clang's default standard is far older.
    putDirectNamed(vm, variables, "clang"_s, JSC::jsNumber(1));
    putDirectNamed(vm, variables, "control_flow_guard"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "coverage"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "dcheck_always_on"_s, JSC::jsNumber(0));
    putDirectNamed(vm, variables, "debug_nghttp2"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "debug_node"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "enable_lto"_s, JSC::jsBoolean(false));
    // Node 26's common.gypi evaluates enable_thin_lto/lto_jobs conditions; gyp
    // hard-fails on undefined variables, so node-gyp builds need them present.
    putDirectNamed(vm, variables, "enable_thin_lto"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "lto_jobs"_s, JSC::jsString(vm, String(""_s)));
    putDirectNamed(vm, variables, "enable_pgo_generate"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "enable_pgo_use"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "error_on_warn"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "force_dynamic_crt"_s, JSC::jsNumber(0));
#if CPU(ARM64)
    putDirectNamed(vm, variables, "arm_fpu"_s, JSC::jsString(vm, String("neon"_s)));
#endif
#elif OS(LINUX) || OS(FREEBSD)
    putDirectNamed(vm, variables, "control_flow_guard"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "coverage"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "dcheck_always_on"_s, JSC::jsNumber(0));
    putDirectNamed(vm, variables, "debug_nghttp2"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "debug_node"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "enable_lto"_s, JSC::jsBoolean(false));
    // Node 26's common.gypi evaluates enable_thin_lto/lto_jobs conditions; gyp
    // hard-fails on undefined variables, so node-gyp builds need them present.
    putDirectNamed(vm, variables, "enable_thin_lto"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "lto_jobs"_s, JSC::jsString(vm, String(""_s)));
    putDirectNamed(vm, variables, "enable_pgo_generate"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "enable_pgo_use"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "error_on_warn"_s, JSC::jsBoolean(false));
    putDirectNamed(vm, variables, "force_dynamic_crt"_s, JSC::jsNumber(0));
    putDirectNamed(vm, variables, "napi_build"_s, JSC::jsString(vm, String("0.0"_s)));
#else
#error "Unsupported OS"
#endif

#if CPU(X86_64)
    putDirectNamed(vm, variables, "host_arch"_s, JSC::jsString(vm, String("x64"_s)));
    putDirectNamed(vm, variables, "target_arch"_s, JSC::jsString(vm, String("x64"_s)));
#elif CPU(ARM64)
    putDirectNamed(vm, variables, "host_arch"_s, JSC::jsString(vm, String("arm64"_s)));
    putDirectNamed(vm, variables, "target_arch"_s, JSC::jsString(vm, String("arm64"_s)));
#else
#error "Unsupported architecture"
#endif

#if ASAN_ENABLED
    // TODO: figure out why this causes v8.test.ts to fail.
    // variables->putDirect(vm, JSC::Identifier::fromString(vm, "asan"_s), JSC::jsNumber(1), 0);
    putDirectNamed(vm, variables, "asan"_s, JSC::jsNumber(0));
#else
    putDirectNamed(vm, variables, "asan"_s, JSC::jsNumber(0));
#endif

    config->freeze(vm);
    RETURN_IF_EXCEPTION(scope, {});
    return config;
}

static JSValue constructProcessHrtimeObject(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    JSC::JSFunction* hrtime = JSC::JSFunction::create(vm, globalObject, 0, String("hrtime"_s), Process_functionHRTime, ImplementationVisibility::Public);

    JSC::JSFunction* hrtimeBigInt = JSC::JSFunction::create(vm, globalObject, 0, String("bigint"_s), Process_functionHRTimeBigInt, ImplementationVisibility::Public);

    putDirectNamed(vm, hrtime, "bigint"_s, hrtimeBigInt);

    return hrtime;
}
enum class BunProcessStdinFdType : int32_t {
    file = 0,
    pipe = 1,
    socket = 2,
};
extern "C" BunProcessStdinFdType Bun__Process__getStdinFdType(void*, int fd);

extern "C" void Bun__ForceFileSinkToBeSynchronousForProcessObjectStdio(JSC::JSGlobalObject*, JSC::EncodedJSValue);
// node:worker_threads worker: process.stdout/stderr forward to the parent Worker's
// worker.stdout/stderr over a MessagePort; process.stdin is port-fed for { stdin: true }
// and otherwise an already-ended Readable (never the process-wide fd 0). fd 0/1/2 selects the port.
static JSValue constructNodeWorkerStdioStream(JSC::JSGlobalObject* globalObject, JSC::JSObject* processObject, JSObject* ports, int fd)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::JSFunction* getStream = JSC::JSFunction::create(vm, globalObject, processObjectInternalsGetNodeWorkerStdioStreamCodeGenerator(vm), globalObject);
    JSC::MarkedArgumentBuffer args;
    args.append(processObject);
    args.append(JSC::jsNumber(fd));
    args.append(ports);
    auto result = JSC::profiledCall(globalObject, ProfilingReason::API, getStream, JSC::getCallData(getStream), globalObject->globalThis(), args);
    RETURN_IF_EXCEPTION(scope, {});
    return result;
}

static JSValue constructStdioWriteStream(JSC::JSGlobalObject* globalObject, JSC::JSObject* processObject, int fd)
{
    auto& vm = JSC::getVM(globalObject);
    if (auto* ports = defaultGlobalObject(globalObject)->nodeWorkerStdioPorts())
        return constructNodeWorkerStdioStream(globalObject, processObject, ports, fd);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSC::JSFunction* getStdioWriteStream = JSC::JSFunction::create(vm, globalObject, processObjectInternalsGetStdioWriteStreamCodeGenerator(vm), globalObject);
    JSC::MarkedArgumentBuffer args;
    args.append(processObject);
    args.append(JSC::jsNumber(fd));
    args.append(jsBoolean(bun_stdio_tty[fd]));
    BunProcessStdinFdType fdType = Bun__Process__getStdinFdType(Bun::vm(vm), fd);
    args.append(jsNumber(static_cast<int32_t>(fdType)));

    JSC::CallData callData = JSC::getCallData(getStdioWriteStream);

    auto result = JSC::profiledCall(globalObject, ProfilingReason::API, getStdioWriteStream, callData, globalObject->globalThis(), args);
    RETURN_IF_EXCEPTION(scope, {});

    ASSERT_WITH_MESSAGE(JSC::isJSArray(result), "Expected an array from getStdioWriteStream");
    JSC::JSArray* resultObject = uncheckedDowncast<JSC::JSArray>(result);

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
        JSValue sink = resultObject->getIndex(globalObject, 1);
        RETURN_IF_EXCEPTION(scope, {});
        Bun__ForceFileSinkToBeSynchronousForProcessObjectStdio(globalObject, JSValue::encode(sink));
    }

    JSValue stream = resultObject->getIndex(globalObject, 0);
    RETURN_IF_EXCEPTION(scope, {});
    return stream;
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
    if (auto* ports = defaultGlobalObject(globalObject)->nodeWorkerStdioPorts())
        return constructNodeWorkerStdioStream(globalObject, processObject, ports, 0);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::JSFunction* getStdinStream = JSC::JSFunction::create(vm, globalObject, processObjectInternalsGetStdinStreamCodeGenerator(vm), globalObject);
    JSC::MarkedArgumentBuffer args;
    args.append(processObject);
    args.append(JSC::jsNumber(STDIN_FILENO));
    args.append(jsBoolean(bun_stdio_tty[STDIN_FILENO]));
    BunProcessStdinFdType fdType = Bun__Process__getStdinFdType(Bun::vm(vm), STDIN_FILENO);
    args.append(jsNumber(static_cast<int32_t>(fdType)));
    JSC::CallData callData = JSC::getCallData(getStdinStream);

    auto result = JSC::profiledCall(globalObject, ProfilingReason::API, getStdinStream, callData, globalObject, args);
    RETURN_IF_EXCEPTION(scope, {});
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

JSC_DEFINE_HOST_FUNCTION(Bun__Process__disconnect, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto global = uncheckedDowncast<GlobalObject>(globalObject);

    if (!Bun__GlobalObject__connectedIPC(globalObject)) {
        Process__emitErrorEvent(global, JSValue::encode(createError(globalObject, ErrorCode::ERR_IPC_DISCONNECTED, "IPC channel is already disconnected"_s)));
        return JSC::JSValue::encode(jsUndefined());
    }

    Bun__closeChildIPC(globalObject);
    return JSC::JSValue::encode(jsUndefined());
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
        return callLazyProcessBuilder(vm, globalObject, processObjectInternalsGetChannelCodeGenerator, JSC::ArgList());
    }
    return jsUndefined();
}

#if OS(WINDOWS)
#define getpid _getpid
#endif

static JSValue constructPid(VM& vm, JSObject* processObject)
{
    return jsNumber(getpid());
}

JSC_DEFINE_CUSTOM_GETTER(processPpid, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    // Always call the syscall so the value reflects reparenting
    // (e.g. after the original parent dies and the child is
    // reparented to init). Matches Node.js behavior.
#if OS(WINDOWS)
    return JSValue::encode(jsNumber(uv_os_getppid()));
#else
    return JSValue::encode(jsNumber(getppid()));
#endif
}

JSC_DEFINE_CUSTOM_SETTER(setProcessPpid, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName propertyName))
{
    // Match Node.js: writing to process.ppid replaces the live
    // accessor with the written value on this object, so
    // subsequent reads return what was written.
    JSC::JSObject* thisObject = dynamicDowncast<JSC::JSObject>(JSValue::decode(thisValue));
    if (!thisObject) {
        return false;
    }
    auto& vm = JSC::getVM(globalObject);
    thisObject->putDirect(vm, propertyName, JSValue::decode(encodedValue), 0);
    return true;
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
JSC_DEFINE_CUSTOM_GETTER(processArgv, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    Process* process = getProcessObject(globalObject, JSValue::decode(thisValue));
    if (!process) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(process->getArgv(globalObject));
}

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

JSC_DEFINE_CUSTOM_SETTER(setProcessArgv, (JSGlobalObject * globalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName))
{
    Process* process = getProcessObject(globalObject, JSValue::decode(thisValue));
    if (!process) {
        return true;
    }

    JSValue value = JSValue::decode(encodedValue);
    process->setArgv(globalObject, value);
    return true;
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

JSC_DEFINE_CUSTOM_GETTER(processExecArgv, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    Process* process = getProcessObject(globalObject, JSValue::decode(thisValue));
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

JSC_DEFINE_CUSTOM_SETTER(setProcessExecArgv, (JSGlobalObject * globalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName))
{
    Process* process = getProcessObject(globalObject, JSValue::decode(thisValue));
    if (!process) {
        return true;
    }

    JSValue value = JSValue::decode(encodedValue);
    process->setExecArgv(globalObject, value);
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(processGetEval, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    Process* process = getProcessObject(globalObject, JSValue::decode(thisValue));
    if (!process) {
        return JSValue::encode(jsUndefined());
    }

    return Bun__Process__getEval(globalObject);
}

JSC_DEFINE_CUSTOM_SETTER(setProcessGetEval, (JSGlobalObject * globalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName))
{
    // dont allow setting eval from js
    return true;
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
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(processObject->globalObject());
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue env = globalObject->processEnvObject();
    RETURN_IF_EXCEPTION(scope, {});
    return env;
}

#if !OS(WINDOWS)

JSC_DEFINE_HOST_FUNCTION(Process_functiongetuid, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(jsNumber(getuid()));
}

JSC_DEFINE_HOST_FUNCTION(Process_functiongeteuid, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(jsNumber(geteuid()));
}

JSC_DEFINE_HOST_FUNCTION(Process_functiongetegid, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(jsNumber(getegid()));
}

JSC_DEFINE_HOST_FUNCTION(Process_functiongetgid, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(jsNumber(getgid()));
}

JSC_DEFINE_HOST_FUNCTION(Process_functiongetgroups, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    int ngroups = getgroups(0, nullptr);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (ngroups == -1) {
        throwSystemError(throwScope, globalObject, "getgroups"_s, errno);
        return {};
    }
    JSArray* groups = constructEmptyArray(globalObject, nullptr, ngroups);
    RETURN_IF_EXCEPTION(throwScope, {});
    Vector<gid_t> groupVector(ngroups);
    getgroups(ngroups, groupVector.begin());
    for (unsigned i = 0; i < ngroups; i++) {
        groups->putDirectIndex(globalObject, i, jsNumber(groupVector[i]));
        RETURN_IF_EXCEPTION(throwScope, {});
    }
    return JSValue::encode(groups);
}

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

// glibc/musl set*id() broadcast a realtime signal to every thread and block on a
// barrier; a thread JSC/libpas has signal-suspended can't ack it and wedges the
// process. Holding the thread-suspend lock guarantees no thread is suspended here.
template<typename Function>
static ALWAYS_INLINE int callWithoutThreadSuspension(Function&& function)
{
#if OS(LINUX)
    WTF::ThreadSuspendLocker suspendLocker;
#endif
    return function();
}

JSC_DEFINE_HOST_FUNCTION(Process_functionsetuid, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto value = callFrame->argument(0);
    uint32_t id = 0;
    auto is_number = value.isNumber();
    value = maybe_uid_by_name(scope, globalObject, value);
    RETURN_IF_EXCEPTION(scope, {});
    if (is_number) Bun::V::validateInteger(scope, globalObject, value, "id"_s, jsNumber(0), jsNumber(std::pow(2, 31) - 1), &id);
    if (!is_number) id = value.toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto result = callWithoutThreadSuspension([&] { return setuid(id); });
    if (result != 0) throwSystemError(scope, globalObject, "setuid"_s, errno);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsNumber(result));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionseteuid, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto value = callFrame->argument(0);
    uint32_t id = 0;
    auto is_number = value.isNumber();
    value = maybe_uid_by_name(scope, globalObject, value);
    RETURN_IF_EXCEPTION(scope, {});
    if (is_number) Bun::V::validateInteger(scope, globalObject, value, "id"_s, jsNumber(0), jsNumber(std::pow(2, 31) - 1), &id);
    if (!is_number) id = value.toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto result = callWithoutThreadSuspension([&] { return seteuid(id); });
    if (result != 0) throwSystemError(scope, globalObject, "seteuid"_s, errno);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsNumber(result));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionsetegid, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto value = callFrame->argument(0);
    uint32_t id = 0;
    auto is_number = value.isNumber();
    value = maybe_gid_by_name(scope, globalObject, value);
    RETURN_IF_EXCEPTION(scope, {});
    if (is_number) Bun::V::validateInteger(scope, globalObject, value, "id"_s, jsNumber(0), jsNumber(std::pow(2, 31) - 1), &id);
    if (!is_number) id = value.toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto result = callWithoutThreadSuspension([&] { return setegid(id); });
    if (result != 0) throwSystemError(scope, globalObject, "setegid"_s, errno);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsNumber(result));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionsetgid, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto value = callFrame->argument(0);
    uint32_t id = 0;
    auto is_number = value.isNumber();
    value = maybe_gid_by_name(scope, globalObject, value);
    RETURN_IF_EXCEPTION(scope, {});
    if (is_number) Bun::V::validateInteger(scope, globalObject, value, "id"_s, jsNumber(0), jsNumber(std::pow(2, 31) - 1), &id);
    if (!is_number) id = value.toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto result = callWithoutThreadSuspension([&] { return setgid(id); });
    if (result != 0) throwSystemError(scope, globalObject, "setgid"_s, errno);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsNumber(result));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionsetgroups, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto groups = callFrame->argument(0);
    Bun::V::validateArray(scope, globalObject, groups, "groups"_s, jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});
    auto* groupsArray = dynamicDowncast<JSC::JSArray>(groups);
    if (!groupsArray) [[unlikely]] {
        // validateArray uses JSC::isArray() which accepts Proxy->Array, but jsDynamicCast returns null.
        return Bun::ERR::INVALID_ARG_INSTANCE(scope, globalObject, "groups"_s, "Array"_s, groups);
    }
    auto count = groupsArray->length();
    gid_t groupsStack[64];
    if (count > 64) return Bun::ERR::OUT_OF_RANGE(scope, globalObject, "groups.length"_s, 0, 64, groups);

    for (unsigned i = 0; i < count; i++) {
        auto item = groupsArray->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        auto name = makeString("groups["_s, i, "]"_s);

        if (item.isNumber()) {
            Bun::V::validateUint32(scope, globalObject, item, jsString(vm, name), jsUndefined());
            RETURN_IF_EXCEPTION(scope, {});
            groupsStack[i] = JSC::toUInt32(item.asNumber());
            continue;
        } else if (item.isString()) {
            item = maybe_gid_by_name(scope, globalObject, item);
            RETURN_IF_EXCEPTION(scope, {});
            groupsStack[i] = item.toUInt32(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            continue;
        }
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "number or string"_s, item);
    }

    auto result = callWithoutThreadSuspension([&] { return setgroups(count, groupsStack); });
    if (result != 0) throwSystemError(scope, globalObject, "setgid"_s, errno);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsNumber(result));
}

// Node reports initgroups argument-type failures as
// "must be one of type number or string".
static constexpr ASCIILiteral initgroupsIdTypes[] = { "number"_s, "string"_s };

JSC_DEFINE_HOST_FUNCTION(Process_functioninitgroups, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue user = callFrame->argument(0);
    JSValue extraGroup = callFrame->argument(1);

    // Node's validateId: numeric ids must be valid uint32 values, so NaN,
    // negatives, and non-integers fail deterministically instead of being
    // coerced into an unrelated uid/gid by toUInt32().
    if (!user.isNumber() && !user.isString())
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "user"_s, std::span<const ASCIILiteral> { initgroupsIdTypes }, user);
    if (user.isNumber()) {
        Bun::V::validateUint32(scope, globalObject, user, "user"_s, jsUndefined());
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (!extraGroup.isNumber() && !extraGroup.isString())
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "extraGroup"_s, std::span<const ASCIILiteral> { initgroupsIdTypes }, extraGroup);
    if (extraGroup.isNumber()) {
        Bun::V::validateUint32(scope, globalObject, extraGroup, "extraGroup"_s, jsUndefined());
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Node resolves the extra group before the user, so an unknown group name
    // is reported even when the user is also unknown.
    JSValue gidValue = maybe_gid_by_name(scope, globalObject, extraGroup);
    RETURN_IF_EXCEPTION(scope, {});
    gid_t gid = static_cast<gid_t>(gidValue.toUInt32(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    // initgroups(3) takes a user *name*. Node passes a string user through
    // as-is (initgroups(3) reports EPERM/ENOMEM/etc. itself); only a numeric
    // uid is pre-resolved through passwd so we have a name to pass.
    CString userNameUTF8;
    const char* userName = nullptr;
    struct passwd pwd;
    struct passwd* pp = nullptr;
    char buf[8192];
    if (user.isString()) {
        auto str = user.getString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        userNameUTF8 = str.utf8();
        userName = userNameUTF8.data();
    } else {
        uid_t uid = static_cast<uid_t>(user.toUInt32(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        if (getpwuid_r(uid, &pwd, buf, sizeof(buf), &pp) != 0 || pp == nullptr) {
            auto message = makeString("User identifier does not exist: "_s, String::number(uid));
            scope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_UNKNOWN_CREDENTIAL, message));
            return {};
        }
        userName = pp->pw_name;
    }

    auto result = callWithoutThreadSuspension([&] { return initgroups(userName, gid); });
    if (result != 0) {
        throwSystemError(scope, globalObject, "initgroups"_s, errno);
        return {};
    }
    return JSValue::encode(jsUndefined());
}

#endif

JSC_DEFINE_HOST_FUNCTION(Process_functionAssert, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSValue arg0 = callFrame->argument(0);
    bool condition = arg0.toBoolean(globalObject);
    if (condition) {
        return JSValue::encode(jsUndefined());
    }

    auto msg = callFrame->argument(1);
    auto msgb = msg.toBoolean(globalObject);
    if (msgb) {
        return Bun::ERR::ASSERTION(throwScope, globalObject, msg);
    }
    return Bun::ERR::ASSERTION(throwScope, globalObject, "assertion error"_s);
}

extern "C" uint64_t Bun__Os__getFreeMemory(void);
JSC_DEFINE_HOST_FUNCTION(Process_availableMemory, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(jsNumber(Bun__Os__getFreeMemory()));
}

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
    putDirectNamed(vm, config, "isDebugBuild"_s, jsBoolean(true));
#else
    putDirectNamed(vm, config, "isDebugBuild"_s, jsBoolean(false));
#endif
    putDirectNamed(vm, config, "hasOpenSSL"_s, jsBoolean(true));
    putDirectNamed(vm, config, "fipsMode"_s, jsBoolean(true));
    putDirectNamed(vm, config, "hasIntl"_s, jsBoolean(true));
    putDirectNamed(vm, config, "hasTracing"_s, jsBoolean(true));
    putDirectNamed(vm, config, "hasNodeOptions"_s, jsBoolean(true));
    putDirectNamed(vm, config, "hasInspector"_s, jsBoolean(true));
    putDirectNamed(vm, config, "noBrowserGlobals"_s, jsBoolean(false));
    putDirectNamed(vm, config, "bits"_s, jsNumber(64));
    return config;
}

JSValue createCryptoX509Object(JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto cryptoX509 = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 1);
    putDirectNamed(vm, cryptoX509, "isX509Certificate"_s, JSC::JSFunction::create(vm, globalObject, 1, String("isX509Certificate"_s), jsIsX509Certificate, ImplementationVisibility::Public));
    return cryptoX509;
}

JSC_DEFINE_HOST_FUNCTION(Process_functionBinding, (JSGlobalObject * jsGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(jsGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto globalObject = uncheckedDowncast<Zig::GlobalObject>(jsGlobalObject);
    auto process = globalObject->processObject();

    if (Bun__Node__ProcessPendingDeprecation && !process->m_warnedProcessBinding) {
        // Node latches DEP0111 once per Environment via deprecate(). Bun's own builtins call
        // process.binding() too (node uses internalBinding), so internal callers don't warn/latch.
        String callerURL;
        JSC::StackVisitor::visit(callFrame, vm, [&](JSC::StackVisitor& visitor) -> WTF::IterationStatus {
            if (Zig::isImplementationVisibilityPrivate(visitor))
                return WTF::IterationStatus::Continue;
            if (visitor->hasLineAndColumnInfo()) {
                callerURL = Zig::sourceURL(visitor);
                return WTF::IterationStatus::Done;
            }
            return WTF::IterationStatus::Continue;
        });
        bool isInternalCaller = callerURL.startsWith("node:"_s) || callerURL.startsWith("bun:"_s) || callerURL.startsWith("internal"_s);
        if (!isInternalCaller) {
            process->m_warnedProcessBinding = true;
            Process::emitWarning(globalObject,
                jsString(vm, String("process.binding() is deprecated. Please use public APIs instead."_s)),
                jsString(vm, String("DeprecationWarning"_s)),
                jsString(vm, String("DEP0111"_s)),
                jsUndefined());
            RETURN_IF_EXCEPTION(throwScope, {});
        }
    }

    auto moduleName = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    if (moduleName == "async_wrap"_s) PROCESS_BINDING_NOT_IMPLEMENTED("async_wrap");
    if (moduleName == "buffer"_s) return JSValue::encode(globalObject->processBindingBuffer());
    if (moduleName == "cares_wrap"_s) PROCESS_BINDING_NOT_IMPLEMENTED("cares_wrap");
    if (moduleName == "config"_s) return JSValue::encode(processBindingConfig(globalObject, vm));
    if (moduleName == "constants"_s) return JSValue::encode(globalObject->processBindingConstants());
    if (moduleName == "contextify"_s) PROCESS_BINDING_NOT_IMPLEMENTED("contextify");
    if (moduleName == "crypto"_s) PROCESS_BINDING_NOT_IMPLEMENTED("crypto");
    if (moduleName == "crypto/x509"_s) return JSValue::encode(createCryptoX509Object(globalObject));
    if (moduleName == "fs"_s) RELEASE_AND_RETURN(throwScope, JSValue::encode(globalObject->processBindingFs()));
    if (moduleName == "fs_event_wrap"_s) PROCESS_BINDING_NOT_IMPLEMENTED("fs_event_wrap");
    if (moduleName == "http_parser"_s) return JSValue::encode(globalObject->processBindingHTTPParser());
    if (moduleName == "icu"_s) PROCESS_BINDING_NOT_IMPLEMENTED("icu");
    if (moduleName == "inspector"_s) PROCESS_BINDING_NOT_IMPLEMENTED("inspector");
    if (moduleName == "js_stream"_s) PROCESS_BINDING_NOT_IMPLEMENTED("js_stream");
    if (moduleName == "natives"_s) return JSValue::encode(process->bindingNatives());
    if (moduleName == "os"_s) PROCESS_BINDING_NOT_IMPLEMENTED("os");
    if (moduleName == "pipe_wrap"_s) PROCESS_BINDING_NOT_IMPLEMENTED("pipe_wrap");
    if (moduleName == "process_wrap"_s) PROCESS_BINDING_NOT_IMPLEMENTED("process_wrap");
    if (moduleName == "signal_wrap"_s) PROCESS_BINDING_NOT_IMPLEMENTED("signal_wrap");
    if (moduleName == "spawn_sync"_s) PROCESS_BINDING_NOT_IMPLEMENTED("spawn_sync");
    if (moduleName == "stream_wrap"_s) PROCESS_BINDING_NOT_IMPLEMENTED_ISSUE("stream_wrap", "4957");
    if (moduleName == "tcp_wrap"_s) PROCESS_BINDING_NOT_IMPLEMENTED("tcp_wrap");
    if (moduleName == "tls_wrap"_s) PROCESS_BINDING_NOT_IMPLEMENTED("tls_wrap");
    if (moduleName == "tty_wrap"_s) return JSValue::encode(Bun::createNodeTTYWrapObject(globalObject));
    if (moduleName == "udp_wrap"_s) PROCESS_BINDING_NOT_IMPLEMENTED("udp_wrap");
    if (moduleName == "url"_s) PROCESS_BINDING_NOT_IMPLEMENTED("url");
    if (moduleName == "util"_s) RELEASE_AND_RETURN(throwScope, JSValue::encode(processBindingUtil(globalObject, vm)));
    if (moduleName == "uv"_s) return JSValue::encode(process->bindingUV());
    if (moduleName == "v8"_s) PROCESS_BINDING_NOT_IMPLEMENTED("v8");
    if (moduleName == "zlib"_s) PROCESS_BINDING_NOT_IMPLEMENTED("zlib");

    throwScope.throwException(globalObject, createError(globalObject, makeString("No such module: "_s, moduleName)));
    return {};
}

JSC_DEFINE_HOST_FUNCTION(Process_functionReallyExit, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    uint8_t exitCode = 0;
    JSValue arg0 = callFrame->argument(0);
    if (arg0.isAnyInt()) {
        exitCode = static_cast<uint8_t>(arg0.toInt32(globalObject) % 256);
        RETURN_IF_EXCEPTION(throwScope, {});
    }

    auto* zigGlobal = defaultGlobalObject(globalObject);
    // Node's reallyExit is the raw exit that does not run 'exit' listeners. Arm
    // m_isExiting so dispatchExitInternal (via Bun__Process__exit) skips them
    // while native shutdown (profiles, cleanup hooks, SQLite close) still runs.
    zigGlobal->processObject()->m_isExiting = true;
    Bun__Process__exit(zigGlobal, exitCode);
    // Main-thread Bun__Process__exit is noreturn. In a worker it returns; the
    // WebWorker exit path it called requests JSC termination (guarded so it's a
    // no-op when re-entered from a process.on('exit') handler).
    throwScope.release();
    return JSC::JSValue::encode(jsUndefined());
}

template<typename Visitor>
void Process::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    Process* thisObject = uncheckedDowncast<Process>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_uncaughtExceptionCaptureCallback);
    visitor.append(thisObject->m_nextTickFunction);
    visitor.append(thisObject->m_cachedCwd);
    visitor.append(thisObject->m_argv);
    visitor.append(thisObject->m_execArgv);
    visitor.append(thisObject->m_onWarning);

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
    Process* process = dynamicDowncast<Process>(thisValue);

    // Handle "var memoryUsage = process.memoryUsage; memoryUsage()"
    if (!process) [[unlikely]] {
        // Handle calling this function from inside a node:vm
        Zig::GlobalObject* zigGlobalObject = defaultGlobalObject(lexicalGlobalObject);

        return zigGlobalObject->processObject();
    }

    return process;
}

JSC_DEFINE_HOST_FUNCTION(Process_functionConstrainedMemory, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(jsNumber(WTF::ramSize()));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionResourceUsage, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

#if !OS(WINDOWS)
    struct rusage rusage;
    if (getrusage(RUSAGE_SELF, &rusage) != 0) {
        throwSystemError(throwScope, globalObject, "Failed to get resource usage"_s, "getrusage"_s, errno);
        return {};
    }
#else
    uv_rusage_t rusage;
    int err = uv_getrusage(&rusage);
    if (err) {
        throwSystemError(throwScope, globalObject, "uv_getrusage"_s, err);
        return {};
    }
#endif
    Process* process = getProcessObject(globalObject, callFrame->thisValue());

    Structure* resourceUsageStructure = process->resourceUsageStructure();
    JSObject* result = JSC::constructEmptyObject(vm, resourceUsageStructure);

    result->putDirectOffset(vm, 0, jsNumber(std::chrono::microseconds::period::den * rusage.ru_utime.tv_sec + rusage.ru_utime.tv_usec));
    result->putDirectOffset(vm, 1, jsNumber(std::chrono::microseconds::period::den * rusage.ru_stime.tv_sec + rusage.ru_stime.tv_usec));
#if OS(DARWIN)
    // ru_maxrss is bytes on darwin; Node reports kilobytes everywhere.
    result->putDirectOffset(vm, 2, jsNumber(rusage.ru_maxrss / 1024));
#else
    result->putDirectOffset(vm, 2, jsNumber(rusage.ru_maxrss));
#endif
    result->putDirectOffset(vm, 3, jsNumber(rusage.ru_ixrss));
    result->putDirectOffset(vm, 4, jsNumber(rusage.ru_idrss));
    result->putDirectOffset(vm, 5, jsNumber(rusage.ru_isrss));
    result->putDirectOffset(vm, 6, jsNumber(rusage.ru_minflt));
    result->putDirectOffset(vm, 7, jsNumber(rusage.ru_majflt));
    result->putDirectOffset(vm, 8, jsNumber(rusage.ru_nswap));
    result->putDirectOffset(vm, 9, jsNumber(rusage.ru_inblock));
    result->putDirectOffset(vm, 10, jsNumber(rusage.ru_oublock));
    result->putDirectOffset(vm, 11, jsNumber(rusage.ru_msgsnd));
    result->putDirectOffset(vm, 12, jsNumber(rusage.ru_msgrcv));
    result->putDirectOffset(vm, 13, jsNumber(rusage.ru_nsignals));
    result->putDirectOffset(vm, 14, jsNumber(rusage.ru_nvcsw));
    result->putDirectOffset(vm, 15, jsNumber(rusage.ru_nivcsw));

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(Process_functionCpuUsage, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
#if !OS(WINDOWS)
    struct rusage rusage;
    if (getrusage(RUSAGE_SELF, &rusage) != 0) {
        throwSystemError(throwScope, globalObject, "Failed to get CPU usage"_s, "getrusage"_s, errno);
        return {};
    }
#else
    uv_rusage_t rusage;
    int err = uv_getrusage(&rusage);
    if (err) {
        throwSystemError(throwScope, globalObject, "Failed to get CPU usage"_s, "uv_getrusage"_s, err);
        return {};
    }
#endif

    auto* process = getProcessObject(globalObject, callFrame->thisValue());

    Structure* cpuUsageStructure = process->cpuUsageStructure();

    double user = std::chrono::microseconds::period::den * rusage.ru_utime.tv_sec + rusage.ru_utime.tv_usec;
    double system = std::chrono::microseconds::period::den * rusage.ru_stime.tv_sec + rusage.ru_stime.tv_usec;

    if (callFrame->argumentCount() > 0) {
        JSValue comparatorValue = callFrame->argument(0);
        if (!comparatorValue.isUndefined()) {
            JSC::JSObject* comparator = comparatorValue.getObject();
            if (!comparator) [[unlikely]] {
                return Bun::ERR::INVALID_ARG_TYPE(throwScope, globalObject, "prevValue"_s, "object"_s, comparatorValue);
            }

            JSValue userValue;
            JSValue systemValue;

            if (comparator->structureID() == cpuUsageStructure->id()) [[likely]] {
                userValue = comparator->getDirect(0);
                systemValue = comparator->getDirect(1);
            } else {
                userValue = comparator->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "user"_s));
                RETURN_IF_EXCEPTION(throwScope, {});
                if (userValue.isEmpty()) userValue = jsUndefined();

                systemValue = comparator->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "system"_s));
                RETURN_IF_EXCEPTION(throwScope, {});
                if (systemValue.isEmpty()) systemValue = jsUndefined();
            }

            Bun::V::validateNumber(throwScope, globalObject, userValue, "prevValue.user"_s, jsUndefined(), jsUndefined());
            RETURN_IF_EXCEPTION(throwScope, {});

            Bun::V::validateNumber(throwScope, globalObject, systemValue, "prevValue.system"_s, jsUndefined(), jsUndefined());
            RETURN_IF_EXCEPTION(throwScope, {});

            double userComparator = userValue.toNumber(globalObject);
            RETURN_IF_EXCEPTION(throwScope, {});
            double systemComparator = systemValue.toNumber(globalObject);
            RETURN_IF_EXCEPTION(throwScope, {});

            if (!(userComparator >= 0 && userComparator <= JSC::maxSafeInteger())) {
                return Bun::ERR::INVALID_ARG_VALUE_RangeError(throwScope, globalObject, "prevValue.user"_s, userValue, "is invalid"_s);
            }

            if (!(systemComparator >= 0 && systemComparator <= JSC::maxSafeInteger())) {
                return Bun::ERR::INVALID_ARG_VALUE_RangeError(throwScope, globalObject, "prevValue.system"_s, systemValue, "is invalid"_s);
            }

            user -= userComparator;
            system -= systemComparator;
        }
    }

    JSC::JSObject* result = JSC::constructEmptyObject(vm, cpuUsageStructure);
    RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));

    result->putDirectOffset(vm, 0, JSC::jsNumber(user));
    result->putDirectOffset(vm, 1, JSC::jsNumber(system));

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(result));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionThreadCpuUsage, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    double userComparator = 0;
    double systemComparator = 0;
    JSValue prevValue = callFrame->argument(0);
    if (!prevValue.isUndefined()) {
        Bun::V::validateObject(throwScope, globalObject, prevValue, "prevValue"_s);
        RETURN_IF_EXCEPTION(throwScope, {});
        JSC::JSObject* comparator = prevValue.getObject();

        JSValue userValue = comparator->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "user"_s));
        RETURN_IF_EXCEPTION(throwScope, {});
        if (userValue.isEmpty()) userValue = jsUndefined();
        JSValue systemValue = comparator->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "system"_s));
        RETURN_IF_EXCEPTION(throwScope, {});
        if (systemValue.isEmpty()) systemValue = jsUndefined();

        if (!(userValue.isNumber() && userValue.asNumber() >= 0 && userValue.asNumber() <= JSC::maxSafeInteger())) {
            if (!userValue.isNumber())
                return Bun::ERR::INVALID_ARG_TYPE(throwScope, globalObject, "prevValue.user"_s, "number"_s, userValue);
            return Bun::ERR::INVALID_ARG_VALUE_RangeError(throwScope, globalObject, "prevValue.user"_s, userValue, "is invalid"_s);
        }
        if (!(systemValue.isNumber() && systemValue.asNumber() >= 0 && systemValue.asNumber() <= JSC::maxSafeInteger())) {
            if (!systemValue.isNumber())
                return Bun::ERR::INVALID_ARG_TYPE(throwScope, globalObject, "prevValue.system"_s, "number"_s, systemValue);
            return Bun::ERR::INVALID_ARG_VALUE_RangeError(throwScope, globalObject, "prevValue.system"_s, systemValue, "is invalid"_s);
        }
        userComparator = userValue.asNumber();
        systemComparator = systemValue.asNumber();
    }

    double user = 0;
    double system = 0;
#if OS(DARWIN)
    mach_msg_type_number_t count = THREAD_BASIC_INFO_COUNT;
    thread_basic_info_data_t info;
    thread_act_t thread = mach_thread_self();
    kern_return_t kr = thread_info(thread, THREAD_BASIC_INFO, reinterpret_cast<thread_info_t>(&info), &count);
    mach_port_deallocate(mach_task_self(), thread);
    if (kr != KERN_SUCCESS) {
        throwSystemError(throwScope, globalObject, "Failed to get thread CPU usage"_s, "thread_info"_s, kr);
        return {};
    }
    user = 1e6 * info.user_time.seconds + info.user_time.microseconds;
    system = 1e6 * info.system_time.seconds + info.system_time.microseconds;
#elif OS(LINUX) || OS(FREEBSD)
    // FreeBSD has supported RUSAGE_THREAD since 8.1; the #else branch must
    // stay Windows-only because uv_getrusage_thread is an aborting stub in
    // uv-posix-stubs.c on the POSIX targets that link it.
    struct rusage threadUsage;
    if (getrusage(RUSAGE_THREAD, &threadUsage) != 0) {
        throwSystemError(throwScope, globalObject, "Failed to get thread CPU usage"_s, "getrusage"_s, errno);
        return {};
    }
    user = 1e6 * threadUsage.ru_utime.tv_sec + threadUsage.ru_utime.tv_usec;
    system = 1e6 * threadUsage.ru_stime.tv_sec + threadUsage.ru_stime.tv_usec;
#else
    uv_rusage_t threadUsage;
    int err = uv_getrusage_thread(&threadUsage);
    if (err) {
        throwSystemError(throwScope, globalObject, "Failed to get thread CPU usage"_s, "uv_getrusage_thread"_s, err);
        return {};
    }
    user = 1e6 * threadUsage.ru_utime.tv_sec + threadUsage.ru_utime.tv_usec;
    system = 1e6 * threadUsage.ru_stime.tv_sec + threadUsage.ru_stime.tv_usec;
#endif

    user -= userComparator;
    system -= systemComparator;

    auto* process = getProcessObject(globalObject, callFrame->thisValue());
    Structure* cpuUsageStructure = process->cpuUsageStructure();
    JSC::JSObject* result = JSC::constructEmptyObject(vm, cpuUsageStructure);
    RETURN_IF_EXCEPTION(throwScope, {});
    result->putDirectOffset(vm, 0, JSC::jsNumber(user));
    result->putDirectOffset(vm, 1, JSC::jsNumber(system));
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(result));
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
#elif defined(__FreeBSD__)
    // ru_maxrss is the high-water mark, not current RSS. Match Node/libuv:
    // sysctl({KERN_PROC_PID, getpid()}) → kinfo_proc.ki_rssize.
    int mib[4] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid() };
    struct kinfo_proc kinfo;
    size_t len = sizeof(kinfo);
    if (sysctl(mib, 4, &kinfo, &len, nullptr, 0) != 0)
        return errno;
    *rss = static_cast<size_t>(kinfo.ki_rssize) * static_cast<size_t>(getpagesize());
    return 0;
#elif OS(WINDOWS)
    return uv_resident_set_memory(rss);
#else
#error "Unknown platform"
#endif
}

JSC_DEFINE_HOST_FUNCTION(Process_functionMemoryUsage, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* process = getProcessObject(globalObject, callFrame->thisValue());

    size_t current_rss = 0;
    if (getRSS(&current_rss) != 0) {
        throwSystemError(throwScope, globalObject, "Failed to get memory usage"_s, "memoryUsage"_s, errno);
        return {};
    }

    JSC::JSObject* result = JSC::constructEmptyObject(vm, process->memoryUsageStructure());

    // Node.js:
    // {
    //    rss: 4935680,
    //    heapTotal: 1826816,
    //    heapUsed: 650472,
    //    external: 49879,
    //    arrayBuffers: 9386
    // }

    size_t heapTotal = vm.heap.blockBytesAllocated();
    result->putDirectOffset(vm, 0, JSC::jsNumber(current_rss));
    result->putDirectOffset(vm, 1, JSC::jsNumber(heapTotal));

    // heap.size() walks every block of the heap, so report the size JSC measured
    // at the end of the most recent collection instead. Nothing requests a
    // collection while Bun starts up, and until the first one nothing has been
    // freed either, so the whole heap counts as used. (external is measured by
    // collections too and stays 0 until then.)
    size_t heapUsed = WebCore::clientData(vm)->heapSizeAfterLastCollection();
    result->putDirectOffset(vm, 2, JSC::jsNumber(heapUsed ? heapUsed : heapTotal));

    result->putDirectOffset(vm, 3, JSC::jsNumber(vm.heap.extraMemorySize() + vm.heap.externalMemorySize()));

    // JSC won't count this number until vm.heap.addReference() is called.
    // That will only happen in cases like:
    // - new ArrayBuffer()
    // - new Uint8Array(42).buffer
    // - fs.readFile(path, "utf-8") (sometimes)
    // - ...
    //
    // But it won't happen in cases like:
    // - new Uint8Array(42)
    // - Buffer.alloc(42)
    // - new Uint8Array(42).slice()
    result->putDirectOffset(vm, 4, JSC::jsNumber(vm.heap.arrayBufferSize()));

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(result));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionMemoryUsageRSS, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    size_t current_rss = 0;
    if (getRSS(&current_rss) != 0) {
        throwSystemError(throwScope, globalObject, "Failed to get memory usage"_s, "memoryUsage"_s, errno);
        return {};
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsNumber(current_rss)));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionOpenStdin, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    Zig::GlobalObject* global = defaultGlobalObject(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto stdinValue = global->processObject()->getIfPropertyExists(globalObject, Identifier::fromString(vm, "stdin"_s));
    RETURN_IF_EXCEPTION(throwScope, {});
    if (stdinValue) {
        if (!stdinValue.isObject()) {
            throwTypeError(globalObject, throwScope, "stdin is not an object"_s);
            return {};
        }

        JSValue resumeValue = stdinValue.getObject()->getIfPropertyExists(globalObject, Identifier::fromString(vm, "resume"_s));
        RETURN_IF_EXCEPTION(throwScope, {});
        if (resumeValue && !resumeValue.isUndefinedOrNull()) {
            auto resumeFunction = dynamicDowncast<JSFunction>(resumeValue);
            if (!resumeFunction) [[unlikely]] {
                throwTypeError(globalObject, throwScope, "stdin.resume is not a function"_s);
                return {};
            }

            auto callData = getCallData(resumeFunction);

            MarkedArgumentBuffer args;
            JSC::profiledCall(globalObject, ProfilingReason::API, resumeFunction, callData, stdinValue, args);
            RETURN_IF_EXCEPTION(throwScope, {});
        }

        RELEASE_AND_RETURN(throwScope, JSValue::encode(stdinValue));
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));
}

JSC_DEFINE_HOST_FUNCTION(Process_ref, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue maybeRefable = callFrame->argument(0);
    if (maybeRefable.isUndefinedOrNull()) {
        return JSValue::encode(jsUndefined());
    }

    JSValue ref = maybeRefable.get(globalObject, Identifier::fromUid(vm.symbolRegistry().symbolForKey("nodejs.ref"_s)));
    RETURN_IF_EXCEPTION(scope, {});

    auto refBoolean = ref.toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (!refBoolean) {
        ref = maybeRefable.get(globalObject, Identifier::fromString(vm, "ref"_s));
        RETURN_IF_EXCEPTION(scope, {});
    }

    if (ref.isCallable()) {
        CallData callData = getCallData(ref);
        JSC::profiledCall(globalObject, ProfilingReason::API, ref, callData, maybeRefable, {});
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(Process_unref, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue maybeUnrefable = callFrame->argument(0);
    if (maybeUnrefable.isUndefinedOrNull()) {
        return JSValue::encode(jsUndefined());
    }

    JSValue unref = maybeUnrefable.get(globalObject, Identifier::fromUid(vm.symbolRegistry().symbolForKey("nodejs.unref"_s)));
    RETURN_IF_EXCEPTION(scope, {});

    auto unrefBoolean = unref.toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (!unrefBoolean) {
        unref = maybeUnrefable.get(globalObject, Identifier::fromString(vm, "unref"_s));
        RETURN_IF_EXCEPTION(scope, {});
    }

    if (unref.isCallable()) {
        CallData callData = getCallData(unref);
        JSC::profiledCall(globalObject, ProfilingReason::API, unref, callData, maybeUnrefable, {});
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(Process_stubEmptyFunction, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(Process_setSourceMapsEnabled, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue arg0 = callFrame->argument(0);
    if (!arg0.isBoolean()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "enabled"_s, "boolean"_s, arg0);
    }

    globalObject->processObject()->m_sourceMapsEnabled = arg0.toBoolean(globalObject);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(Process_stubFunctionReturningArray, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(JSC::constructEmptyArray(globalObject, nullptr));
}

static JSValue Process_stubEmptyArray(VM& vm, JSObject* processObject)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::JSArray* array = JSC::constructEmptyArray(processObject->globalObject(), nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    return array;
}

static JSValue constructMemoryUsage(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    JSC::JSFunction* memoryUsage = JSC::JSFunction::create(vm, globalObject, 0, String("memoryUsage"_s), Process_functionMemoryUsage, ImplementationVisibility::Public);

    JSC::JSFunction* rss = JSC::JSFunction::create(vm, globalObject, 0, String("rss"_s), Process_functionMemoryUsageRSS, ImplementationVisibility::Public);

    putDirectNamed(vm, memoryUsage, "rss"_s, rss);
    return memoryUsage;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionReportUncaughtException, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSValue arg0 = callFrame->argument(0);
    Bun__reportUnhandledError(globalObject, JSValue::encode(arg0));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(Process_functionFatalException, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    // Node-compat: process._fatalException(err, fromPromise) runs the uncaught-exception
    // machinery and returns whether a handler claimed the error. fromPromise selects
    // origin 'unhandledRejection' vs 'uncaughtException'.
    int isRejection = callFrame->argument(1).toBoolean(globalObject) ? 1 : 0;
    return JSValue::encode(jsBoolean(Bun__handleUncaughtException(globalObject, callFrame->argument(0), isRejection) > 0));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDrainMicrotaskQueue, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::getVM(globalObject).drainMicrotasks();
    return JSValue::encode(jsUndefined());
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
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(processObject->globalObject());
    auto* bun = globalObject->bunObject();
    auto& builtinNames = Bun::builtinNames(vm);
    JSValue mainValue = bun->get(globalObject, builtinNames.mainPublicName());
    RETURN_IF_EXCEPTION(scope, {});
    auto* requireMap = globalObject->requireMap();
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

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue nextTickFunction = JSC::profiledCall(globalObject, ProfilingReason::API, initializer, JSC::getCallData(initializer), globalObject->globalThis(), args);
    RETURN_IF_EXCEPTION(scope, {});
    if (nextTickFunction && nextTickFunction.isObject()) {
        this->m_nextTickFunction.set(vm, this, nextTickFunction.getObject());
    }

    return nextTickFunction;
}

static JSValue constructProcessNextTickFn(VM& vm, JSObject* processObject)
{
    JSGlobalObject* lexicalGlobalObject = processObject->globalObject();
    Zig::GlobalObject* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    return uncheckedDowncast<Process>(processObject)->constructNextTickFn(JSC::getVM(globalObject), globalObject);
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
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* object = constructEmptyObject(globalObject);

    // node:inspector serves a CDP endpoint, precise coverage and breakpoint
    // pausing; the long tail of CDP domains (Network, NodeWorker, Target,
    // tracing, DOMStorage, permissions) are not implemented yet.
    putDirectNamed(vm, object, "inspector"_s, jsBoolean(true));
#ifdef BUN_DEBUG
    putDirectNamed(vm, object, "debug"_s, jsBoolean(true));
#else
    putDirectNamed(vm, object, "debug"_s, jsBoolean(false));
#endif
    // lying
    putDirectNamed(vm, object, "uv"_s, jsBoolean(true));

    putDirectNamed(vm, object, "ipv6"_s, jsBoolean(true));
    putDirectNamed(vm, object, "tls_alpn"_s, jsBoolean(true));
    putDirectNamed(vm, object, "tls_sni"_s, jsBoolean(true));
    putDirectNamed(vm, object, "tls_ocsp"_s, jsBoolean(true));
    putDirectNamed(vm, object, "tls"_s, jsBoolean(true));
    putDirectNamed(vm, object, "cached_builtins"_s, jsBoolean(true));
    putDirectNamed(vm, object, "openssl_is_boringssl"_s, jsBoolean(true));
    putDirectNamed(vm, object, "quic"_s, jsBoolean(true));
    putDirectNamed(vm, object, "require_module"_s, jsBoolean(true));
    putDirectNamed(vm, object, "typescript"_s, jsString(vm, String("transform"_s)));

    RETURN_IF_EXCEPTION(scope, {});
    return object;
}

static uint16_t debugPort = 9229;

JSC_DEFINE_CUSTOM_GETTER(processDebugPort, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    return JSC::JSValue::encode(jsNumber(debugPort));
}

JSC_DEFINE_CUSTOM_SETTER(setProcessDebugPort, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = JSValue::decode(encodedValue);

    double port = value.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (std::isnan(port) || std::isinf(port)) {
        port = 0;
    }

    if ((port != 0 && port < 1024) || port > 65535) {
        throwNodeRangeError(globalObject, scope, "process.debugPort must be 0 or in range 1024 to 65535"_s);
        return false;
    }

    debugPort = floor(port);
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(processTitle, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
#if !OS(WINDOWS)
    auto* result = jsString(globalObject->vm(), Bun__Process__getTitle(globalObject).transferToWTFString());
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(result));
#else
    // When a title was explicitly set (`--title` CLI flag or a prior
    // `process.title = ...`), the store is authoritative — the console title
    // that uv_get_process_title reads is unavailable in console-less
    // processes (CI) and never reflects the CLI flag.
    if (Bun__Process__hasTitle()) {
        auto* result = jsString(vm, Bun__Process__getTitle(globalObject).transferToWTFString());
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, JSValue::encode(result));
    }

    char title[1024];
    title[0] = '\0'; // Initialize buffer to empty string
    if (uv_get_process_title(title, sizeof(title)) != 0 || title[0] == '\0') {
        RELEASE_AND_RETURN(scope, JSValue::encode(jsString(vm, String("bun"_s))));
    }

    auto* result = jsString(vm, WTF::String::fromUTF8(title));
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(result));
#endif
}

JSC_DEFINE_CUSTOM_SETTER(setProcessTitle, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, JSC::PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSObject* thisObject = dynamicDowncast<JSC::JSObject>(JSValue::decode(thisValue));
    JSC::JSString* jsString = dynamicDowncast<JSC::JSString>(JSValue::decode(value));
    if (!thisObject || !jsString) {
        return false;
    }
    WTF::String wtfStr = jsString->value(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
#if !OS(WINDOWS)
    BunString str = Bun::toString(wtfStr);
    Bun__Process__setTitle(globalObject, &str);
    return true;
#else
    // Update the store first so the getter reflects the assignment; the uv
    // call is best-effort (it fails in console-less processes).
    BunString str = Bun::toString(wtfStr);
    Bun__Process__setTitle(globalObject, &str);
    CString cstr = wtfStr.utf8();
    uv_set_process_title(cstr.data());
    return true;
#endif
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
    JSString* cwdStr = uncheckedDowncast<JSString>(JSValue::decode(cwd));
    processObject->setCachedCwd(vm, cwdStr);
    RELEASE_AND_RETURN(scope, cwdStr);
}

extern "C" EncodedJSValue Process__getCachedCwd(JSC::JSGlobalObject* globalObject)
{
    return JSValue::encode(getCachedCwd(globalObject));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionCwd, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(getCachedCwd(globalObject));
}

#if !OS(WINDOWS)
extern "C" bool CrashHandler__isCrashSignal(int signalNumber);

// kill(-1) never reaches the caller, not even when the caller's process group is 1, hence pid < -1.
static bool killReachesThisProcess(int pid, int ownPid)
{
    return pid == ownPid || pid == 0 || (pid < -1 && pid == -getpgrp());
}

// Same as process.abort(). forwardSignal as the disposition means a JS listener owns the signal.
static void bypassCrashHandlerForSelfSentSignal(int pid, int ownPid, int signalNumber)
{
    if (!CrashHandler__isCrashSignal(signalNumber) || !killReachesThisProcess(pid, ownPid))
        return;
    struct sigaction current;
    if (sigaction(signalNumber, nullptr, &current) != 0 || current.sa_handler == forwardSignal)
        return;
    restoreDefaultSignalDisposition(signalNumber);
}
#endif

JSC_DEFINE_HOST_FUNCTION(Process_functionReallyKill, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));

    if (callFrame->argumentCount() < 2) {
        throwVMError(globalObject, scope, "Not enough arguments"_s);
        return {};
    }

    int pid = callFrame->argument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    int signal = callFrame->argument(1).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

#if !OS(WINDOWS)
    int ownPid = getpid();
#else
    int ownPid = uv_os_getpid();
#endif
    // Node's Kill binding runs RunAtExit for a self-directed unhandled signal, so flush profiles
    // first. `signalToContextIdsMap` is mutated only on the main thread; workers never set
    // profiler configs, so skipping the flush there avoids a rehash race.
    if (signal > 0 && (pid == 0 || pid == -1 || pid == ownPid || pid == -ownPid)
        && !(Bun__isMainThreadVM() && signalToContextIdsMap && signalToContextIdsMap->contains(signal))) {
        Bun__writeProfilesBeforeSelfKill();
    }

#if !OS(WINDOWS)
    bypassCrashHandlerForSelfSentSignal(pid, ownPid, signal);
    int result = kill(pid, signal);
    if (result < 0)
        result = errno;
#else
    int result = uv_kill(pid, signal);
#endif

    RELEASE_AND_RETURN(scope, JSValue::encode(jsNumber(result)));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionKill, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    auto pid_value = callFrame->argument(0);

    // this is mimicking `if (pid != (pid | 0)) {`
    int pid = pid_value.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto eql = JSC::JSValue::equal(globalObject, pid_value, jsNumber(pid));
    RETURN_IF_EXCEPTION(scope, {});
    if (!eql) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "pid"_s, "number"_s, pid_value);
    }

    JSC::JSValue signalValue = callFrame->argument(1);
    int signal = SIGTERM;
    if (signalValue.isNumber()) {
        signal = signalValue.toInt32(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    } else if (signalValue.isString()) {
        loadSignalNumberMap();
        auto signalName = signalValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (auto num = signalNameToNumberMap->get(signalName)) {
            signal = num;
        } else {
            return Bun::ERR::UNKNOWN_SIGNAL(scope, globalObject, signalValue);
        }
        RETURN_IF_EXCEPTION(scope, {});
    } else if (!signalValue.isUndefinedOrNull()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "signal"_s, "string or number"_s, signalValue);
    }

    auto global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    auto& vm = JSC::getVM(global);
    JSValue _killFn = global->processObject()->get(globalObject, Identifier::fromString(vm, "_kill"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (!_killFn.isCallable()) {
        throwTypeError(globalObject, scope, "process._kill is not a function"_s);
        return {};
    }

    JSC::MarkedArgumentBuffer args;
    args.append(jsNumber(pid));
    args.append(jsNumber(signal));
    JSC::CallData callData = JSC::getCallData(_killFn);

    auto result = JSC::profiledCall(globalObject, ProfilingReason::API, _killFn, callData, globalObject->globalThis(), args);
    RETURN_IF_EXCEPTION(scope, {});

    auto err = result.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (err) {
        throwSystemError(scope, globalObject, "kill"_s, err);
        return {};
    }

    return JSValue::encode(jsBoolean(true));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionLoadBuiltinModule, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* zigGlobalObject = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    VM& vm = zigGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue id = callFrame->argument(0);
    if (!id.isString()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "moduleName"_s, "string"_s, id);
    }

    String idWtfStr = id.toWTFString(zigGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});
    BunString idStr = Bun::toString(idWtfStr);

    JSValue fetchResult = Bun::resolveAndFetchBuiltinModule(zigGlobalObject, &idStr);
    RETURN_IF_EXCEPTION(scope, {});
    if (fetchResult) {
        return JSC::JSValue::encode(fetchResult);
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(Process_functionEmitHelper, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    auto* process = zigGlobalObject->processObject();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto emit = process->get(globalObject, Identifier::fromString(vm, "emit"_s));
    RETURN_IF_EXCEPTION(scope, {});
    auto callData = JSC::getCallData(emit);
    if (callData.type == CallData::Type::None) {
        scope.throwException(globalObject, createNotAFunctionError(globalObject, emit));
        return {};
    }
    auto ret = JSC::call(globalObject, emit, callData, process, callFrame);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(ret);
}

static constexpr auto kInternalIpcPrefix = "NODE_"_s;

extern "C" void Process__emitMessageEvent(Zig::GlobalObject* global, EncodedJSValue value, EncodedJSValue handle)
{
    auto* process = global->processObject();
    auto& vm = JSC::getVM(global);

    auto& names = WebCore::builtinNames(vm);
    auto ident = vm.propertyNames->message;
    JSValue message = JSValue::decode(value);
    if (auto* object = message.getObject()) {
        JSValue cmd = object->getDirect(vm, names.cmdPublicName());
        if (cmd && cmd.isString()) {
            auto cmdString = JSC::asString(cmd)->tryGetValue();
            if (cmdString->length() > kInternalIpcPrefix.length() && cmdString->startsWith(kInternalIpcPrefix)) {
                ident = names.internalMessagePublicName();
            }
        }
    }

    if (process->wrapped().hasEventListeners(ident)) {
        JSC::MarkedArgumentBuffer args;
        args.append(message);
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

extern "C" void Process__emitMemoryPressureEvent(Zig::GlobalObject* global, int level)
{
    auto* process = global->processObject();
    auto& vm = JSC::getVM(global);
    auto ident = Identifier::fromString(vm, "memoryPressure"_s);
    if (process->wrapped().hasEventListeners(ident)) {
        JSC::MarkedArgumentBuffer args;
        // Level values match NOTE_MEMORYSTATUS_PRESSURE_WARN (2) / _CRITICAL (4).
        args.append(jsString(vm, level == 2 ? String("warning"_s) : String("critical"_s)));
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
  _eval                            processGetEval                                      CustomAccessor
  _getActiveHandles                Process_stubFunctionReturningArray                  Function 0
  _getActiveRequests               Process_stubFunctionReturningArray                  Function 0
  _kill                            Process_functionReallyKill                          Function 2
  _linkedBinding                   Process_stubEmptyFunction                           Function 0
  _preload_modules                 Process_stubEmptyArray                              PropertyCallback
  _rawDebug                        constructRawDebug                                   PropertyCallback
  _tickCallback                    Process_stubEmptyFunction                           Function 0
  abort                            Process_functionAbort                               Function 1
  allowedNodeEnvironmentFlags      constructAllowedNodeEnvironmentFlags                PropertyCallback
  loadEnvFile                      constructLoadEnvFile                                PropertyCallback
  finalization                     constructFinalization                               PropertyCallback
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
  threadCpuUsage                   Process_functionThreadCpuUsage                      Function 1
  cwd                              Process_functionCwd                                 Function 1
  debugPort                        processDebugPort                                    CustomAccessor
  disconnect                       constructProcessDisconnect                          PropertyCallback
  dlopen                           Process_functionDlopen                              Function 1
  emitWarning                      Process_emitWarning                                 Function 1
  env                              constructEnv                                        PropertyCallback
  execArgv                         processExecArgv                                     CustomAccessor
  execPath                         constructExecPath                                   PropertyCallback
  execve                           Process_functionExecve                              Function 3
  exit                             Process_functionExit                                Function 1
  exitCode                         processExitCode                                     CustomAccessor|DontDelete
  _fatalException                  Process_functionFatalException                      Function 1
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
  openStdin                        Process_functionOpenStdin                           Function 0
  pid                              constructPid                                        PropertyCallback
  platform                         constructPlatform                                   PropertyCallback
  ppid                             processPpid                                         CustomAccessor
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
  initgroups                       Process_functioninitgroups                          Function 2
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

    // Before the hook below: onDidChangeListeners loads the signal tables on any add.
    installDefaultWarningListener(vm);
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

    // No-op stubs Node only has on the main thread; a worker_threads Worker's process lacks them.
    if (!WebCore::clientData(vm)->isNodeWorkerVM()) {
        putDirectNativeFunction(vm, globalObject(), Identifier::fromString(vm, "_debugEnd"_s), 0, Process_stubEmptyFunction, ImplementationVisibility::Public, NoIntrinsic, 0);
        putDirectNativeFunction(vm, globalObject(), Identifier::fromString(vm, "_debugProcess"_s), 0, Process_stubEmptyFunction, ImplementationVisibility::Public, NoIntrinsic, 0);
        putDirectNativeFunction(vm, globalObject(), Identifier::fromString(vm, "_startProfilerIdleNotifier"_s), 0, Process_stubEmptyFunction, ImplementationVisibility::Public, NoIntrinsic, 0);
        putDirectNativeFunction(vm, globalObject(), Identifier::fromString(vm, "_stopProfilerIdleNotifier"_s), 0, Process_stubEmptyFunction, ImplementationVisibility::Public, NoIntrinsic, 0);
    }

    // Node's addReadOnlyProcessAlias: read-only so `process.noDeprecation = false`
    // is ignored, but a per-Process property — a Worker must not flip the main
    // thread. Unflagged it stays an ordinary undefined slot user code can set.
    constexpr unsigned readOnlyAlias = JSC::PropertyAttribute::ReadOnly | 0;
    if (Bun__Node__ProcessTraceWarnings)
        putDirect(vm, Identifier::fromString(vm, "traceProcessWarnings"_s), jsBoolean(true), readOnlyAlias);
    if (Bun__Node__ProcessTraceDeprecation)
        putDirect(vm, Identifier::fromString(vm, "traceDeprecation"_s), jsBoolean(true), readOnlyAlias);
    if (Bun__Node__ProcessThrowDeprecation)
        putDirect(vm, Identifier::fromString(vm, "throwDeprecation"_s), jsBoolean(true), readOnlyAlias);
    if (Bun__Node__ProcessNoDeprecation)
        putDirect(vm, Identifier::fromString(vm, "noDeprecation"_s), jsBoolean(true), readOnlyAlias);
    if (Bun__Node__ProcessPendingDeprecation)
        putDirect(vm, Identifier::fromString(vm, "pendingDeprecation"_s), jsBoolean(true), readOnlyAlias);
    if (Bun__Node__ProcessNoWarnings)
        putDirect(vm, Identifier::fromString(vm, "noProcessWarnings"_s), jsBoolean(true), readOnlyAlias);
}

} // namespace Bun
