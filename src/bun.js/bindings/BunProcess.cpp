#include "BunProcess.h"
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSMicrotask.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/NumberPrototype.h>
#include "CommonJSModuleRecord.h"
#include "JavaScriptCore/CatchScope.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/Protect.h"
#include "JavaScriptCore/PutPropertySlot.h"
#include "ScriptExecutionContext.h"
#include "headers-handwritten.h"
#include "node_api.h"
#include "ZigGlobalObject.h"
#include "headers.h"
#include "JSEnvironmentVariableMap.h"
#include "ImportMetaObject.h"
#include <sys/stat.h>
#include "ConsoleObject.h"
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/JSSet.h>
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include "wtf-bindings.h"

#include "ProcessBindingTTYWrap.h"
#include "wtf/text/ASCIILiteral.h"
#include "wtf/text/OrdinalNumber.h"

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
// Using the same typedef and define for `mode_t` and `umask` as node on windows.
// https://github.com/nodejs/node/blob/ad5e2dab4c8306183685973387829c2f69e793da/src/node_process_methods.cc#L29
#define umask _umask
typedef int mode_t;
#endif
#include "JSNextTickQueue.h"
#include "ProcessBindingUV.h"
#include "ProcessBindingNatives.h"

#if OS(LINUX)
#include <gnu/libc-version.h>
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

JSC_DECLARE_CUSTOM_SETTER(Process_setTitle);
JSC_DECLARE_CUSTOM_GETTER(Process_getArgv);
JSC_DECLARE_CUSTOM_SETTER(Process_setArgv);
JSC_DECLARE_CUSTOM_GETTER(Process_getTitle);
JSC_DECLARE_CUSTOM_GETTER(Process_getPID);
JSC_DECLARE_CUSTOM_GETTER(Process_getPPID);
JSC_DECLARE_HOST_FUNCTION(Process_functionCwd);
static bool processIsExiting = false;

extern "C" uint8_t Bun__getExitCode(void*);
extern "C" uint8_t Bun__setExitCode(void*, uint8_t);
extern "C" void* Bun__getVM();
extern "C" Zig::GlobalObject* Bun__getDefaultGlobal();
extern "C" bool Bun__GlobalObject__hasIPC(JSGlobalObject*);
extern "C" bool Bun__ensureProcessIPCInitialized(JSGlobalObject*);
extern "C" const char* Bun__githubURL;
BUN_DECLARE_HOST_FUNCTION(Bun__Process__send);
BUN_DECLARE_HOST_FUNCTION(Bun__Process__disconnect);

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
    auto* globalObject = processObject->globalObject();
    JSC::JSObject* object = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 23);

    object->putDirect(vm, JSC::Identifier::fromString(vm, "node"_s),
        JSC::JSValue(JSC::jsOwnedString(vm, makeAtomString(ASCIILiteral::fromLiteralUnsafe(REPORTED_NODEJS_VERSION)))));
    object->putDirect(
        vm, JSC::Identifier::fromString(vm, "bun"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__version)).substring(1))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "boringssl"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__versions_boringssl)))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "openssl"_s),
        // https://github.com/oven-sh/bun/issues/7921
        // BoringSSL is a fork of OpenSSL 1.1.0, so we can report OpenSSL 1.1.0
        JSC::JSValue(JSC::jsString(vm, String("1.1.0"_s), 0)));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "libarchive"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__versions_libarchive)))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "mimalloc"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__versions_mimalloc)))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "picohttpparser"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__versions_picohttpparser)))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "uwebsockets"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__versions_uws)))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "webkit"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__versions_webkit)))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "zig"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__versions_zig)))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "zlib"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__versions_zlib)))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "tinycc"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__versions_tinycc)))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "lolhtml"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__versions_lolhtml)))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "ares"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__versions_c_ares)))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "usockets"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__versions_usockets)))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "lshpack"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__versions_lshpack)))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "zstd"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(Bun__versions_zstd)))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "v8"_s), JSValue(JSC::jsString(vm, makeString("12.4.254.14-node.12"_s))), 0);
#if OS(WINDOWS)
    object->putDirect(vm, JSC::Identifier::fromString(vm, "uv"_s), JSValue(JSC::jsString(vm, String::fromLatin1(uv_version_string()))), 0);
#else
    object->putDirect(vm, JSC::Identifier::fromString(vm, "uv"_s), JSValue(JSC::jsString(vm, makeString("1.48.0"_s))), 0);
#endif
    object->putDirect(vm, JSC::Identifier::fromString(vm, "napi"_s), JSValue(JSC::jsString(vm, makeString("9"_s))), 0);

    object->putDirect(vm, JSC::Identifier::fromString(vm, "icu"_s), JSValue(JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(U_ICU_VERSION)))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "unicode"_s), JSValue(JSC::jsString(vm, makeString(ASCIILiteral::fromLiteralUnsafe(U_UNICODE_VERSION)))), 0);

    object->putDirect(vm, JSC::Identifier::fromString(vm, "modules"_s),
        JSC::JSValue(JSC::jsString(vm, makeString("115"_s))));

    return object;
}

static JSValue constructProcessReleaseObject(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    auto* release = JSC::constructEmptyObject(globalObject);

    // SvelteKit compatibility hack
    release->putDirect(vm, Identifier::fromString(vm, "name"_s), jsString(vm, WTF::String("node"_s)), 0);

    release->putDirect(vm, Identifier::fromString(vm, "lts"_s), jsBoolean(false), 0);
    release->putDirect(vm, Identifier::fromString(vm, "sourceUrl"_s), jsString(vm, WTF::String(std::span { Bun__githubURL, strlen(Bun__githubURL) })), 0);
    release->putDirect(vm, Identifier::fromString(vm, "headersUrl"_s), jsEmptyString(vm), 0);
    release->putDirect(vm, Identifier::fromString(vm, "libUrl"_s), jsEmptyString(vm), 0);

    return release;
}

static void dispatchExitInternal(JSC::JSGlobalObject* globalObject, Process* process, int exitCode)
{

    if (processIsExiting)
        return;
    processIsExiting = true;
    auto& emitter = process->wrapped();
    auto& vm = globalObject->vm();

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

JSC_DEFINE_CUSTOM_SETTER(Process_defaultSetter,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSC::VM& vm = globalObject->vm();

    JSC::JSObject* thisObject = JSC::jsDynamicCast<JSC::JSObject*>(JSValue::decode(thisValue));
    if (value)
        thisObject->putDirect(vm, propertyName, JSValue::decode(value), 0);

    return true;
}

extern "C" bool Bun__resolveEmbeddedNodeFile(void*, BunString*);
#if OS(WINDOWS)
extern "C" HMODULE Bun__LoadLibraryBunString(BunString*);
#endif

JSC_DEFINE_HOST_FUNCTION(Process_functionDlopen,
    (JSC::JSGlobalObject * globalObject_, JSC::CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject_);
    auto callCountAtStart = globalObject->napiModuleRegisterCallCount;
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSC::VM& vm = globalObject->vm();

    auto argCount = callFrame->argumentCount();
    if (argCount < 2) {
        JSC::throwTypeError(globalObject, scope, "dlopen requires 2 arguments"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSC::JSValue moduleValue = callFrame->uncheckedArgument(0);
    JSC::JSObject* moduleObject = jsDynamicCast<JSC::JSObject*>(moduleValue);
    if (UNLIKELY(!moduleObject)) {
        JSC::throwTypeError(globalObject, scope, "dlopen requires an object as first argument"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSValue exports = moduleObject->getIfPropertyExists(globalObject, builtinNames(vm).exportsPublicName());
    RETURN_IF_EXCEPTION(scope, {});

    if (UNLIKELY(!exports)) {
        JSC::throwTypeError(globalObject, scope, "dlopen requires an object with an exports property"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    globalObject->pendingNapiModule = exports;
    Strong<JSC::Unknown> strongExports;

    if (exports.isCell()) {
        strongExports = { vm, exports.asCell() };
    }

    Strong<JSC::JSObject> strongModule = { vm, moduleObject };

    WTF::String filename = callFrame->uncheckedArgument(1).toWTFString(globalObject);
    if (filename.isEmpty()) {
        JSC::throwTypeError(globalObject, scope, "dlopen requires a non-empty string as the second argument"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    if (filename.startsWith("file://"_s)) {
        WTF::URL fileURL = WTF::URL(filename);
        if (!fileURL.isValid() || !fileURL.protocolIsFile()) {
            JSC::throwTypeError(globalObject, scope, "invalid file: URL passed to dlopen"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        filename = fileURL.fileSystemPath();
    }

    // Support embedded .node files
    // See StandaloneModuleGraph.zig for what this "$bunfs" thing is
#if OS(WINDOWS)
#define StandaloneModuleGraph__base_path "B:/~BUN/"_s
#else
#define StandaloneModuleGraph__base_path "/$bunfs/"_s
#endif
    if (filename.startsWith(StandaloneModuleGraph__base_path)) {
        BunString bunStr = Bun::toString(filename);
        if (Bun__resolveEmbeddedNodeFile(globalObject->bunVM(), &bunStr)) {
            filename = bunStr.toWTFString(BunString::ZeroCopy);
        }
    }

    RETURN_IF_EXCEPTION(scope, {});
#if OS(WINDOWS)
    BunString filename_str = Bun::toString(filename);
    HMODULE handle = Bun__LoadLibraryBunString(&filename_str);
#else
    CString utf8 = filename.utf8();
    void* handle = dlopen(utf8.data(), RTLD_LAZY);
#endif

    if (!handle) {
#if OS(WINDOWS)
        DWORD errorId = GetLastError();
        LPWSTR messageBuffer = nullptr;
        size_t size = FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
            NULL, errorId, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT), (LPWSTR)&messageBuffer, 0, NULL);
        WTF::String msg = makeString("LoadLibrary failed: "_s, WTF::StringView(std::span { (UCHAR*)messageBuffer, size }));
        LocalFree(messageBuffer);
#else
        WTF::String msg = WTF::String::fromUTF8(dlerror());
#endif
        JSC::throwTypeError(globalObject, scope, msg);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    if (callCountAtStart != globalObject->napiModuleRegisterCallCount) {
        JSValue resultValue = globalObject->pendingNapiModule;
        globalObject->pendingNapiModule = JSValue {};
        globalObject->napiModuleRegisterCallCount = 0;

        RETURN_IF_EXCEPTION(scope, {});

        if (resultValue && resultValue != strongModule.get()) {
            if (resultValue.isCell() && resultValue.getObject()->isErrorInstance()) {
                JSC::throwException(globalObject, scope, resultValue);
                return JSC::JSValue::encode(JSC::JSValue {});
            }
        }

        return JSValue::encode(jsUndefined());
    }

    JSC::EncodedJSValue (*napi_register_module_v1)(JSC::JSGlobalObject* globalObject,
        JSC::EncodedJSValue exports);
#if OS(WINDOWS)
#define dlsym GetProcAddress
#endif

    napi_register_module_v1 = reinterpret_cast<JSC::EncodedJSValue (*)(JSC::JSGlobalObject*,
        JSC::EncodedJSValue)>(
        dlsym(handle, "napi_register_module_v1"));

#if OS(WINDOWS)
#undef dlsym
#endif

    if (!napi_register_module_v1) {
#if OS(WINDOWS)
        FreeLibrary(handle);
#else
        dlclose(handle);
#endif
        JSC::throwTypeError(globalObject, scope, "symbol 'napi_register_module_v1' not found in native module. Is this a Node API (napi) module?"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    EncodedJSValue exportsValue = JSC::JSValue::encode(exports);
    JSC::JSValue resultValue = JSValue::decode(napi_register_module_v1(globalObject, exportsValue));

    RETURN_IF_EXCEPTION(scope, {});

    // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/src/node_api.cc#L734-L742
    // https://github.com/oven-sh/bun/issues/1288
    if (!resultValue.isEmpty() && !scope.exception() && (!strongExports || resultValue != strongExports.get())) {
        PutPropertySlot slot(strongModule.get(), false);
        strongModule->put(strongModule.get(), globalObject, builtinNames(vm).exportsPublicName(), resultValue, slot);
    }

    return JSValue::encode(resultValue);
}

JSC_DEFINE_HOST_FUNCTION(Process_functionUmask,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    if (callFrame->argumentCount() == 0 || callFrame->argument(0).isUndefined()) {
        mode_t currentMask = umask(0);
        umask(currentMask);
        return JSC::JSValue::encode(JSC::jsNumber(currentMask));
    }

    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSValue numberValue = callFrame->argument(0);

    if (!numberValue.isNumber()) {
        throwTypeError(globalObject, throwScope, "The \"mask\" argument must be a number"_s);
        return JSValue::encode({});
    }

    if (!numberValue.isAnyInt()) {
        throwNodeRangeError(globalObject, throwScope, "The \"mask\" argument must be an integer"_s);
        return JSValue::encode({});
    }

    double number = numberValue.toNumber(globalObject);
    int64_t newUmask = isInt52(number) ? tryConvertToInt52(number) : numberValue.toInt32(globalObject);
    RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::JSValue {}));
    if (newUmask < 0 || newUmask > 4294967295) {
        StringBuilder messageBuilder;
        messageBuilder.append("The \"mask\" value must be in range [0, 4294967295]. Received value: "_s);
        messageBuilder.append(int52ToString(vm, newUmask, 10)->getString(globalObject));
        throwNodeRangeError(globalObject, throwScope, messageBuilder.toString());
        return JSValue::encode({});
    }

    return JSC::JSValue::encode(JSC::jsNumber(umask(newUmask)));
}

extern "C" uint64_t Bun__readOriginTimer(void*);
extern "C" double Bun__readOriginTimerStart(void*);

// https://github.com/nodejs/node/blob/1936160c31afc9780e4365de033789f39b7cbc0c/src/api/hooks.cc#L49
extern "C" void Process__dispatchOnBeforeExit(Zig::GlobalObject* globalObject, uint8_t exitCode)
{
    if (!globalObject->hasProcessObject()) {
        return;
    }

    auto* process = jsCast<Process*>(globalObject->processObject());
    MarkedArgumentBuffer arguments;
    arguments.append(jsNumber(exitCode));
    process->wrapped().emit(Identifier::fromString(globalObject->vm(), "beforeExit"_s), arguments);
}

extern "C" void Process__dispatchOnExit(Zig::GlobalObject* globalObject, uint8_t exitCode)
{
    if (!globalObject->hasProcessObject()) {
        return;
    }

    auto* process = jsCast<Process*>(globalObject->processObject());
    dispatchExitInternal(globalObject, process, exitCode);
}

JSC_DEFINE_HOST_FUNCTION(Process_functionUptime,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject_ = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    double now = static_cast<double>(Bun__readOriginTimer(globalObject_->bunVM()));
    double result = (now / 1000000.0) / 1000.0;
    return JSC::JSValue::encode(JSC::jsNumber(result));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionExit,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto throwScope = DECLARE_THROW_SCOPE(globalObject->vm());
    uint8_t exitCode = 0;
    JSValue arg0 = callFrame->argument(0);
    if (arg0.isAnyInt()) {
        int extiCode32 = arg0.toInt32(globalObject) % 256;
        RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::JSValue {}));

        exitCode = static_cast<uint8_t>(extiCode32);
    } else if (!arg0.isUndefinedOrNull()) {
        throwTypeError(globalObject, throwScope, "The \"code\" argument must be an integer"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    } else {
        exitCode = Bun__getExitCode(Bun__getVM());
    }

    auto* zigGlobal = jsDynamicCast<Zig::GlobalObject*>(globalObject);
    if (UNLIKELY(!zigGlobal)) {
        zigGlobal = Bun__getDefaultGlobal();
    }

    Process__dispatchOnExit(zigGlobal, exitCode);
    Bun__Process__exit(zigGlobal, exitCode);
    return JSC::JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(Process_setUncaughtExceptionCaptureCallback,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto throwScope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSValue arg0 = callFrame->argument(0);
    if (!arg0.isCallable() && !arg0.isNull()) {
        throwTypeError(globalObject, throwScope, "The \"callback\" argument must be callable or null"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    auto* zigGlobal = jsDynamicCast<Zig::GlobalObject*>(globalObject);
    if (UNLIKELY(!zigGlobal)) {
        zigGlobal = Bun__getDefaultGlobal();
    }
    jsCast<Process*>(zigGlobal->processObject())->setUncaughtExceptionCaptureCallback(arg0);
    return JSC::JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(Process_hasUncaughtExceptionCaptureCallback,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* zigGlobal = jsDynamicCast<Zig::GlobalObject*>(globalObject);
    if (UNLIKELY(!zigGlobal)) {
        zigGlobal = Bun__getDefaultGlobal();
    }
    JSValue cb = jsCast<Process*>(zigGlobal->processObject())->getUncaughtExceptionCaptureCallback();
    if (cb.isEmpty() || !cb.isCell()) {
        return JSValue::encode(jsBoolean(false));
    }

    return JSValue::encode(jsBoolean(true));
}

extern "C" uint64_t Bun__readOriginTimer(void*);

JSC_DEFINE_HOST_FUNCTION(Process_functionHRTime,
    (JSC::JSGlobalObject * globalObject_, JSC::CallFrame* callFrame))
{

    Zig::GlobalObject* globalObject
        = reinterpret_cast<Zig::GlobalObject*>(globalObject_);
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    uint64_t time = Bun__readOriginTimer(globalObject->bunVM());
    int64_t seconds = static_cast<int64_t>(time / 1000000000);
    int64_t nanoseconds = time % 1000000000;

    if (callFrame->argumentCount() > 0) {
        JSC::JSValue arg0 = callFrame->uncheckedArgument(0);
        if (!arg0.isUndefinedOrNull()) {
            JSArray* relativeArray = JSC::jsDynamicCast<JSC::JSArray*>(arg0);
            if ((!relativeArray && !arg0.isUndefinedOrNull()) || relativeArray->length() < 2) {
                JSC::throwTypeError(globalObject, throwScope, "hrtime() argument must be an array or undefined"_s);
                return JSC::JSValue::encode(JSC::JSValue {});
            }
            JSValue relativeSecondsValue = relativeArray->getIndexQuickly(0);
            JSValue relativeNanosecondsValue = relativeArray->getIndexQuickly(1);
            if (!relativeSecondsValue.isNumber() || !relativeNanosecondsValue.isNumber()) {
                JSC::throwTypeError(globalObject, throwScope, "hrtime() argument must be an array of 2 integers"_s);
                return JSC::JSValue::encode(JSC::JSValue {});
            }

            int64_t relativeSeconds = JSC__JSValue__toInt64(JSC::JSValue::encode(relativeSecondsValue));
            int64_t relativeNanoseconds = JSC__JSValue__toInt64(JSC::JSValue::encode(relativeNanosecondsValue));
            seconds -= relativeSeconds;
            nanoseconds -= relativeNanoseconds;
            if (nanoseconds < 0) {
                seconds--;
                nanoseconds += 1000000000;
            }
        }
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

    if (UNLIKELY(!array)) {
        JSC::throwOutOfMemoryError(globalObject, throwScope);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(array));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionHRTimeBigInt,
    (JSC::JSGlobalObject * globalObject_, JSC::CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject_);
    return JSC::JSValue::encode(JSValue(JSC::JSBigInt::createFrom(globalObject, Bun__readOriginTimer(globalObject->bunVM()))));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionChdir,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    ZigString str = ZigString { nullptr, 0 };
    if (callFrame->argumentCount() > 0) {
        str = Zig::toZigString(callFrame->uncheckedArgument(0).toWTFString(globalObject));
    }

    JSC::JSValue result = JSC::JSValue::decode(Bun__Process__setCwd(globalObject, &str));
    JSC::JSObject* obj = result.getObject();
    if (UNLIKELY(obj != nullptr && obj->isErrorInstance())) {
        scope.throwException(globalObject, obj);
        return JSValue::encode(JSC::jsUndefined());
    }

    scope.release();

    return JSC::JSValue::encode(result);
}

static HashMap<String, int>* signalNameToNumberMap = nullptr;
static HashMap<int, String>* signalNumberToNameMap = nullptr;

// On windows, signals need to have a handle to the uv_signal_t. When sigaction is used, this is kept track globally for you.
struct SignalHandleValue {
#if OS(WINDOWS)
    uv_signal_t* handle;
#endif
};
static HashMap<int, SignalHandleValue>* signalToContextIdsMap = nullptr;

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

static void loadSignalNumberMap()
{

    static std::once_flag signalNameToNumberMapOnceFlag;
    std::call_once(signalNameToNumberMapOnceFlag, [] {
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
    if (UNLIKELY(signalNumberToNameMap->find(signalNumber) == signalNumberToNameMap->end()))
        return;

    auto* context = ScriptExecutionContext::getMainThreadScriptExecutionContext();
    if (UNLIKELY(!context))
        return;

    // signal handlers can be run on any thread
    context->postTaskConcurrently([signalNumber](ScriptExecutionContext& context) {
        JSGlobalObject* lexicalGlobalObject = context.jsGlobalObject();
        Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

        Process* process = jsCast<Process*>(globalObject->processObject());

        String signalName = signalNumberToNameMap->get(signalNumber);
        Identifier signalNameIdentifier = Identifier::fromString(globalObject->vm(), signalName);
        MarkedArgumentBuffer args;
        args.append(jsString(globalObject->vm(), signalNameIdentifier.string()));
        args.append(jsNumber(signalNumber));
        // TODO(@paperdave): add an ASSERT(isMainThread());
        // This should be true on posix if I understand sigaction right
        // On Windows it should be true if the uv_signal is created on the main thread's loop
        //
        // I would like to assert this because if that assumption is not true,
        // this call will probably cause very confusing bugs.
        process->wrapped().emitForBindings(signalNameIdentifier, args);
    });
};

extern "C" void Bun__logUnhandledException(JSC::EncodedJSValue exception);

extern "C" int Bun__handleUncaughtException(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue exception, int isRejection)
{
    if (!lexicalGlobalObject->inherits(Zig::GlobalObject::info()))
        return false;
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto* process = jsCast<Process*>(globalObject->processObject());
    auto& wrapped = process->wrapped();
    auto& vm = globalObject->vm();

    MarkedArgumentBuffer args;
    args.append(exception);
    if (isRejection) {
        args.append(jsString(vm, String("unhandledRejection"_s)));
    } else {
        args.append(jsString(vm, String("uncaughtException"_s)));
    }

    auto uncaughtExceptionMonitor = Identifier::fromString(globalObject->vm(), "uncaughtExceptionMonitor"_s);
    if (wrapped.listenerCount(uncaughtExceptionMonitor) > 0) {
        wrapped.emit(uncaughtExceptionMonitor, args);
    }

    auto uncaughtExceptionIdent = Identifier::fromString(globalObject->vm(), "uncaughtException"_s);

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

extern "C" int Bun__handleUnhandledRejection(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue reason, JSC::JSValue promise)
{
    if (!lexicalGlobalObject->inherits(Zig::GlobalObject::info()))
        return false;
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto* process = jsCast<Process*>(globalObject->processObject());
    MarkedArgumentBuffer args;
    args.append(reason);
    args.append(promise);
    auto eventType = Identifier::fromString(globalObject->vm(), "unhandledRejection"_s);
    auto& wrapped = process->wrapped();
    if (wrapped.listenerCount(eventType) > 0) {
        wrapped.emit(eventType, args);
        return true;
    } else {
        return false;
    }
}

static void onDidChangeListeners(EventEmitter& eventEmitter, const Identifier& eventName, bool isAdded)
{
    if (eventEmitter.scriptExecutionContext()->isMainThread()) {
        // IPC handlers
        if (eventName.string() == "message"_s) {
            if (isAdded) {
                auto* global = eventEmitter.scriptExecutionContext()->jsGlobalObject();
                if (Bun__GlobalObject__hasIPC(global)
                    && eventEmitter.listenerCount(eventName) == 1) {
                    Bun__ensureProcessIPCInitialized(global);
                    eventEmitter.scriptExecutionContext()->refEventLoop();
                    eventEmitter.m_hasIPCRef = true;
                }
            } else {
                if (eventEmitter.listenerCount(eventName) == 0 && eventEmitter.m_hasIPCRef) {
                    eventEmitter.scriptExecutionContext()->unrefEventLoop();
                }
            }
            return;
        }

        // Signal Handlers
        loadSignalNumberMap();
        static std::once_flag signalNumberToNameMapOnceFlag;
        std::call_once(signalNumberToNameMapOnceFlag, [] {
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
#if !OS(WINDOWS)
            if (signalNumber != SIGKILL && signalNumber != SIGSTOP) {
#else
            if (signalNumber != SIGKILL) { // windows has no SIGSTOP
#endif

                if (isAdded) {
                    if (!signalToContextIdsMap->contains(signalNumber)) {
                        SignalHandleValue signal_handle = {
#if OS(WINDOWS)
                            .handle = nullptr,
#endif
                        };
#if !OS(WINDOWS)
                        struct sigaction action;
                        memset(&action, 0, sizeof(struct sigaction));

                        // Set the handler in the action struct
                        action.sa_handler = signalHandler;

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

                        if (UNLIKELY(!signal_handle.handle))
                            return;
#endif

                        signalToContextIdsMap->set(signalNumber, signal_handle);
                    }
                } else {
                    if (signalToContextIdsMap->find(signalNumber) != signalToContextIdsMap->end()) {

#if !OS(WINDOWS)
                        signal(signalNumber, SIG_DFL);
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

JSC_DEFINE_HOST_FUNCTION(Process_functionAbort, (JSGlobalObject * globalObject, CallFrame*))
{
    abort();
}

JSC_DEFINE_HOST_FUNCTION(Process_emitWarning, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        throwVMError(globalObject, scope, "Not enough arguments"_s);
        return JSValue::encode(jsUndefined());
    }

    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    auto* process = jsCast<Process*>(globalObject->processObject());

    JSObject* errorInstance = ([&]() -> JSObject* {
        JSValue arg0 = callFrame->uncheckedArgument(0);
        if (!arg0.isEmpty() && arg0.isCell() && arg0.asCell()->type() == ErrorInstanceType) {
            return arg0.getObject();
        }

        WTF::String str = arg0.toWTFString(globalObject);
        return createError(globalObject, str);
    })();

    errorInstance->putDirect(vm, Identifier::fromString(vm, "name"_s), jsString(vm, String("warn"_s)), JSC::PropertyAttribute::DontEnum | 0);

    auto ident = Identifier::fromString(vm, "warning"_s);
    if (process->wrapped().hasEventListeners(ident)) {
        JSC::MarkedArgumentBuffer args;
        args.append(errorInstance);

        process->wrapped().emit(ident, args);
        return JSValue::encode(jsUndefined());
    }

    auto jsArgs = JSValue::encode(errorInstance);
    Bun__ConsoleObject__messageWithTypeAndLevel(reinterpret_cast<Bun::ConsoleObject*>(globalObject->consoleClient().get())->m_client, static_cast<uint32_t>(MessageType::Log),
        static_cast<uint32_t>(MessageLevel::Warning), globalObject, &jsArgs, 1);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(processExitCode, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName name))
{
    Process* process = jsDynamicCast<Process*>(JSValue::decode(thisValue));
    if (!process) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsNumber(Bun__getExitCode(jsCast<Zig::GlobalObject*>(process->globalObject())->bunVM())));
}
JSC_DEFINE_CUSTOM_SETTER(setProcessExitCode, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, JSC::PropertyName))
{
    Process* process = jsDynamicCast<Process*>(JSValue::decode(thisValue));
    if (!process) {
        return false;
    }

    auto throwScope = DECLARE_THROW_SCOPE(process->vm());
    JSValue exitCode = JSValue::decode(value);
    if (!exitCode.isAnyInt()) {
        throwTypeError(lexicalGlobalObject, throwScope, "exitCode must be an integer"_s);
        return false;
    }

    int exitCodeInt = exitCode.toInt32(lexicalGlobalObject) % 256;
    RETURN_IF_EXCEPTION(throwScope, false);

    void* ptr = jsCast<Zig::GlobalObject*>(process->globalObject())->bunVM();
    Bun__setExitCode(ptr, static_cast<uint8_t>(exitCodeInt));

    return true;
}

JSC_DEFINE_CUSTOM_GETTER(processConnected, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName name))
{
    Process* process = jsDynamicCast<Process*>(JSValue::decode(thisValue));
    if (!process) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsBoolean(Bun__GlobalObject__hasIPC(process->globalObject())));
}
JSC_DEFINE_CUSTOM_SETTER(setProcessConnected, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, JSC::PropertyName))
{
    return false;
}

static JSValue constructReportObjectComplete(VM& vm, Zig::GlobalObject* globalObject, const String& fileName)
{
#if !OS(WINDOWS)
    // macOS output:
    // {
    //   header: {
    //     reportVersion: 3,
    //     event: 'JavaScript API',
    //     trigger: 'GetReport',
    //     filename: null,
    //     dumpEventTime: '2023-11-16T17:56:55Z',
    //     dumpEventTimeStamp: '1700186215013',
    //     processId: 18234,
    //     threadId: 0,
    //     cwd: '/Users/jarred/Code/bun',
    //     commandLine: [ 'node' ],
    //     nodejsVersion: 'v20.8.0',
    //     wordSize: 64,
    //     arch: 'arm64',
    //     platform: 'darwin',
    //     componentVersions: process.versions,
    //     release: {
    //       name: 'node',
    //       headersUrl: 'https://nodejs.org/download/release/v20.8.0/node-v20.8.0-headers.tar.gz',
    //       sourceUrl: 'https://nodejs.org/download/release/v20.8.0/node-v20.8.0.tar.gz'
    //     },
    //     osName: 'Darwin',
    //     osRelease: '22.6.0',
    //     osVersion: 'Darwin Kernel Version 22.6.0: Wed Jul  5 22:22:05 PDT 2023; root:xnu-8796.141.3~6/RELEASE_ARM64_T6000',
    //     osMachine: 'arm64',
    //     cpus: [],
    //     networkInterfaces: [],
    //     host: 'macbook.local'
    //   },
    //   javascriptStack: {
    //     message: 'Error [ERR_SYNTHETIC]: JavaScript Callstack',
    //     stack: [
    //       'at new NodeError (node:internal/errors:406:5)',
    //       'at Object.getReport (node:internal/process/report:36:13)',
    //       'at REPL68:1:16',
    //       'at Script.runInThisContext (node:vm:122:12)',
    //       'at REPLServer.defaultEval (node:repl:594:29)',
    //       'at bound (node:domain:432:15)',
    //       'at REPLServer.runBound [as eval] (node:domain:443:12)',
    //       'at REPLServer.onLine (node:repl:924:10)',
    //       'at REPLServer.emit (node:events:526:35)'
    //     ],
    //     errorProperties: { code: 'ERR_SYNTHETIC' }
    //   },
    //   javascriptHeap: {
    //     totalMemory: 5734400,
    //     executableMemory: 524288,
    //     totalCommittedMemory: 4931584,
    //     availableMemory: 4341838112,
    //     totalGlobalHandlesMemory: 8192,
    //     usedGlobalHandlesMemory: 8000,
    //     usedMemory: 4304384,
    //     memoryLimit: 4345298944,
    //     mallocedMemory: 147560,
    //     externalMemory: 2152593,
    //     peakMallocedMemory: 892416,
    //     nativeContextCount: 1,
    //     detachedContextCount: 0,
    //     doesZapGarbage: 0,
    //     heapSpaces: {
    //       read_only_space: [Object],
    //       new_space: [Object],
    //       old_space: [Object],
    //       code_space: [Object],
    //       shared_space: [Object],
    //       new_large_object_space: [Object],
    //       large_object_space: [Object],
    //       code_large_object_space: [Object],
    //       shared_large_object_space: [Object]
    //     }
    //   },
    //   nativeStack: [
    //     {
    //       pc: '0x0000000105293a44',
    //       symbol: 'node::GetNodeReport(node::Environment*, char const*, char const*, v8::Local<v8::Value>, std::__1::basic_ostream<char, std::__1::char_traits<char>>&) [/opt/homebrew/Cellar/node/20.8.0/bin/node]'
    //     },
    //   ],
    //   resourceUsage: {
    //     free_memory: 14188216320,
    //     total_memory: 68719476736,
    //     rss: 40009728,
    //     available_memory: 14188216320,
    //     userCpuSeconds: 0.244133,
    //     kernelCpuSeconds: 0.058853,
    //     cpuConsumptionPercent: 1.16533,
    //     userCpuConsumptionPercent: 0.938973,
    //     kernelCpuConsumptionPercent: 0.226358,
    //     maxRss: 41697280,
    //     pageFaults: { IORequired: 1465, IONotRequired: 1689 },
    //     fsActivity: { reads: 0, writes: 0 }
    //   },
    //   libuv: [],
    //   workers: [],
    //   environmentVariables: {
    //     PATH: '',
    //   },
    //   userLimits: {
    //     core_file_size_blocks: { soft: 0, hard: 'unlimited' },
    //     data_seg_size_kbytes: { soft: 'unlimited', hard: 'unlimited' },
    //     file_size_blocks: { soft: 'unlimited', hard: 'unlimited' },
    //     max_locked_memory_bytes: { soft: 'unlimited', hard: 'unlimited' },
    //     max_memory_size_kbytes: { soft: 'unlimited', hard: 'unlimited' },
    //     open_files: { soft: 2147483646, hard: 2147483646 },
    //     stack_size_bytes: { soft: 8372224, hard: 67092480 },
    //     cpu_time_seconds: { soft: 'unlimited', hard: 'unlimited' },
    //     max_user_processes: { soft: 10666, hard: 16000 },
    //     virtual_memory_kbytes: { soft: 'unlimited', hard: 'unlimited' }
    //   },
    //   sharedObjects: [
    //     '/opt/homebrew/Cellar/node/20.8.0/bin/node',
    //   ]

    // linux:
    // {
    //   header: {
    //     reportVersion: 3,
    //     event: 'JavaScript API',
    //     trigger: 'GetReport',
    //     filename: null,
    //     dumpEventTime: '2023-11-16T18:41:38Z',
    //     dumpEventTimeStamp: '1700188898941',
    //     processId: 1621753,
    //     threadId: 0,
    //     cwd: '/home/jarred',
    //     commandLine: [ 'node' ],
    //     nodejsVersion: 'v20.5.0',
    //     glibcVersionRuntime: '2.35',
    //     glibcVersionCompiler: '2.28',
    //     wordSize: 64,
    //     arch: 'x64',
    //     platform: 'linux',
    //     componentVersions: {
    //       acorn: '8.10.0',
    //       ada: '2.5.1',
    //       ares: '1.19.1',
    //       base64: '0.5.0',
    //       brotli: '1.0.9',
    //       cjs_module_lexer: '1.2.2',
    //       cldr: '43.1',
    //       icu: '73.2',
    //       llhttp: '8.1.1',
    //       modules: '115',
    //       napi: '9',
    //       nghttp2: '1.55.1',
    //       nghttp3: '0.7.0',
    //       ngtcp2: '0.8.1',
    //       node: '20.5.0',
    //       openssl: '3.0.9+quic',
    //       simdutf: '3.2.14',
    //       tz: '2023c',
    //       undici: '5.22.1',
    //       unicode: '15.0',
    //       uv: '1.46.0',
    //       uvwasi: '0.0.18',
    //       v8: '11.3.244.8-node.10',
    //       zlib: '1.2.13.1-motley'
    //     },
    //     release: {
    //       name: 'node',
    //       headersUrl: 'https://nodejs.org/download/release/v20.5.0/node-v20.5.0-headers.tar.gz',
    //       sourceUrl: 'https://nodejs.org/download/release/v20.5.0/node-v20.5.0.tar.gz'
    //     },
    //     osName: 'Linux',
    //     osRelease: '5.17.0-1016-oem',
    //     osVersion: '#17-Ubuntu SMP PREEMPT Mon Aug 22 11:31:08 UTC 2022',
    //     osMachine: 'x86_64',
    //     cpus: [
    //     ],
    //     networkInterfaces: [

    //     ],
    //     host: 'jarred-desktop'
    //   },
    //   javascriptStack: {
    //     message: 'Error [ERR_SYNTHETIC]: JavaScript Callstack',
    //     stack: [
    //       'at new NodeError (node:internal/errors:405:5)',
    //       'at Object.getReport (node:internal/process/report:36:13)',
    //       'at REPL18:1:16',
    //       'at Script.runInThisContext (node:vm:122:12)',
    //       'at REPLServer.defaultEval (node:repl:593:29)',
    //       'at bound (node:domain:433:15)',
    //       'at REPLServer.runBound [as eval] (node:domain:444:12)',
    //       'at REPLServer.onLine (node:repl:923:10)',
    //       'at REPLServer.emit (node:events:526:35)'
    //     ],
    //     errorProperties: { code: 'ERR_SYNTHETIC' }
    //   },
    //   javascriptHeap: {
    //     totalMemory: 6696960,
    //     executableMemory: 262144,
    //     totalCommittedMemory: 6811648,
    //     availableMemory: 4339915016,
    //     totalGlobalHandlesMemory: 8192,
    //     usedGlobalHandlesMemory: 4416,
    //     usedMemory: 5251032,
    //     memoryLimit: 4345298944,
    //     mallocedMemory: 262312,
    //     externalMemory: 2120511,
    //     peakMallocedMemory: 521312,
    //     nativeContextCount: 2,
    //     detachedContextCount: 0,
    //     doesZapGarbage: 0,
    //     heapSpaces: {
    //       read_only_space: [Object],
    //       new_space: [Object],
    //       old_space: [Object],
    //       code_space: [Object],
    //       shared_space: [Object],
    //       new_large_object_space: [Object],
    //       large_object_space: [Object],
    //       code_large_object_space: [Object],
    //       shared_large_object_space: [Object]
    //     }
    //   },
    //   nativeStack: [

    //   ],
    //   resourceUsage: {
    //     free_memory: 64445558784,
    //     total_memory: 67358441472,
    //     rss: 52109312,
    //     constrained_memory: 18446744073709552000,
    //     available_memory: 18446744073657442000,
    //     userCpuSeconds: 0.105635,
    //     kernelCpuSeconds: 0.033611,
    //     cpuConsumptionPercent: 4.64153,
    //     userCpuConsumptionPercent: 3.52117,
    //     kernelCpuConsumptionPercent: 1.12037,
    //     maxRss: 52150272,
    //     pageFaults: { IORequired: 26, IONotRequired: 3917 },
    //     fsActivity: { reads: 3536, writes: 24 }
    //   },
    //   uvthreadResourceUsage: {
    //     userCpuSeconds: 0.088644,
    //     kernelCpuSeconds: 0.005214,
    //     cpuConsumptionPercent: 3.1286,
    //     userCpuConsumptionPercent: 2.9548,
    //     kernelCpuConsumptionPercent: 0.1738,
    //     fsActivity: { reads: 3512, writes: 0 }
    //   },
    //   libuv: [

    //   ],
    //   workers: [],
    //   environmentVariables: {
    //   },
    //   userLimits: {
    //     core_file_size_blocks: { soft: 'unlimited', hard: 'unlimited' },
    //     data_seg_size_kbytes: { soft: 'unlimited', hard: 'unlimited' },
    //     file_size_blocks: { soft: 'unlimited', hard: 'unlimited' },
    //     max_locked_memory_bytes: { soft: 8419803136, hard: 8419803136 },
    //     max_memory_size_kbytes: { soft: 'unlimited', hard: 'unlimited' },
    //     open_files: { soft: 1048576, hard: 1048576 },
    //     stack_size_bytes: { soft: 8388608, hard: 'unlimited' },
    //     cpu_time_seconds: { soft: 'unlimited', hard: 'unlimited' },
    //     max_user_processes: { soft: 256637, hard: 256637 },
    //     virtual_memory_kbytes: { soft: 'unlimited', hard: 'unlimited' }
    //   },
    //   sharedObjects: [
    //
    //   ]
    // }
    auto constructUserLimits = [&]() -> JSValue {
        JSC::JSObject* userLimits = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 11);

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
            struct rlimit limit;
            getrlimit(resourceLimits[i], &limit);

            JSValue soft = limit.rlim_cur == RLIM_INFINITY ? JSC::jsString(vm, String("unlimited"_s)) : limit.rlim_cur > INT32_MAX ? JSC::jsNumber(limit.rlim_cur)
                                                                                                                                   : JSC::jsDoubleNumber(static_cast<double>(limit.rlim_cur));

            JSValue hard = limit.rlim_max == RLIM_INFINITY ? JSC::jsString(vm, String("unlimited"_s)) : limit.rlim_max > INT32_MAX ? JSC::jsNumber(limit.rlim_max)
                                                                                                                                   : JSC::jsDoubleNumber(static_cast<double>(limit.rlim_max));

            limitObject->putDirect(vm, JSC::Identifier::fromString(vm, "soft"_s), soft, 0);
            limitObject->putDirect(vm, JSC::Identifier::fromString(vm, "hard"_s), hard, 0);

            userLimits->putDirect(vm, JSC::Identifier::fromString(vm, labels[i]), limitObject, 0);
        }

        return userLimits;
    };

    auto constructResourceUsage = [&]() -> JSC::JSValue {
        JSC::JSObject* resourceUsage = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 11);

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
        pageFaults->putDirect(vm, JSC::Identifier::fromString(vm, "IORequired"_s), JSC::jsNumber(usage.ru_majflt), 0);
        pageFaults->putDirect(vm, JSC::Identifier::fromString(vm, "IONotRequired"_s), JSC::jsNumber(usage.ru_minflt), 0);

        resourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "pageFaults"_s), pageFaults, 0);

        JSC::JSObject* fsActivity = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
        fsActivity->putDirect(vm, JSC::Identifier::fromString(vm, "reads"_s), JSC::jsNumber(usage.ru_inblock), 0);
        fsActivity->putDirect(vm, JSC::Identifier::fromString(vm, "writes"_s), JSC::jsNumber(usage.ru_oublock), 0);

        resourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "fsActivity"_s), fsActivity, 0);

        return resourceUsage;
    };

    auto constructHeader = [&]() -> JSC::JSValue {
        JSC::JSObject* header = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype());

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
        header->putDirect(vm, JSC::Identifier::fromString(vm, "dumpEventTimeStamp"_s), JSC::jsString(vm, timeStamp, 0));
        header->putDirect(vm, JSC::Identifier::fromString(vm, "processId"_s), JSC::jsNumber(getpid()), 0);
        // TODO:
        header->putDirect(vm, JSC::Identifier::fromString(vm, "threadId"_s), JSC::jsNumber(0), 0);

        {
            char cwd[PATH_MAX] = { 0 };
            getcwd(cwd, PATH_MAX);

            header->putDirect(vm, JSC::Identifier::fromString(vm, "cwd"_s), JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const LChar*>(cwd), strlen(cwd) })), 0);
        }

        header->putDirect(vm, JSC::Identifier::fromString(vm, "commandLine"_s), JSValue::decode(Bun__Process__getExecArgv(globalObject)), 0);
        header->putDirect(vm, JSC::Identifier::fromString(vm, "nodejsVersion"_s), JSC::jsString(vm, String::fromLatin1(REPORTED_NODEJS_VERSION)), 0);
        header->putDirect(vm, JSC::Identifier::fromString(vm, "wordSize"_s), JSC::jsNumber(64), 0);
        header->putDirect(vm, JSC::Identifier::fromString(vm, "arch"_s), constructArch(vm, header), 0);
        header->putDirect(vm, JSC::Identifier::fromString(vm, "platform"_s), constructPlatform(vm, header), 0);
        header->putDirect(vm, JSC::Identifier::fromString(vm, "componentVersions"_s), constructVersions(vm, header), 0);
        header->putDirect(vm, JSC::Identifier::fromString(vm, "release"_s), constructProcessReleaseObject(vm, header), 0);

        {
            // uname
            struct utsname buf;
            uname(&buf);

            header->putDirect(vm, JSC::Identifier::fromString(vm, "osName"_s), JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const LChar*>(buf.sysname), strlen(buf.sysname) })), 0);
            header->putDirect(vm, JSC::Identifier::fromString(vm, "osRelease"_s), JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const LChar*>(buf.release), strlen(buf.release) })), 0);
            header->putDirect(vm, JSC::Identifier::fromString(vm, "osVersion"_s), JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const LChar*>(buf.version), strlen(buf.version) })), 0);
            header->putDirect(vm, JSC::Identifier::fromString(vm, "osMachine"_s), JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const LChar*>(buf.machine), strlen(buf.machine) })), 0);
        }

        // host
        {
            // TODO: use HOSTNAME_MAX
            char host[1024] = { 0 };
            gethostname(host, 1024);

            header->putDirect(vm, JSC::Identifier::fromString(vm, "host"_s), JSC::jsString(vm, String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const LChar*>(host), strlen(host) })), 0);
        }

#if OS(LINUX)
        header->putDirect(vm, JSC::Identifier::fromString(vm, "glibcVersionCompiler"_s), JSC::jsString(vm, makeString(__GLIBC__, '.', __GLIBC_MINOR__)), 0);
        header->putDirect(vm, JSC::Identifier::fromString(vm, "glibcVersionRuntime"_s), JSC::jsString(vm, String::fromUTF8(gnu_get_libc_version()), 0));
#endif

        header->putDirect(vm, Identifier::fromString(vm, "cpus"_s), JSC::constructEmptyArray(globalObject, nullptr), 0);
        header->putDirect(vm, Identifier::fromString(vm, "networkInterfaces"_s), JSC::constructEmptyArray(globalObject, nullptr), 0);

        return header;
    };

    auto constructJavaScriptHeap = [&]() -> JSC::JSValue {
        JSC::JSObject* heap = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 16);

        JSC::JSObject* heapSpaces = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 9);
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "read_only_space"_s), JSC::constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "new_space"_s), JSC::constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "old_space"_s), JSC::constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "code_space"_s), JSC::constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "shared_space"_s), JSC::constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "new_large_object_space"_s), JSC::constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "large_object_space"_s), JSC::constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "code_large_object_space"_s), JSC::constructEmptyObject(globalObject), 0);
        heapSpaces->putDirect(vm, JSC::Identifier::fromString(vm, "shared_large_object_space"_s), JSC::constructEmptyObject(globalObject), 0);

        heap->putDirect(vm, JSC::Identifier::fromString(vm, "totalMemory"_s), JSC::jsDoubleNumber(static_cast<double>(WTF::ramSize())), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "executableMemory"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "totalCommittedMemory"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "availableMemory"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "totalGlobalHandlesMemory"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "usedGlobalHandlesMemory"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "usedMemory"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "memoryLimit"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "mallocedMemory"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "externalMemory"_s), JSC::jsDoubleNumber(static_cast<double>(vm.heap.externalMemorySize())), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "peakMallocedMemory"_s), jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "nativeContextCount"_s), JSC::jsNumber(1), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "detachedContextCount"_s), JSC::jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "doesZapGarbage"_s), JSC::jsNumber(0), 0);
        heap->putDirect(vm, JSC::Identifier::fromString(vm, "heapSpaces"_s), heapSpaces, 0);

        return heap;
    };

    auto constructUVThreadResourceUsage = [&]() -> JSC::JSValue {
        JSC::JSObject* uvthreadResourceUsage = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 6);

        uvthreadResourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "userCpuSeconds"_s), JSC::jsNumber(0), 0);
        uvthreadResourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "kernelCpuSeconds"_s), JSC::jsNumber(0), 0);
        uvthreadResourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "cpuConsumptionPercent"_s), JSC::jsNumber(0), 0);
        uvthreadResourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "userCpuConsumptionPercent"_s), JSC::jsNumber(0), 0);
        uvthreadResourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "kernelCpuConsumptionPercent"_s), JSC::jsNumber(0), 0);

        JSC::JSObject* fsActivity = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
        fsActivity->putDirect(vm, JSC::Identifier::fromString(vm, "reads"_s), JSC::jsNumber(0), 0);
        fsActivity->putDirect(vm, JSC::Identifier::fromString(vm, "writes"_s), JSC::jsNumber(0), 0);

        uvthreadResourceUsage->putDirect(vm, JSC::Identifier::fromString(vm, "fsActivity"_s), fsActivity, 0);

        return uvthreadResourceUsage;
    };

    auto constructJavaScriptStack = [&]() -> JSC::JSValue {
        JSC::JSObject* javascriptStack = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 3);

        javascriptStack->putDirect(vm, JSC::Identifier::fromString(vm, "message"_s), JSC::jsString(vm, String("Error [ERR_SYNTHETIC]: JavaScript Callstack"_s)), 0);

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
                vm, globalObject, name, message,
                line, column,
                sourceURL, stackFrames, nullptr);

            WTF::String stack;
            // first line after "Error:"
            size_t firstLine = stackProperty.find('\n');
            if (firstLine != WTF::notFound) {
                stack = stackProperty.substring(firstLine + 1);
            }

            JSC::JSArray* stackArray = JSC::constructEmptyArray(globalObject, nullptr);

            stack.split('\n', [&](const WTF::StringView& line) {
                stackArray->push(globalObject, JSC::jsString(vm, line.toString().trim(isASCIIWhitespace)));
            });

            javascriptStack->putDirect(vm, JSC::Identifier::fromString(vm, "stack"_s), stackArray, 0);
        }

        JSC::JSObject* errorProperties = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 1);
        errorProperties->putDirect(vm, JSC::Identifier::fromString(vm, "code"_s), JSC::jsString(vm, String("ERR_SYNTHETIC"_s)), 0);
        javascriptStack->putDirect(vm, JSC::Identifier::fromString(vm, "errorProperties"_s), errorProperties, 0);
        return javascriptStack;
    };

    auto constructSharedObjects = [&]() -> JSC::JSValue {
        JSC::JSObject* sharedObjects = JSC::constructEmptyArray(globalObject, nullptr);

        // TODO:

        return sharedObjects;
    };

    auto constructLibUV = [&]() -> JSC::JSValue {
        JSC::JSObject* libuv = JSC::constructEmptyArray(globalObject, nullptr);

        // TODO:

        return libuv;
    };

    auto constructWorkers = [&]() -> JSC::JSValue {
        JSC::JSObject* workers = JSC::constructEmptyArray(globalObject, nullptr);

        // TODO:

        return workers;
    };

    auto constructEnvironmentVariables = [&]() -> JSC::JSValue {
        return globalObject->processEnvObject();
    };

    auto constructCpus = [&]() -> JSC::JSValue {
        JSC::JSObject* cpus = JSC::constructEmptyArray(globalObject, nullptr);

        // TODO:

        return cpus;
    };

    auto constructNetworkInterfaces = [&]() -> JSC::JSValue {
        JSC::JSObject* networkInterfaces = JSC::constructEmptyArray(globalObject, nullptr);

        // TODO:

        return networkInterfaces;
    };

    auto constructNativeStack = [&]() -> JSC::JSValue {
        JSC::JSObject* nativeStack = JSC::constructEmptyArray(globalObject, nullptr);

        // TODO:

        return nativeStack;
    };

    {
        JSC::JSObject* report = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 19);

        report->putDirect(vm, JSC::Identifier::fromString(vm, "header"_s), constructHeader(), 0);
        report->putDirect(vm, JSC::Identifier::fromString(vm, "javascriptStack"_s), constructJavaScriptStack(), 0);
        report->putDirect(vm, JSC::Identifier::fromString(vm, "javascriptHeap"_s), constructJavaScriptHeap(), 0);
        report->putDirect(vm, JSC::Identifier::fromString(vm, "nativeStack"_s), constructNativeStack(), 0);
        report->putDirect(vm, JSC::Identifier::fromString(vm, "resourceUsage"_s), constructResourceUsage(), 0);
        report->putDirect(vm, JSC::Identifier::fromString(vm, "uvthreadResourceUsage"_s), constructUVThreadResourceUsage(), 0);
        report->putDirect(vm, JSC::Identifier::fromString(vm, "libuv"_s), constructLibUV(), 0);
        report->putDirect(vm, JSC::Identifier::fromString(vm, "workers"_s), constructWorkers(), 0);
        report->putDirect(vm, JSC::Identifier::fromString(vm, "environmentVariables"_s), constructEnvironmentVariables(), 0);
        report->putDirect(vm, JSC::Identifier::fromString(vm, "userLimits"_s), constructUserLimits(), 0);
        report->putDirect(vm, JSC::Identifier::fromString(vm, "sharedObjects"_s), constructSharedObjects(), 0);
        report->putDirect(vm, JSC::Identifier::fromString(vm, "cpus"_s), constructCpus(), 0);
        report->putDirect(vm, JSC::Identifier::fromString(vm, "networkInterfaces"_s), constructNetworkInterfaces(), 0);

        return report;
    }
#else // !OS(WINDOWS)
    return jsString(vm, String("Not implemented. blame @paperdave"_s));
#endif
}

JSC_DEFINE_HOST_FUNCTION(Process_functionGetReport, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    // TODO: node:vm
    return JSValue::encode(constructReportObjectComplete(vm, jsCast<Zig::GlobalObject*>(globalObject), String()));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionWriteReport, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    // TODO:
    return JSValue::encode(callFrame->argument(0));
}

static JSValue constructProcessReportObject(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    auto* report = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 4);
    report->putDirect(vm, JSC::Identifier::fromString(vm, "getReport"_s), JSC::JSFunction::create(vm, globalObject, 0, String("getReport"_s), Process_functionGetReport, ImplementationVisibility::Public), 0);
    report->putDirect(vm, JSC::Identifier::fromString(vm, "directory"_s), JSC::jsEmptyString(vm), 0);
    report->putDirect(vm, JSC::Identifier::fromString(vm, "filename"_s), JSC::jsEmptyString(vm), 0);
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
    JSC::JSObject* variables = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 1);
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "v8_enable_i8n_support"_s),
        JSC::jsNumber(1), 0);
    config->putDirect(vm, JSC::Identifier::fromString(vm, "target_defaults"_s), JSC::constructEmptyObject(globalObject), 0);
    config->putDirect(vm, JSC::Identifier::fromString(vm, "variables"_s), variables, 0);

    return config;
}

static JSValue constructProcessHrtimeObject(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    JSC::JSFunction* hrtime = JSC::JSFunction::create(vm, globalObject, 0,
        String("hrtime"_s), Process_functionHRTime, ImplementationVisibility::Public);

    JSC::JSFunction* hrtimeBigInt = JSC::JSFunction::create(vm, globalObject, 0,
        String("bigint"_s), Process_functionHRTimeBigInt, ImplementationVisibility::Public);

    hrtime->putDirect(vm, JSC::Identifier::fromString(vm, "bigint"_s), hrtimeBigInt);

    return hrtime;
}

#if OS(WINDOWS)
extern "C" void Bun__ForceFileSinkToBeSynchronousOnWindows(JSC::JSGlobalObject*, JSC::EncodedJSValue);
#endif
static JSValue constructStdioWriteStream(JSC::JSGlobalObject* globalObject, int fd)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSFunction* getStdioWriteStream = JSC::JSFunction::create(vm, processObjectInternalsGetStdioWriteStreamCodeGenerator(vm), globalObject);
    JSC::MarkedArgumentBuffer args;
    args.append(JSC::jsNumber(fd));

    JSC::CallData callData = JSC::getCallData(getStdioWriteStream);

    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::call(globalObject, getStdioWriteStream, callData, globalObject->globalThis(), args, returnedException);
    RETURN_IF_EXCEPTION(scope, {});

    if (auto* exception = returnedException.get()) {
#if BUN_DEBUG
        Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
#endif
        scope.throwException(globalObject, exception->value());
        returnedException.clear();
        return {};
    }

    ASSERT_WITH_MESSAGE(JSC::isJSArray(result), "Expected an array from getStdioWriteStream");
    JSC::JSArray* resultObject = JSC::jsCast<JSC::JSArray*>(result);

#if OS(WINDOWS)
    Zig::GlobalObject* globalThis = jsCast<Zig::GlobalObject*>(globalObject);
    // Node.js docs - https://nodejs.org/api/process.html#a-note-on-process-io
    // > Files: synchronous on Windows and POSIX
    // > TTYs (Terminals): asynchronous on Windows, synchronous on POSIX
    // > Pipes (and sockets): synchronous on Windows, asynchronous on POSIX
    // > Synchronous writes avoid problems such as output written with console.log() or console.error() being unexpectedly interleaved, or not written at all if process.exit() is called before an asynchronous write completes. See process.exit() for more information.
    Bun__ForceFileSinkToBeSynchronousOnWindows(globalThis, JSValue::encode(resultObject->getIndex(globalObject, 1)));
#endif

    return resultObject->getIndex(globalObject, 0);
}

static JSValue constructStdout(VM& vm, JSObject* processObject)
{
    auto* globalObject = Bun__getDefaultGlobal();
    return constructStdioWriteStream(globalObject, 1);
}

static JSValue constructStderr(VM& vm, JSObject* processObject)
{
    auto* globalObject = Bun__getDefaultGlobal();
    return constructStdioWriteStream(globalObject, 2);
}

#if OS(WINDOWS)
#define STDIN_FILENO 0
#endif

static JSValue constructStdin(VM& vm, JSObject* processObject)
{
    auto* globalObject = Bun__getDefaultGlobal();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSFunction* getStdioWriteStream = JSC::JSFunction::create(vm, processObjectInternalsGetStdinStreamCodeGenerator(vm), globalObject);
    JSC::MarkedArgumentBuffer args;
    args.append(JSC::jsNumber(STDIN_FILENO));

    JSC::CallData callData = JSC::getCallData(getStdioWriteStream);

    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::call(globalObject, getStdioWriteStream, callData, globalObject, args, returnedException);
    RETURN_IF_EXCEPTION(scope, {});

    if (auto* exception = returnedException.get()) {
#if BUN_DEBUG
        Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
#endif
        scope.throwException(globalObject, exception->value());
        returnedException.clear();
        return {};
    }

    RELEASE_AND_RETURN(scope, result);
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
    return jsNumber(0);
#else
    return jsNumber(getppid());
#endif
}

static JSValue constructArgv0(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    return JSValue::decode(Bun__Process__getArgv0(globalObject));
}

static JSValue constructExecArgv(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    return JSValue::decode(Bun__Process__getExecArgv(globalObject));
}

static JSValue constructExecPath(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    return JSValue::decode(Bun__Process__getExecPath(globalObject));
}

static JSValue constructArgv(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    return JSValue::decode(Bun__Process__getArgv(globalObject));
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
    auto& vm = globalObject->vm();
    int ngroups = getgroups(0, nullptr);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (ngroups == -1) {
        throwSystemError(throwScope, globalObject, "getgroups"_s, errno);
        return JSValue::encode(jsUndefined());
    }

    gid_t egid = getegid();
    JSArray* groups = constructEmptyArray(globalObject, nullptr, static_cast<unsigned int>(ngroups));
    Vector<gid_t> groupVector(ngroups);
    getgroups(1, &egid);
    bool needsEgid = true;
    for (unsigned i = 0; i < ngroups; i++) {
        auto current = groupVector[i];
        if (current == needsEgid) {
            needsEgid = false;
        }

        groups->putDirectIndex(globalObject, i, jsNumber(current));
    }

    if (needsEgid)
        groups->push(globalObject, jsNumber(egid));

    return JSValue::encode(groups);
}
#endif

JSC_DEFINE_HOST_FUNCTION(Process_functionAssert, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSValue arg0 = callFrame->argument(0);
    bool condition = arg0.toBoolean(globalObject);
    RETURN_IF_EXCEPTION(throwScope, JSValue::encode(jsUndefined()));
    if (condition) {
        return JSValue::encode(jsUndefined());
    }

    JSValue arg1 = callFrame->argument(1);
    String message = arg1.isUndefined() ? String() : arg1.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, JSValue::encode(jsUndefined()));
    auto error = createError(globalObject, makeString("Assertion failed: "_s, message));
    error->putDirect(vm, Identifier::fromString(vm, "code"_s), jsString(vm, makeString("ERR_ASSERTION"_s)));
    throwException(globalObject, throwScope, error);
    return JSValue::encode(jsUndefined());
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
    auto& builtinNames = WebCore::builtinNames(vm);
    auto fn = globalObject->getDirect(vm, builtinNames.requireNativeModulePrivateName());
    auto callData = JSC::getCallData(fn);
    JSC::MarkedArgumentBuffer args;
    args.append(jsString(vm, String("util/types"_s)));
    return JSC::call(globalObject, fn, callData, globalObject, args);
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

JSC_DEFINE_HOST_FUNCTION(Process_functionBinding, (JSGlobalObject * jsGlobalObject, CallFrame* callFrame))
{
    auto& vm = jsGlobalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto globalObject = jsCast<Zig::GlobalObject*>(jsGlobalObject);
    auto process = jsCast<Process*>(globalObject->processObject());
    auto moduleName = callFrame->argument(0).toWTFString(globalObject);

    // clang-format off
    if (moduleName == "async_wrap"_s) PROCESS_BINDING_NOT_IMPLEMENTED("async_wrap");
    if (moduleName == "buffer"_s) PROCESS_BINDING_NOT_IMPLEMENTED_ISSUE("buffer", "2020");
    if (moduleName == "cares_wrap"_s) PROCESS_BINDING_NOT_IMPLEMENTED("cares_wrap");
    if (moduleName == "config"_s) return JSValue::encode(processBindingConfig(globalObject, vm));
    if (moduleName == "constants"_s) return JSValue::encode(globalObject->processBindingConstants());
    if (moduleName == "contextify"_s) PROCESS_BINDING_NOT_IMPLEMENTED("contextify");
    if (moduleName == "crypto"_s) PROCESS_BINDING_NOT_IMPLEMENTED("crypto");
    if (moduleName == "fs"_s) PROCESS_BINDING_NOT_IMPLEMENTED_ISSUE("fs", "3546");
    if (moduleName == "fs_event_wrap"_s) PROCESS_BINDING_NOT_IMPLEMENTED("fs_event_wrap");
    if (moduleName == "http_parser"_s) PROCESS_BINDING_NOT_IMPLEMENTED("http_parser");
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
    if (moduleName == "util"_s) return JSValue::encode(processBindingUtil(globalObject, vm));
    if (moduleName == "uv"_s) return JSValue::encode(process->bindingUV());
    if (moduleName == "v8"_s) PROCESS_BINDING_NOT_IMPLEMENTED("v8");
    if (moduleName == "zlib"_s) PROCESS_BINDING_NOT_IMPLEMENTED("zlib");
    // clang-format on

    throwScope.throwException(globalObject, createError(globalObject, makeString("No such module: "_s, moduleName)));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(Process_functionReallyExit, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    uint8_t exitCode = 0;
    JSValue arg0 = callFrame->argument(0);
    if (arg0.isAnyInt()) {
        exitCode = static_cast<uint8_t>(arg0.toInt32(globalObject) % 256);
        RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::JSValue {}));
    } else if (!arg0.isUndefinedOrNull()) {
        throwTypeError(globalObject, throwScope, "The \"code\" argument must be an integer"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    } else {
        exitCode = Bun__getExitCode(Bun__getVM());
    }

    auto* zigGlobal = jsDynamicCast<Zig::GlobalObject*>(globalObject);
    if (UNLIKELY(!zigGlobal)) {
        zigGlobal = Bun__getDefaultGlobal();
    }
    Bun__Process__exit(zigGlobal, exitCode);
    return JSC::JSValue::encode(jsUndefined());
}

template<typename Visitor>
void Process::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    Process* thisObject = jsCast<Process*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_uncaughtExceptionCaptureCallback);
    thisObject->m_cpuUsageStructure.visit(visitor);
    thisObject->m_memoryUsageStructure.visit(visitor);
    thisObject->m_bindingUV.visit(visitor);
    thisObject->m_bindingNatives.visit(visitor);
}

DEFINE_VISIT_CHILDREN(Process);

static Structure* constructCPUUsageStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    JSC::Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), 2);
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
static Structure* constructMemoryUsageStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    JSC::Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), 5);
    PropertyOffset offset;
    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "rss"_s),
        0,
        offset);
    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "heapTotal"_s),
        0,
        offset);
    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "heapUsed"_s),
        0,
        offset);
    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "external"_s),
        0,
        offset);
    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "arrayBuffers"_s),
        0,
        offset);

    return structure;
}

static Process* getProcessObject(JSC::JSGlobalObject* lexicalGlobalObject, JSValue thisValue)
{
    Process* process = jsDynamicCast<Process*>(thisValue);

    // Handle "var memoryUsage = process.memoryUsage; memoryUsage()"
    if (UNLIKELY(!process)) {
        // Handle calling this function from inside a node:vm
        Zig::GlobalObject* zigGlobalObject = jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject);

        if (UNLIKELY(!zigGlobalObject)) {
            zigGlobalObject = Bun__getDefaultGlobal();
        }

        return jsCast<Process*>(zigGlobalObject->processObject());
    }

    return process;
}

JSC_DEFINE_HOST_FUNCTION(Process_functionConstrainedMemory,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
#if OS(LINUX) || OS(FREEBSD)
    return JSValue::encode(jsDoubleNumber(static_cast<double>(WTF::ramSize())));
#else
    return JSValue::encode(jsUndefined());
#endif
}

JSC_DEFINE_HOST_FUNCTION(Process_functionCpuUsage,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
#if !OS(WINDOWS)
    struct rusage rusage;
    if (getrusage(RUSAGE_SELF, &rusage) != 0) {
        throwSystemError(throwScope, globalObject, "Failed to get CPU usage"_s, "getrusage"_s, errno);
        return JSValue::encode(jsUndefined());
    }
#else
    uv_rusage_t rusage;
    if (uv_getrusage(&rusage) != 0) {
        throwSystemError(throwScope, globalObject, "Failed to get CPU usage"_s, "uv_getrusage"_s, errno);
        return JSValue::encode(jsUndefined());
    }
#endif

    auto* process = getProcessObject(globalObject, callFrame->thisValue());

    Structure* cpuUsageStructure = process->cpuUsageStructure();

    constexpr double MICROS_PER_SEC = 1000000.0;

    double user = MICROS_PER_SEC * rusage.ru_utime.tv_sec + rusage.ru_utime.tv_usec;
    double system = MICROS_PER_SEC * rusage.ru_stime.tv_sec + rusage.ru_stime.tv_usec;

    if (callFrame->argumentCount() > 0) {
        JSValue comparatorValue = callFrame->argument(0);
        if (!comparatorValue.isUndefined()) {
            if (UNLIKELY(!comparatorValue.isObject())) {
                throwTypeError(globalObject, throwScope, "Expected an object as the first argument"_s);
                return JSC::JSValue::encode(JSC::jsUndefined());
            }

            JSC::JSObject* comparator = comparatorValue.getObject();
            JSValue userValue;
            JSValue systemValue;

            if (LIKELY(comparator->structureID() == cpuUsageStructure->id())) {
                userValue = comparator->getDirect(0);
                systemValue = comparator->getDirect(1);
            } else {
                userValue = comparator->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "user"_s));
                RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));

                systemValue = comparator->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "system"_s));
                RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));
            }

            if (UNLIKELY(!userValue || !userValue.isNumber())) {
                throwTypeError(globalObject, throwScope, "Expected a number for the user property"_s);
                return JSC::JSValue::encode(JSC::jsUndefined());
            }

            if (UNLIKELY(!systemValue || !systemValue.isNumber())) {
                throwTypeError(globalObject, throwScope, "Expected a number for the system property"_s);
                return JSC::JSValue::encode(JSC::jsUndefined());
            }

            double userComparator = userValue.asNumber();
            double systemComparator = systemValue.asNumber();

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

int getRSS(size_t* rss)
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

JSC_DEFINE_HOST_FUNCTION(Process_functionMemoryUsage,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* process = getProcessObject(globalObject, callFrame->thisValue());

    size_t current_rss = 0;
    if (getRSS(&current_rss) != 0) {
        throwSystemError(throwScope, globalObject, "Failed to get memory usage"_s, "memoryUsage"_s, errno);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSC::JSObject* result = JSC::constructEmptyObject(vm, process->memoryUsageStructure());
    if (UNLIKELY(throwScope.exception())) {
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    // Node.js:
    // {
    //    rss: 4935680,
    //    heapTotal: 1826816,
    //    heapUsed: 650472,
    //    external: 49879,
    //    arrayBuffers: 9386
    // }

    result->putDirectOffset(vm, 0, JSC::jsDoubleNumber(current_rss));
    result->putDirectOffset(vm, 1, JSC::jsDoubleNumber(vm.heap.blockBytesAllocated()));

    // heap.size() loops through every cell...
    // TODO: add a binding for heap.sizeAfterLastCollection()
    result->putDirectOffset(vm, 2, JSC::jsDoubleNumber(vm.heap.sizeAfterLastEdenCollection()));

    result->putDirectOffset(vm, 3, JSC::jsDoubleNumber(vm.heap.extraMemorySize() + vm.heap.externalMemorySize()));

    // We report 0 for this because m_arrayBuffers in JSC::Heap is private and we need to add a binding
    // If we use objectTypeCounts(), it's hideously slow because it loops through every single object in the heap
    // TODO: add a binding for m_arrayBuffers, registerWrapper() in TypedArrayController doesn't work
    result->putDirectOffset(vm, 4, JSC::jsNumber(0));

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(result));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionMemoryUsageRSS,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    size_t current_rss = 0;
    if (getRSS(&current_rss) != 0) {
        throwSystemError(throwScope, globalObject, "Failed to get memory usage"_s, "memoryUsage"_s, errno);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsNumber(current_rss)));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionOpenStdin, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    Zig::GlobalObject* global = jsDynamicCast<Zig::GlobalObject*>(globalObject);
    if (UNLIKELY(!global)) {
        global = Bun__getDefaultGlobal();
    }
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (JSValue stdinValue = global->processObject()->getIfPropertyExists(globalObject, Identifier::fromString(vm, "stdin"_s))) {
        RETURN_IF_EXCEPTION(throwScope, JSValue::encode(jsUndefined()));

        if (!stdinValue.isObject()) {
            throwTypeError(globalObject, throwScope, "stdin is not an object"_s);
            return JSValue::encode(jsUndefined());
        }

        JSValue resumeValue = stdinValue.getObject()->getIfPropertyExists(globalObject, Identifier::fromString(vm, "resume"_s));
        RETURN_IF_EXCEPTION(throwScope, JSValue::encode(jsUndefined()));
        if (!resumeValue.isUndefinedOrNull()) {
            auto resumeFunction = jsDynamicCast<JSFunction*>(resumeValue);
            if (UNLIKELY(!resumeFunction)) {
                throwTypeError(globalObject, throwScope, "stdin.resume is not a function"_s);
                return JSValue::encode(jsUndefined());
            }

            auto callData = getCallData(resumeFunction);

            MarkedArgumentBuffer args;
            JSC::call(globalObject, resumeFunction, callData, stdinValue, args);
            RETURN_IF_EXCEPTION(throwScope, JSValue::encode(jsUndefined()));
        }

        RELEASE_AND_RETURN(throwScope, JSValue::encode(stdinValue));
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));
}

JSC_DEFINE_HOST_FUNCTION(Process_stubEmptyFunction, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(Process_stubFunctionReturningArray, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(JSC::constructEmptyArray(globalObject, nullptr));
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
    JSC::JSFunction* memoryUsage = JSC::JSFunction::create(vm, globalObject, 0,
        String("memoryUsage"_s), Process_functionMemoryUsage, ImplementationVisibility::Public);

    JSC::JSFunction* rss = JSC::JSFunction::create(vm, globalObject, 0,
        String("rss"_s), Process_functionMemoryUsageRSS, ImplementationVisibility::Public);

    memoryUsage->putDirect(vm, JSC::Identifier::fromString(vm, "rss"_s), rss, 0);
    return memoryUsage;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionReportUncaughtException, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSValue arg0 = callFrame->argument(0);
    Bun__reportUnhandledError(globalObject, JSValue::encode(arg0));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDrainMicrotaskQueue, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    globalObject->vm().drainMicrotasks();
    return JSValue::encode(jsUndefined());
}

static JSValue constructProcessNextTickFn(VM& vm, JSObject* processObject)
{
    JSGlobalObject* lexicalGlobalObject = processObject->globalObject();
    Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    JSValue nextTickQueueObject;
    if (!globalObject->m_nextTickQueue) {
        nextTickQueueObject = Bun::JSNextTickQueue::create(globalObject);
        globalObject->m_nextTickQueue.set(vm, globalObject, nextTickQueueObject);
    } else {
        nextTickQueueObject = jsCast<Bun::JSNextTickQueue*>(globalObject->m_nextTickQueue.get());
    }

    JSC::JSFunction* initializer = JSC::JSFunction::create(vm, processObjectInternalsInitializeNextTickQueueCodeGenerator(vm), lexicalGlobalObject);

    JSC::MarkedArgumentBuffer args;
    args.append(processObject);
    args.append(nextTickQueueObject);
    args.append(JSC::JSFunction::create(vm, globalObject, 1, String(), jsFunctionDrainMicrotaskQueue, ImplementationVisibility::Private));
    args.append(JSC::JSFunction::create(vm, globalObject, 1, String(), jsFunctionReportUncaughtException, ImplementationVisibility::Private));

    return JSC::call(globalObject, initializer, JSC::getCallData(initializer), globalObject->globalThis(), args);
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

    return object;
}

static int _debugPort;

JSC_DEFINE_CUSTOM_GETTER(processDebugPort, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    if (_debugPort == 0) {
        _debugPort = 9229;
    }

    return JSC::JSValue::encode(jsNumber(_debugPort));
}

JSC_DEFINE_CUSTOM_SETTER(setProcessDebugPort,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue encodedValue, JSC::PropertyName))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = JSValue::decode(encodedValue);

    if (!value.isInt32AsAnyInt()) {
        throwNodeRangeError(globalObject, scope, "debugPort must be 0 or in range 1024 to 65535"_s);
        return false;
    }

    int port = value.toInt32(globalObject);

    if (port != 0) {
        if (port < 1024 || port > 65535) {
            throwNodeRangeError(globalObject, scope, "debugPort must be 0 or in range 1024 to 65535"_s);
            return false;
        }
    }

    _debugPort = port;
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(processTitle, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
#if !OS(WINDOWS)
    ZigString str;
    Bun__Process__getTitle(globalObject, &str);
    return JSValue::encode(Zig::toJSStringValue(str, globalObject));
#else
    auto& vm = globalObject->vm();
    char title[1024];
    if (uv_get_process_title(title, sizeof(title)) != 0) {
        return JSValue::encode(jsString(vm, String("bun"_s)));
    }

    return JSValue::encode(jsString(vm, WTF::String::fromUTF8(title)));
#endif
}

JSC_DEFINE_CUSTOM_SETTER(setProcessTitle,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSObject* thisObject = JSC::jsDynamicCast<JSC::JSObject*>(JSValue::decode(thisValue));
    JSC::JSString* jsString = JSC::jsDynamicCast<JSC::JSString*>(JSValue::decode(value));
    if (!thisObject || !jsString) {
        return false;
    }
#if !OS(WINDOWS)
    ZigString str = Zig::toZigString(jsString, globalObject);
    Bun__Process__setTitle(globalObject, &str);
    return true;
#else
    WTF::String str = jsString->value(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    CString cstr = str.utf8();
    return uv_set_process_title(cstr.data()) == 0;
#endif
}

JSC_DEFINE_HOST_FUNCTION(Process_functionCwd,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSC::JSValue result = JSC::JSValue::decode(Bun__Process__getCwd(globalObject));
    JSC::JSObject* obj = result.getObject();
    if (UNLIKELY(obj != nullptr && obj->isErrorInstance())) {
        scope.throwException(globalObject, obj);
        return JSValue::encode(JSC::jsUndefined());
    }

    return JSC::JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(Process_functionReallyKill,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    int pid = callFrame->argument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    int signal = callFrame->argument(1).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

#if !OS(WINDOWS)
    int result = kill(pid, signal);
#else
    int result = uv_kill(pid, signal);
#endif

    if (result < 0) {
        throwSystemError(scope, globalObject, "kill"_s, errno);
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}
JSC_DEFINE_HOST_FUNCTION(Process_functionKill,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    int pid = callFrame->argument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (pid < 0) {
        throwNodeRangeError(globalObject, scope, "pid must be a positive integer"_s);
        return JSValue::encode(jsUndefined());
    }

    JSC::JSValue signalValue = callFrame->argument(1);
    int signal = SIGTERM;
    if (signalValue.isNumber()) {
        signal = signalValue.toInt32(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    } else if (signalValue.isString()) {
        loadSignalNumberMap();
        if (auto num = signalNameToNumberMap->get(signalValue.toWTFString(globalObject))) {
            signal = num;
            RETURN_IF_EXCEPTION(scope, {});
        } else {
            throwNodeRangeError(globalObject, scope, "Unknown signal name"_s);
            return JSValue::encode(jsUndefined());
        }

        RETURN_IF_EXCEPTION(scope, {});
    } else if (!signalValue.isUndefinedOrNull()) {
        throwTypeError(globalObject, scope, "signal must be a string or number"_s);
        return JSValue::encode(jsUndefined());
    }

#if OS(WINDOWS)
    int result = uv_kill(pid, signal);
#else
    int result = kill(pid, signal);
#endif

    if (result < 0) {
        throwSystemError(scope, globalObject, "kill"_s, errno);
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsBoolean(true));
}

extern "C" void Process__emitMessageEvent(Zig::GlobalObject* global, EncodedJSValue value)
{
    auto* process = static_cast<Process*>(global->processObject());
    auto& vm = global->vm();

    auto ident = Identifier::fromString(vm, "message"_s);
    if (process->wrapped().hasEventListeners(ident)) {
        JSC::MarkedArgumentBuffer args;
        args.append(JSValue::decode(value));
        process->wrapped().emit(ident, args);
    }
}

extern "C" void Process__emitDisconnectEvent(Zig::GlobalObject* global)
{
    auto* process = static_cast<Process*>(global->processObject());
    auto& vm = global->vm();
    auto ident = Identifier::fromString(vm, "disconnect"_s);
    if (process->wrapped().hasEventListeners(ident)) {
        JSC::MarkedArgumentBuffer args;
        process->wrapped().emit(ident, args);
    }
}

/* Source for Process.lut.h
@begin processObjectTable
  abort                            Process_functionAbort                               Function 1
  allowedNodeEnvironmentFlags      Process_stubEmptySet                                PropertyCallback
  arch                             constructArch                                       PropertyCallback
  argv                             constructArgv                                       PropertyCallback
  argv0                            constructArgv0                                      PropertyCallback
  assert                           Process_functionAssert                              Function 1
  binding                          Process_functionBinding                             Function 1
  browser                          constructBrowser                                    PropertyCallback
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
  execArgv                         constructExecArgv                                   PropertyCallback
  execPath                         constructExecPath                                   PropertyCallback
  exit                             Process_functionExit                                Function 1
  exitCode                         processExitCode                                     CustomAccessor
  features                         constructFeatures                                   PropertyCallback
  getActiveResourcesInfo           Process_stubFunctionReturningArray                  Function 0
  hasUncaughtExceptionCaptureCallback Process_hasUncaughtExceptionCaptureCallback      Function 0
  hrtime                           constructProcessHrtimeObject                        PropertyCallback
  isBun                            constructIsBun                                      PropertyCallback
  kill                             Process_functionKill                                Function 2
  mainModule                       processObjectInternalsMainModuleCodeGenerator       Builtin|Accessor
  memoryUsage                      constructMemoryUsage                                PropertyCallback
  moduleLoadList                   Process_stubEmptyArray                              PropertyCallback
  nextTick                         constructProcessNextTickFn                          PropertyCallback
  openStdin                        Process_functionOpenStdin                           Function 0
  pid                              constructPid                                        PropertyCallback
  platform                         constructPlatform                                   PropertyCallback
  ppid                             constructPpid                                       PropertyCallback
  reallyExit                       Process_functionReallyExit                          Function 1
  release                          constructProcessReleaseObject                       PropertyCallback
  report                           constructProcessReportObject                        PropertyCallback
  revision                         constructRevision                                   PropertyCallback
  setSourceMapsEnabled             Process_stubEmptyFunction                           Function 1
  setUncaughtExceptionCaptureCallback Process_setUncaughtExceptionCaptureCallback      Function 1
  send                             constructProcessSend                                PropertyCallback
  stderr                           constructStderr                                     PropertyCallback
  stdin                            constructStdin                                      PropertyCallback
  stdout                           constructStdout                                     PropertyCallback
  title                            processTitle                                        CustomAccessor
  umask                            Process_functionUmask                               Function 1
  uptime                           Process_functionUptime                              Function 1
  version                          constructVersion                                    PropertyCallback
  versions                         constructVersions                                   PropertyCallback
  _debugEnd                        Process_stubEmptyFunction                           Function 0
  _debugProcess                    Process_stubEmptyFunction                           Function 0
  _fatalException                  Process_stubEmptyFunction                           Function 1
  _getActiveRequests               Process_stubFunctionReturningArray                  Function 0
  _getActiveHandles                Process_stubFunctionReturningArray                  Function 0
  _linkedBinding                   Process_stubEmptyFunction                           Function 0
  _preload_modules                 Process_stubEmptyArray                              PropertyCallback
  _rawDebug                        Process_stubEmptyFunction                           Function 0
  _startProfilerIdleNotifier       Process_stubEmptyFunction                           Function 0
  _stopProfilerIdleNotifier        Process_stubEmptyFunction                           Function 0
  _tickCallback                    Process_stubEmptyFunction                           Function 0
  _kill                            Process_functionReallyKill                          Function 2
#if !OS(WINDOWS)
  getegid                          Process_functiongetegid                             Function 0
  geteuid                          Process_functiongeteuid                             Function 0
  getgid                           Process_functiongetgid                              Function 0
  getgroups                        Process_functiongetgroups                           Function 0
  getuid                           Process_functiongetuid                              Function 0
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

    m_memoryUsageStructure.initLater([](const JSC::LazyProperty<Process, JSC::Structure>::Initializer& init) {
        init.set(constructMemoryUsageStructure(init.vm, init.owner->globalObject()));
    });

    m_bindingUV.initLater([](const JSC::LazyProperty<Process, JSC::JSObject>::Initializer& init) {
        init.set(Bun::ProcessBindingUV::create(init.vm, init.owner->globalObject()));
    });
    m_bindingNatives.initLater([](const JSC::LazyProperty<Process, JSC::JSObject>::Initializer& init) {
        init.set(Bun::ProcessBindingNatives::create(init.vm, ProcessBindingNatives::createStructure(init.vm, init.owner->globalObject())));
    });

    putDirect(vm, vm.propertyNames->toStringTagSymbol, jsString(vm, String("process"_s)), 0);
}

} // namespace Bun
