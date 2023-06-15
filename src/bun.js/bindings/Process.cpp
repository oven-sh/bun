#include "Process.h"
#include "JavaScriptCore/JSMicrotask.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/NumberPrototype.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSONObject.h"
#include "node_api.h"
#include <dlfcn.h>
#include "ZigGlobalObject.h"
#include "headers.h"
#include "JSEnvironmentVariableMap.h"
#include "ImportMetaObject.h"
#include <sys/stat.h>
#include "ZigConsoleClient.h"
#include <gnu/libc-version.h>
#include <link.h>
#pragma mark - Node.js Process

namespace Zig {

using namespace JSC;

#define REPORTED_NODE_VERSION "18.15.0"

#if defined(__APPLE__)
    #define PROCESS_PLATFORM "darwin"
#else
    #define PROCESS_PLATFORM "linux"
#endif

#if defined(__x86_64__)
    #define PROCESS_ARCH "x64"
#elif defined(__i386__)
    #define PROCESS_ARCH "x86"
#elif defined(__arm__)
    #define PROCESS_ARCH "arm"
#elif defined(__aarch64__)
    #define PROCESS_ARCH "arm64"
#else
    #define PROCESS_ARCH "unknown"
#endif

#define GET_PROCESS_VERSIONS_OBJ(VM_OBJ, GLOBAL_OBJ, OBJECT) \
    JSC::JSObject* OBJECT = JSC::constructEmptyObject(GLOBAL_OBJ, GLOBAL_OBJ->objectPrototype(), 19); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "node"_s), \
        JSC::JSValue(JSC::jsOwnedString(VM_OBJ, makeAtomString(REPORTED_NODE_VERSION)))); \
    OBJECT->putDirect( \
        VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "bun"_s), \
        JSC::JSValue(JSC::jsOwnedString(VM_OBJ, makeAtomString(Bun__version + 1 /* prefix with v */)))); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "webkit"_s), \
        JSC::JSValue(JSC::jsOwnedString(VM_OBJ, makeAtomString(BUN_WEBKIT_VERSION)))); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "boringssl"_s), \
        JSC::JSValue(JSC::jsString(VM_OBJ, makeString(Bun__versions_boringssl))), 0); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "libarchive"_s), \
        JSC::JSValue(JSC::jsString(VM_OBJ, makeString(Bun__versions_libarchive))), 0); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "mimalloc"_s), \
        JSC::JSValue(JSC::jsString(VM_OBJ, makeString(Bun__versions_mimalloc))), 0); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "picohttpparser"_s), \
        JSC::JSValue(JSC::jsString(VM_OBJ, makeString(Bun__versions_picohttpparser))), 0); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "uwebsockets"_s), \
        JSC::JSValue(JSC::jsString(VM_OBJ, makeString(Bun__versions_uws))), 0); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "webkit"_s), \
        JSC::JSValue(JSC::jsString(VM_OBJ, makeString(Bun__versions_webkit))), 0); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "zig"_s), \
        JSC::JSValue(JSC::jsString(VM_OBJ, makeString(Bun__versions_zig))), 0); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "zlib"_s), \
        JSC::JSValue(JSC::jsString(VM_OBJ, makeString(Bun__versions_zlib))), 0); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "tinycc"_s), \
        JSC::JSValue(JSC::jsString(VM_OBJ, makeString(Bun__versions_tinycc))), 0); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "lolhtml"_s), \
        JSC::JSValue(JSC::jsString(VM_OBJ, makeString(Bun__versions_lolhtml))), 0); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "ares"_s), \
        JSC::JSValue(JSC::jsString(VM_OBJ, makeString(Bun__versions_c_ares))), 0); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "usockets"_s), \
        JSC::JSValue(JSC::jsString(VM_OBJ, makeString(Bun__versions_usockets))), 0); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "v8"_s), JSValue(JSC::jsString(VM_OBJ, makeString("10.8.168.20-node.8"_s))), 0); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "uv"_s), JSValue(JSC::jsString(VM_OBJ, makeString("1.44.2"_s))), 0); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "napi"_s), JSValue(JSC::jsString(VM_OBJ, makeString("8"_s))), 0); \
    OBJECT->putDirect(VM_OBJ, JSC::Identifier::fromString(VM_OBJ, "modules"_s), \
        JSC::JSValue(JSC::jsOwnedString(VM_OBJ, makeAtomString("108"))))

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

static JSC_DECLARE_CUSTOM_SETTER(Process_setTitle);
static JSC_DECLARE_CUSTOM_GETTER(Process_getArgv);
static JSC_DECLARE_CUSTOM_SETTER(Process_setArgv);
static JSC_DECLARE_CUSTOM_GETTER(Process_getTitle);
static JSC_DECLARE_CUSTOM_GETTER(Process_getVersionsLazy);
static JSC_DECLARE_CUSTOM_SETTER(Process_setVersionsLazy);

static JSC_DECLARE_CUSTOM_GETTER(Process_getPID);
static JSC_DECLARE_CUSTOM_GETTER(Process_getPPID);

static JSC_DECLARE_HOST_FUNCTION(Process_functionCwd);

static JSValue constructStdioWriteStream(JSC::JSGlobalObject* globalObject, int fd)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    JSC::JSFunction* getStdioWriteStream = JSC::JSFunction::create(vm, processObjectInternalsGetStdioWriteStreamCodeGenerator(vm), globalObject);
    JSC::MarkedArgumentBuffer args;
    WTF::String process = WTF::String("node:process"_s);
    JSC::JSValue requireFunction = Zig::ImportMetaObject::createRequireFunction(
        vm,
        globalObject,
        process);

    args.append(JSC::jsNumber(fd));
    args.append(requireFunction);

    auto clientData = WebCore::clientData(vm);
    JSC::CallData callData = JSC::getCallData(getStdioWriteStream);

    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::call(globalObject, getStdioWriteStream, callData, globalObject->globalThis(), args, returnedException);
    RETURN_IF_EXCEPTION(scope, {});

    if (returnedException) {
        throwException(globalObject, scope, returnedException.get());
        return {};
    }

    return result;
}

JSC_DEFINE_CUSTOM_GETTER(
    Process_lazyStdinGetter,
    (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName property))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue value = JSC::JSValue::decode(thisValue);
    if (!value || value.isUndefinedOrNull() || !value.isObject())
        return JSValue::encode(jsUndefined());

    auto* thisObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    JSC::JSFunction* getStdioWriteStream = JSC::JSFunction::create(vm, processObjectInternalsGetStdinStreamCodeGenerator(vm), globalObject);
    JSC::MarkedArgumentBuffer args;
    WTF::String process = WTF::String("node:process"_s);
    JSC::JSValue requireFunction = Zig::ImportMetaObject::createRequireFunction(
        vm,
        globalObject,
        process);

    args.append(JSC::jsNumber(STDIN_FILENO));
    args.append(requireFunction);
    args.append(thisObject->get(globalObject, PropertyName(JSC::Identifier::fromString(vm, "Bun"_s))));

    auto clientData = WebCore::clientData(vm);
    JSC::CallData callData = JSC::getCallData(getStdioWriteStream);

    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::call(globalObject, getStdioWriteStream, callData, globalObject->globalThis(), args, returnedException);
    RETURN_IF_EXCEPTION(scope, {});

    if (UNLIKELY(returnedException)) {
        throwException(globalObject, scope, returnedException.get());
        return {};
    }

    if (LIKELY(result))
        value.getObject()->putDirect(vm, property, result, 0);

    return JSValue::encode(result);
}

JSC_DEFINE_CUSTOM_GETTER(
    Process_lazyStdoutGetter,
    (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName property))
{
    JSValue value = JSValue::decode(thisValue);
    auto& vm = globalObject->vm();
    JSC::JSObject* thisObject = value.toObject(globalObject);
    JSC::JSValue stream = constructStdioWriteStream(globalObject, 1);

    if (stream)
        thisObject->putDirect(vm, property, stream, 0);

    return JSValue::encode(stream);
}

JSC_DEFINE_CUSTOM_GETTER(
    Process_lazyStderrGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName property))
{
    JSValue value = JSValue::decode(thisValue);
    auto& vm = globalObject->vm();
    JSC::JSObject* thisObject = value.toObject(globalObject);
    JSC::JSValue stream = constructStdioWriteStream(globalObject, 2);

    if (stream)
        thisObject->putDirect(vm, property, stream, 0);

    return JSValue::encode(stream);
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

JSC_DECLARE_HOST_FUNCTION(Process_functionNextTick);
JSC_DEFINE_HOST_FUNCTION(Process_functionNextTick,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto argCount = callFrame->argumentCount();
    if (argCount == 0) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "nextTick requires 1 argument (a function)"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSC::JSValue job = callFrame->uncheckedArgument(0);

    if (!job.isObject() || !job.getObject()->isCallable()) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "nextTick expects a function"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    Zig::GlobalObject* global = JSC::jsCast<Zig::GlobalObject*>(globalObject);

    switch (callFrame->argumentCount()) {
    case 1: {
        global->queueMicrotask(global->performMicrotaskFunction(), job, JSC::JSValue {}, JSC::JSValue {}, JSC::JSValue {});
        break;
    }
    case 2: {
        global->queueMicrotask(global->performMicrotaskFunction(), job, callFrame->uncheckedArgument(1), JSC::JSValue {}, JSC::JSValue {});
        break;
    }
    case 3: {
        global->queueMicrotask(global->performMicrotaskFunction(), job, callFrame->uncheckedArgument(1), callFrame->uncheckedArgument(2), JSC::JSValue {});
        break;
    }
    case 4: {
        global->queueMicrotask(global->performMicrotaskFunction(), job, callFrame->uncheckedArgument(1), callFrame->uncheckedArgument(2), callFrame->uncheckedArgument(3));
        break;
    }
    default: {
        JSC::JSArray* args = JSC::constructEmptyArray(globalObject, nullptr, argCount - 1);
        if (UNLIKELY(!args)) {
            auto scope = DECLARE_THROW_SCOPE(vm);
            throwVMError(globalObject, scope, createOutOfMemoryError(globalObject));
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        for (unsigned i = 1; i < argCount; i++) {
            args->putDirectIndex(globalObject, i - 1, callFrame->uncheckedArgument(i));
        }

        global->queueMicrotask(
            global->performMicrotaskVariadicFunction(), job, args, JSValue {}, JSC::JSValue {});

        break;
    }
    }

    return JSC::JSValue::encode(jsUndefined());
}

JSC_DECLARE_HOST_FUNCTION(Process_functionDlopen);
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
    if (!moduleValue.isObject()) {
        JSC::throwTypeError(globalObject, scope, "dlopen requires an object as first argument"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    JSC::Identifier exportsSymbol = JSC::Identifier::fromString(vm, "exports"_s);
    JSC::JSObject* exports = moduleValue.getObject()->getIfPropertyExists(globalObject, exportsSymbol).getObject();

    WTF::String filename = callFrame->uncheckedArgument(1).toWTFString(globalObject);
    CString utf8 = filename.utf8();

    globalObject->pendingNapiModule = exports;
    void* handle = dlopen(utf8.data(), RTLD_LAZY);

    if (!handle) {
        WTF::String msg = WTF::String::fromUTF8(dlerror());
        JSC::throwTypeError(globalObject, scope, msg);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    if (callCountAtStart != globalObject->napiModuleRegisterCallCount) {
        JSValue pendingModule = globalObject->pendingNapiModule;
        globalObject->pendingNapiModule = JSValue {};
        globalObject->napiModuleRegisterCallCount = 0;

        if (pendingModule) {
            if (pendingModule.isCell() && pendingModule.getObject()->isErrorInstance()) {
                JSC::throwException(globalObject, scope, pendingModule);
                return JSC::JSValue::encode(JSC::JSValue {});
            }
            return JSC::JSValue::encode(pendingModule);
        }
    }

    JSC::EncodedJSValue (*napi_register_module_v1)(JSC::JSGlobalObject * globalObject,
        JSC::EncodedJSValue exports);

    napi_register_module_v1 = reinterpret_cast<JSC::EncodedJSValue (*)(JSC::JSGlobalObject*,
        JSC::EncodedJSValue)>(
        dlsym(handle, "napi_register_module_v1"));

    if (!napi_register_module_v1) {
        dlclose(handle);
        JSC::throwTypeError(globalObject, scope, "symbol 'napi_register_module_v1' not found in native module. Is this a Node API (napi) module?"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    return napi_register_module_v1(globalObject, JSC::JSValue::encode(exports));
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
        throwRangeError(globalObject, throwScope, "The \"mask\" argument must be an integer"_s);
        return JSValue::encode({});
    }

    double number = numberValue.toNumber(globalObject);
    int64_t newUmask = isInt52(number) ? tryConvertToInt52(number) : numberValue.toInt32(globalObject);
    RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::JSValue {}));
    if (newUmask < 0 || newUmask > 4294967295) {
        StringBuilder messageBuilder;
        messageBuilder.append("The \"mask\" value must be in range [0, 4294967295]. Received value: "_s);
        messageBuilder.append(int52ToString(vm, newUmask, 10)->getString(globalObject));
        throwRangeError(globalObject, throwScope, messageBuilder.toString());
        return JSValue::encode({});
    }

    return JSC::JSValue::encode(JSC::jsNumber(umask(newUmask)));
}

extern "C" uint64_t Bun__readOriginTimer(void*);
extern "C" double Bun__readOriginTimerStart(void*);

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
    if (callFrame->argumentCount() == 0) {
        // TODO: exitCode
        Bun__Process__exit(globalObject, 0);
    } else {
        Bun__Process__exit(globalObject, callFrame->argument(0).toInt32(globalObject));
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

extern "C" uint64_t Bun__readOriginTimer(void*);

JSC_DEFINE_HOST_FUNCTION(Process_functionHRTime,
    (JSC::JSGlobalObject * globalObject_, JSC::CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject
        = reinterpret_cast<Zig::GlobalObject*>(globalObject_);
    auto& vm = globalObject->vm();
    uint64_t time = Bun__readOriginTimer(globalObject->bunVM());
    int64_t seconds = static_cast<int64_t>(time / 1000000000);
    int64_t nanoseconds = time % 1000000000;

    if (callFrame->argumentCount() > 0) {
        JSC::JSValue arg0 = callFrame->uncheckedArgument(0);
        if (!arg0.isUndefinedOrNull()) {
            JSArray* relativeArray = JSC::jsDynamicCast<JSC::JSArray*>(arg0);
            auto throwScope = DECLARE_THROW_SCOPE(vm);
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
            throwScope.release();
        }
    }

    auto* array = JSArray::create(vm, globalObject->originalArrayStructureForIndexingType(ArrayWithContiguous), 2);
    array->setIndexQuickly(vm, 0, JSC::jsNumber(seconds));
    array->setIndexQuickly(vm, 1, JSC::jsNumber(nanoseconds));
    return JSC::JSValue::encode(JSC::JSValue(array));
}
static JSC_DECLARE_HOST_FUNCTION(Process_functionHRTimeBigInt);

static JSC_DEFINE_HOST_FUNCTION(Process_functionHRTimeBigInt,
    (JSC::JSGlobalObject * globalObject_, JSC::CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject_);
    return JSC::JSValue::encode(JSValue(JSC::JSBigInt::createFrom(globalObject, Bun__readOriginTimer(globalObject->bunVM()))));
}

static JSC_DECLARE_HOST_FUNCTION(Process_functionChdir);

static JSC_DEFINE_HOST_FUNCTION(Process_functionChdir,
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

extern "C" const char* Bun__githubURL;

JSC_DEFINE_CUSTOM_GETTER(Process_getterRelease, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = globalObject->vm();

    auto* release = JSC::constructEmptyObject(globalObject);
    release->putDirect(vm, Identifier::fromString(vm, "name"_s), jsString(vm, WTF::String("bun"_s)), 0);
    release->putDirect(vm, Identifier::fromString(vm, "lts"_s), jsBoolean(false), 0);
    release->putDirect(vm, Identifier::fromString(vm, "sourceUrl"_s), jsString(vm, WTF::String(Bun__githubURL, strlen(Bun__githubURL))), 0);
    release->putDirect(vm, Identifier::fromString(vm, "headersUrl"_s), jsEmptyString(vm), 0);
    release->putDirect(vm, Identifier::fromString(vm, "libUrl"_s), jsEmptyString(vm), 0);

    return JSValue::encode(release);
}

JSC_DEFINE_CUSTOM_SETTER(Process_setterRelease,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    JSC::VM& vm = globalObject->vm();

    JSC::JSObject* thisObject = JSC::jsDynamicCast<JSC::JSObject*>(JSValue::decode(thisValue));
    thisObject->putDirect(vm, JSC::Identifier::fromString(vm, "release"_s), JSValue::decode(value), 0);

    return true;
}

struct dl_phdrCallbackData {
    JSC::JSGlobalObject* globalObject;
    JSC::JSArray* sharedObjs;
};
int dl_phdrCallback(struct ::dl_phdr_info* info, size_t size, void* data) {
    dl_phdrCallbackData* callbackData = reinterpret_cast<dl_phdrCallbackData*>(data);
    JSC::JSGlobalObject* globalObject = callbackData->globalObject;
    if (!info->dlpi_name || info->dlpi_name[0] == '\0') return 0;

    callbackData->sharedObjs->push(globalObject, jsString(globalObject->vm(), makeAtomString(info->dlpi_name)));
    return 0;
};
JSC_DEFINE_HOST_FUNCTION(Process_functionGetReport,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();

    std::chrono::time_point now = std::chrono::system_clock::now();
    int64_t timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
    int64_t timeSeconds = timestamp / 1000;
    char timeString[21];
    strftime(timeString, sizeof(timeString), "%FT%TZ", gmtime(&timeSeconds));

    GET_PROCESS_VERSIONS_OBJ(vm, globalObject, componentVersions);

    auto* header = JSC::constructEmptyObject(globalObject);
    header->putDirect(vm, Identifier::fromString(vm, "reportVersion"_s), jsNumber(3));
    header->putDirect(vm, Identifier::fromString(vm, "event"_s), jsString(vm, WTF::String("JavaScript API"_s)));
    header->putDirect(vm, Identifier::fromString(vm, "trigger"_s), jsString(vm, WTF::String("GetReport"_s)));
    header->putDirect(vm, Identifier::fromString(vm, "filename"_s), jsNull());
    header->putDirect(vm, Identifier::fromString(vm, "dumpEventTime"_s), jsString(vm, makeAtomString(timeString)));
    header->putDirect(vm, Identifier::fromString(vm, "dumpEventTimeStamp"_s), jsNumber(timestamp));
    header->putDirect(vm, Identifier::fromString(vm, "processId"_s), JSC::JSValue(getpid()));
    header->putDirect(vm, Identifier::fromString(vm, "threadId"_s), jsNumber(0));
    header->putDirect(vm, Identifier::fromString(vm, "cwd"_s), JSC::JSValue::decode(Process_functionCwd(globalObject, callFrame)));
    header->putDirect(vm, Identifier::fromString(vm, "commandLine"_s), globalObject->getIfPropertyExists(
            globalObject, Identifier::fromString(vm, "Bun"_s)).get(globalObject, Identifier::fromString(vm, "argv"_s)));
    header->putDirect(vm, Identifier::fromString(vm, "nodejsVersion"_s), jsString(vm, makeString("v", REPORTED_NODE_VERSION)));
    header->putDirect(vm, Identifier::fromString(vm, "glibcVersionRuntime"_s), jsString(vm, makeString(gnu_get_libc_version())));
    header->putDirect(vm, Identifier::fromString(vm, "glibcVersionCompiler"_s), jsString(vm, makeString(__GLIBC__, '.', __GLIBC_MINOR__)));
    header->putDirect(vm, Identifier::fromString(vm, "wordSize"_s), jsNumber(64));
    header->putDirect(vm, Identifier::fromString(vm, "arch"_s), jsString(vm, makeAtomString(PROCESS_ARCH)));
    header->putDirect(vm, Identifier::fromString(vm, "platform"_s), jsString(vm, makeAtomString(PROCESS_PLATFORM)));
    header->putDirect(vm, Identifier::fromString(vm, "componentVersions"_s), componentVersions);
    header->putDirect(vm, Identifier::fromString(vm, "release"_s), JSC::JSValue::decode(Process_getterRelease(globalObject, JSValue::encode(jsUndefined()), nullptr)));
    header->putDirect(vm, Identifier::fromString(vm, "osName"_s), jsEmptyString(vm));    // TODO: os.type()
    header->putDirect(vm, Identifier::fromString(vm, "osRelease"_s), jsEmptyString(vm)); // TODO: os.release()
    header->putDirect(vm, Identifier::fromString(vm, "osVersion"_s), jsEmptyString(vm)); // TODO: os.version()
    header->putDirect(vm, Identifier::fromString(vm, "osMachine"_s), jsEmptyString(vm)); // TODO: os.machine()
    header->putDirect(vm, Identifier::fromString(vm, "cpus"_s), JSC::constructEmptyArray(globalObject, nullptr)); // TODO: os.cpus()
    header->putDirect(vm, Identifier::fromString(vm, "networkInterfaces"_s), JSC::constructEmptyArray(globalObject, nullptr)); // TODO: os.networkInterfaces()
    header->putDirect(vm, Identifier::fromString(vm, "host"_s), jsEmptyString(vm)); // TODO: os.hostname()

    auto* jsStack = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 3);
    jsStack->putDirect(vm, Identifier::fromString(vm, "message"_s), jsString(vm, WTF::String("Error [ERR_SYNTHETIC]: JavaScript Callstack"_s)));
    jsStack->putDirect(vm, Identifier::fromString(vm, "stack"_s), JSC::constructEmptyArray(globalObject, nullptr));
    auto* jsStack_ErrorProps = JSC::constructEmptyObject(globalObject);
    jsStack_ErrorProps->putDirect(vm, Identifier::fromString(vm, "code"_s), jsString(vm, WTF::String("ERR_SYNTHETIC"_s)));
    jsStack->putDirect(vm, Identifier::fromString(vm, "errorProperties"_s), jsStack_ErrorProps);

    // Not implemented stubs
    auto* jsHeap = JSC::constructEmptyObject(globalObject);
    auto* nativeStack = JSC::constructEmptyArray(globalObject, nullptr);
    auto* resUsage = JSC::constructEmptyObject(globalObject);
    auto* uvthreadResUsage = JSC::constructEmptyObject(globalObject);
    auto* libuv = JSC::constructEmptyArray(globalObject, nullptr);
    auto* workers = JSC::constructEmptyArray(globalObject, nullptr);
    auto* userLimits = JSC::constructEmptyObject(globalObject);

    auto* process = jsCast<Zig::Process*>(static_cast<Zig::GlobalObject*>(globalObject)->processObject());
    auto envVars = process->getIfPropertyExists(globalObject, Identifier::fromString(vm, "env"_s));

    auto* sharedObjs = JSC::constructEmptyArray(globalObject, nullptr);
    dl_phdrCallbackData callbackData = { globalObject, sharedObjs };
    dl_iterate_phdr(dl_phdrCallback, &callbackData);

    auto* report = JSC::constructEmptyObject(globalObject);
    report->putDirect(vm, Identifier::fromString(vm, "header"_s), header, 0);
    report->putDirect(vm, Identifier::fromString(vm, "javascriptStack"_s), jsStack, 0);
    report->putDirect(vm, Identifier::fromString(vm, "javascriptHeap"_s), jsHeap, 0);
    report->putDirect(vm, Identifier::fromString(vm, "nativeStack"_s), nativeStack, 0);
    report->putDirect(vm, Identifier::fromString(vm, "resourceUsage"_s), resUsage, 0);
    report->putDirect(vm, Identifier::fromString(vm, "uvthreadResourceUsage"_s), uvthreadResUsage, 0);
    report->putDirect(vm, Identifier::fromString(vm, "libuv"_s), libuv, 0);
    report->putDirect(vm, Identifier::fromString(vm, "workers"_s), workers, 0);
    report->putDirect(vm, Identifier::fromString(vm, "environmentVariables"_s), envVars, 0);
    report->putDirect(vm, Identifier::fromString(vm, "userLimits"_s), userLimits, 0);
    report->putDirect(vm, Identifier::fromString(vm, "sharedObjects"_s), sharedObjs, 0);

    return JSValue::encode(report);
}

JSC_DEFINE_HOST_FUNCTION(Process_functionWriteReport,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    JSC::JSObject* report = JSC::JSValue::decode(Process_functionGetReport(globalObject, callFrame)).getObject();
    JSC::JSObject* header = report->getDirect(vm, Identifier::fromString(vm, "header"_s)).getObject();
    header->putDirect(vm, Identifier::fromString(vm, "trigger"_s), jsString(vm, WTF::String("API"_s)));

    char timeString[24];
    std::chrono::time_point now = std::chrono::system_clock::now();
    int64_t timeSeconds = std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch()).count();
    strftime(timeString, sizeof(timeString), "report.%Y%m%d.%H%M%S.", gmtime(&timeSeconds));
    WTF::String filename = makeString(timeString, getpid(), ".0.001.json");
    JSC::JSString* filenameJSString = jsString(vm, filename);
    header->putDirect(vm, Identifier::fromString(vm, "filename"_s), filenameJSString);

    fprintf(stderr, "Writing Bun.js report to file: %s\n", filename.ascii().data());

    WTF::String reportJsonString = JSC::JSONStringify(globalObject, report, 2);
    FILE* reportFile = fopen(filename.ascii().data(), "w");
    fprintf(reportFile, "%s", reportJsonString.utf8().data());
    fclose(reportFile);

    fprintf(stderr, "Bun.js report completed\n");

    return JSValue::encode(filenameJSString);
}

JSC_DEFINE_CUSTOM_GETTER(Process_getterReport, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = globalObject->vm();
    auto* reportObj = JSC::constructEmptyObject(globalObject);

    JSC::JSFunction* writeReport = JSC::JSFunction::create(vm, globalObject, 0,
        MAKE_STATIC_STRING_IMPL("writeReport"), Process_functionWriteReport, ImplementationVisibility::Public);
    JSC::JSFunction* getReport = JSC::JSFunction::create(vm, globalObject, 0,
        MAKE_STATIC_STRING_IMPL("getReport"), Process_functionGetReport, ImplementationVisibility::Public);

    reportObj->putDirect(vm, Identifier::fromString(vm, "writeReport"_s), writeReport, 0);
    reportObj->putDirect(vm, Identifier::fromString(vm, "getReport"_s), getReport, 0);

    // TODO:
    // These are currently marked ReadOnly with their default values so code which only reads them can work,
    // but trying to set them should error as their actual functionalities are not yet implemented.
    // See: https://nodejs.org/api/process.html#processreport and https://nodejs.org/api/report.html#configuration
    reportObj->putDirect(vm, Identifier::fromString(vm, "directory"_s), jsEmptyString(vm), static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly));
    reportObj->putDirect(vm, Identifier::fromString(vm, "filename"_s), jsEmptyString(vm), static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly));
    reportObj->putDirect(vm, Identifier::fromString(vm, "compact"_s), jsBoolean(false), static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly));
    reportObj->putDirect(vm, Identifier::fromString(vm, "signal"_s), jsString(vm, WTF::String("SIGUSR2"_s)), static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly));
    reportObj->putDirect(vm, Identifier::fromString(vm, "reportOnFatalError"_s), jsBoolean(false), static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly));
    reportObj->putDirect(vm, Identifier::fromString(vm, "reportOnSignal"_s), jsBoolean(false), static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly));
    reportObj->putDirect(vm, Identifier::fromString(vm, "reportOnUncaughtException"_s), jsBoolean(false), static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly));

    return JSValue::encode(reportObj);
}

// static const NeverDestroyed<String> signalNames[] = {
//     MAKE_STATIC_STRING_IMPL("SIGHUP"),
//     MAKE_STATIC_STRING_IMPL("SIGINT"),
//     MAKE_STATIC_STRING_IMPL("SIGQUIT"),
//     MAKE_STATIC_STRING_IMPL("SIGILL"),
//     MAKE_STATIC_STRING_IMPL("SIGTRAP"),
//     MAKE_STATIC_STRING_IMPL("SIGABRT"),
//     MAKE_STATIC_STRING_IMPL("SIGIOT"),
//     MAKE_STATIC_STRING_IMPL("SIGBUS"),
//     MAKE_STATIC_STRING_IMPL("SIGFPE"),
//     MAKE_STATIC_STRING_IMPL("SIGKILL"),
//     MAKE_STATIC_STRING_IMPL("SIGUSR1"),
//     MAKE_STATIC_STRING_IMPL("SIGSEGV"),
//     MAKE_STATIC_STRING_IMPL("SIGUSR2"),
//     MAKE_STATIC_STRING_IMPL("SIGPIPE"),
//     MAKE_STATIC_STRING_IMPL("SIGALRM"),
//     MAKE_STATIC_STRING_IMPL("SIGTERM"),
//     MAKE_STATIC_STRING_IMPL("SIGCHLD"),
//     MAKE_STATIC_STRING_IMPL("SIGCONT"),
//     MAKE_STATIC_STRING_IMPL("SIGSTOP"),
//     MAKE_STATIC_STRING_IMPL("SIGTSTP"),
//     MAKE_STATIC_STRING_IMPL("SIGTTIN"),
//     MAKE_STATIC_STRING_IMPL("SIGTTOU"),
//     MAKE_STATIC_STRING_IMPL("SIGURG"),
//     MAKE_STATIC_STRING_IMPL("SIGXCPU"),
//     MAKE_STATIC_STRING_IMPL("SIGXFSZ"),
//     MAKE_STATIC_STRING_IMPL("SIGVTALRM"),
//     MAKE_STATIC_STRING_IMPL("SIGPROF"),
//     MAKE_STATIC_STRING_IMPL("SIGWINCH"),
//     MAKE_STATIC_STRING_IMPL("SIGIO"),
//     MAKE_STATIC_STRING_IMPL("SIGINFO"),
//     MAKE_STATIC_STRING_IMPL("SIGSYS"),
// };
// static const int signalNumbers[] = {
//     SIGHUP,
//     SIGINT,
//     SIGQUIT,
//     SIGILL,
//     SIGTRAP,
//     SIGABRT,
//     SIGIOT,
//     SIGBUS,
//     SIGFPE,
//     SIGKILL,
//     SIGUSR1,
//     SIGSEGV,
//     SIGUSR2,
//     SIGPIPE,
//     SIGALRM,
//     SIGTERM,
//     SIGCHLD,
//     SIGCONT,
//     SIGSTOP,
//     SIGTSTP,
//     SIGTTIN,
//     SIGTTOU,
//     SIGURG,
//     SIGXCPU,
//     SIGXFSZ,
//     SIGVTALRM,
//     SIGPROF,
//     SIGWINCH,
//     SIGIO,
//     SIGINFO,
//     SIGSYS,
// };

// JSC_DEFINE_HOST_FUNCTION(jsFunctionProcessOn, (JSGlobalObject * globalObject, CallFrame* callFrame))
// {
//     VM& vm = globalObject->vm();
//     auto scope = DECLARE_THROW_SCOPE(vm);

//     if (callFrame->argumentCount() < 2) {
//         throwVMError(globalObject, scope, "Not enough arguments"_s);
//         return JSValue::encode(jsUndefined());
//     }

//     String eventName = callFrame->uncheckedArgument(0).toWTFString(globalObject);
//     RETURN_IF_EXCEPTION(scope, encodedJSValue());
// }

Process::~Process()
{
    for (auto& listener : this->wrapped().eventListenerMap().entries()) {
    }
}

JSC_DEFINE_HOST_FUNCTION(Process_functionAbort, (JSGlobalObject * globalObject, CallFrame*))
{
    abort();
    __builtin_unreachable();
}

JSC_DEFINE_HOST_FUNCTION(Process_emitWarning, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        throwVMError(globalObject, scope, "Not enough arguments"_s);
        return JSValue::encode(jsUndefined());
    }

    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    auto* process = jsCast<Process*>(globalObject->processObject());

    auto getError = [&]() -> JSValue {
        JSValue arg0 = callFrame->uncheckedArgument(0);
        if (!arg0.isEmpty() && arg0.isCell() && arg0.asCell()->type() == ErrorInstanceType) {
            return arg0;
        }

        WTF::String str = arg0.toWTFString(globalObject);
        return createError(globalObject, str);
    };

    auto ident = Identifier::fromString(vm, "warning"_s);
    if (process->wrapped().hasEventListeners(ident)) {
        JSC::MarkedArgumentBuffer args;
        args.append(getError());

        process->wrapped().emit(ident, args);
        return JSValue::encode(jsUndefined());
    }

    auto jsArgs = JSValue::encode(getError());
    Zig__ConsoleClient__messageWithTypeAndLevel(reinterpret_cast<Zig::ConsoleClient*>(globalObject->consoleClient().get())->m_client, static_cast<uint32_t>(MessageType::Log),
        static_cast<uint32_t>(MessageLevel::Warning), globalObject, &jsArgs, 1);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(Process_lazyArgv0Getter, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName name))
{
    JSC::JSObject* thisObject = JSValue::decode(thisValue).getObject();
    EncodedJSValue ret = Bun__Process__getArgv0(globalObject);

    if (LIKELY(thisObject)) {
        thisObject->putDirect(globalObject->vm(), name, JSValue::decode(ret), 0);
    }

    return ret;
}

JSC_DEFINE_CUSTOM_GETTER(Process_lazyExecArgvGetter, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName name))
{
    JSC::JSObject* thisObject = JSValue::decode(thisValue).getObject();
    EncodedJSValue ret = Bun__Process__getExecArgv(globalObject);

    if (LIKELY(thisObject)) {
        thisObject->putDirect(globalObject->vm(), name, JSValue::decode(ret), 0);
    }

    return ret;
}

JSC_DEFINE_CUSTOM_GETTER(Process_lazyExecPathGetter, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName name))
{
    JSC::JSObject* thisObject = JSValue::decode(thisValue).getObject();
    EncodedJSValue ret = Bun__Process__getExecPath(globalObject);

    if (LIKELY(thisObject)) {
        thisObject->putDirect(globalObject->vm(), name, JSValue::decode(ret), 0);
    }

    return ret;
}

void Process::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    auto clientData = WebCore::clientData(vm);
    auto* globalObject = reinterpret_cast<Zig::GlobalObject*>(this->globalObject());

    putDirectCustomAccessor(vm, clientData->builtinNames().pidPublicName(),
        JSC::CustomGetterSetter::create(vm, Process_getPID, nullptr),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));

    putDirectCustomAccessor(vm, clientData->builtinNames().ppidPublicName(),
        JSC::CustomGetterSetter::create(vm, Process_getPPID, nullptr),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));

    putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, "title"_s),
        JSC::CustomGetterSetter::create(vm, Process_getTitle, Process_setTitle),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));

    putDirectCustomAccessor(vm, clientData->builtinNames().argvPublicName(),
        JSC::CustomGetterSetter::create(vm, Process_getArgv, Process_setArgv),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));

    putDirect(vm, JSC::Identifier::fromString(vm, "revision"_s),
        JSC::jsString(vm, makeAtomString(Bun__version_sha)), 0);

    this->putDirect(vm, clientData->builtinNames().nextTickPublicName(),
        JSC::JSFunction::create(vm, globalObject, 1,
            MAKE_STATIC_STRING_IMPL("nextTick"), Process_functionNextTick, ImplementationVisibility::Public),
        PropertyAttribute::Function | 0);

    this->putDirect(vm, JSC::Identifier::fromString(vm, "dlopen"_s),
        JSC::JSFunction::create(vm, globalObject, 1,
            MAKE_STATIC_STRING_IMPL("dlopen"), Process_functionDlopen, ImplementationVisibility::Public),
        PropertyAttribute::Function | 0);

    this->putDirect(vm, clientData->builtinNames().cwdPublicName(),
        JSC::JSFunction::create(vm, globalObject, 0,
            MAKE_STATIC_STRING_IMPL("cwd"), Process_functionCwd, ImplementationVisibility::Public),
        PropertyAttribute::Function | 0);

    this->putDirect(vm, clientData->builtinNames().chdirPublicName(),
        JSC::JSFunction::create(vm, globalObject, 0,
            MAKE_STATIC_STRING_IMPL("chdir"), Process_functionChdir, ImplementationVisibility::Public),
        PropertyAttribute::Function | 0);

    this->putDirect(vm, JSC::Identifier::fromString(vm, "exit"_s),
        JSC::JSFunction::create(vm, globalObject, 0,
            MAKE_STATIC_STRING_IMPL("exit"), Process_functionExit, ImplementationVisibility::Public),
        PropertyAttribute::Function | 0);

    putDirectCustomAccessor(
        vm, clientData->builtinNames().versionsPublicName(),
        JSC::CustomGetterSetter::create(vm, Process_getVersionsLazy, Process_setVersionsLazy), 0);
    // this should be transpiled out, but just incase
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "browser"_s),
        JSC::JSValue(false));

    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "exitCode"_s),
        JSC::JSValue(JSC::jsNumber(0)));

    this->putDirect(this->vm(), clientData->builtinNames().versionPublicName(),
        JSC::jsString(this->vm(), makeString("v", REPORTED_NODE_VERSION)));

    // this gives some way of identifying at runtime whether the SSR is happening in node or not.
    // this should probably be renamed to what the name of the bundler is, instead of "notNodeJS"
    // but it must be something that won't evaluate to truthy in Node.js
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "isBun"_s), JSC::JSValue(true));

    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "platform"_s),
        JSC::jsString(this->vm(), makeAtomString(PROCESS_PLATFORM)));

    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "arch"_s),
        JSC::jsString(this->vm(), makeAtomString(PROCESS_ARCH)));

    JSC::JSFunction* hrtime = JSC::JSFunction::create(vm, globalObject, 0,
        MAKE_STATIC_STRING_IMPL("hrtime"), Process_functionHRTime, ImplementationVisibility::Public);

    JSC::JSFunction* hrtimeBigInt = JSC::JSFunction::create(vm, globalObject, 0,
        MAKE_STATIC_STRING_IMPL("bigint"), Process_functionHRTimeBigInt, ImplementationVisibility::Public);

    hrtime->putDirect(vm, JSC::Identifier::fromString(vm, "bigint"_s), hrtimeBigInt);
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "hrtime"_s), hrtime);

    this->putDirectCustomAccessor(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "release"_s)),
        JSC::CustomGetterSetter::create(vm, Process_getterRelease, Process_setterRelease), 0);

    this->putDirectCustomAccessor(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "report"_s)),
        JSC::CustomGetterSetter::create(vm, Process_getterReport, nullptr), 0);

    this->putDirectCustomAccessor(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "stdout"_s)),
        JSC::CustomGetterSetter::create(vm, Process_lazyStdoutGetter, Process_defaultSetter), 0);

    this->putDirectCustomAccessor(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "stderr"_s)),
        JSC::CustomGetterSetter::create(vm, Process_lazyStderrGetter, Process_defaultSetter), 0);

    this->putDirectCustomAccessor(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "stdin"_s)),
        JSC::CustomGetterSetter::create(vm, Process_lazyStdinGetter, Process_defaultSetter), 0);

    this->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(this->vm(), "abort"_s),
        0, Process_functionAbort, ImplementationVisibility::Public, NoIntrinsic, 0);

    this->putDirectCustomAccessor(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "argv0"_s)),
        JSC::CustomGetterSetter::create(vm, Process_lazyArgv0Getter, Process_defaultSetter), 0);

    this->putDirectCustomAccessor(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "execPath"_s)),
        JSC::CustomGetterSetter::create(vm, Process_lazyExecPathGetter, Process_defaultSetter), 0);

    this->putDirectCustomAccessor(vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "execArgv"_s)),
        JSC::CustomGetterSetter::create(vm, Process_lazyExecArgvGetter, Process_defaultSetter), 0);

    this->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(this->vm(), "uptime"_s),
        0, Process_functionUptime, ImplementationVisibility::Public, NoIntrinsic, 0);

    this->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(this->vm(), "umask"_s),
        1, Process_functionUmask, ImplementationVisibility::Public, NoIntrinsic, 0);

    this->putDirectBuiltinFunction(vm, globalObject, JSC::Identifier::fromString(this->vm(), "binding"_s),
        processObjectInternalsBindingCodeGenerator(vm),
        0);

    this->putDirect(vm, vm.propertyNames->toStringTagSymbol, jsString(vm, String("process"_s)), 0);

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
    variables->putDirect(vm, JSC::Identifier::fromString(vm, "v8_enable_i18n_support"_s),
        JSC::jsNumber(1), 0);
    config->putDirect(vm, JSC::Identifier::fromString(vm, "target_defaults"_s), JSC::constructEmptyObject(globalObject), 0);
    config->putDirect(vm, JSC::Identifier::fromString(vm, "variables"_s), variables, 0);
    this->putDirect(vm, JSC::Identifier::fromString(vm, "config"_s), config, 0);

    this->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(this->vm(), "emitWarning"_s),
        1, Process_emitWarning, ImplementationVisibility::Public, NoIntrinsic, 0);
}

const JSC::ClassInfo Process::s_info = { "Process"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(Process) };

JSC_DEFINE_CUSTOM_GETTER(Process_getTitle, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    ZigString str;
    Bun__Process__getTitle(globalObject, &str);
    return JSValue::encode(Zig::toJSStringValue(str, globalObject));
}

JSC_DEFINE_CUSTOM_SETTER(Process_setTitle,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    JSC::VM& vm = globalObject->vm();

    JSC::JSObject* thisObject = JSC::jsDynamicCast<JSC::JSObject*>(JSValue::decode(thisValue));
    JSC::JSString* jsString = JSC::jsDynamicCast<JSC::JSString*>(JSValue::decode(value));
    if (!thisObject || !jsString) {
        return false;
    }

    ZigString str = Zig::toZigString(jsString, globalObject);
    Bun__Process__setTitle(globalObject, &str);

    return true;
}

JSC_DEFINE_CUSTOM_GETTER(Process_getArgv, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSC::VM& vm = globalObject->vm();

    Zig::Process* thisObject = JSC::jsDynamicCast<Zig::Process*>(JSValue::decode(thisValue));
    if (!thisObject) {
        return JSValue::encode(JSC::jsUndefined());
    }

    JSC::EncodedJSValue argv_ = Bun__Process__getArgv(globalObject);
    auto clientData = WebCore::clientData(vm);

    thisObject->putDirect(vm, clientData->builtinNames().argvPublicName(),
        JSC::JSValue::decode(argv_), 0);

    return argv_;
}

JSC_DEFINE_CUSTOM_SETTER(Process_setArgv,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    JSC::VM& vm = globalObject->vm();

    JSC::JSObject* thisObject = JSC::jsDynamicCast<JSC::JSObject*>(JSValue::decode(thisValue));
    if (!thisObject) {
        return false;
    }

    auto clientData = WebCore::clientData(vm);

    return thisObject->putDirect(vm, clientData->builtinNames().argvPublicName(),
        JSC::JSValue::decode(value));
}

JSC_DEFINE_CUSTOM_GETTER(Process_getPID, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    return JSC::JSValue::encode(JSC::JSValue(getpid()));
}

JSC_DEFINE_CUSTOM_GETTER(Process_getPPID, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    return JSC::JSValue::encode(JSC::JSValue(getppid()));
}

#if !defined(BUN_WEBKIT_VERSION)
#define BUN_WEBKIT_VERSION "unknown"
#endif

JSC_DEFINE_CUSTOM_GETTER(Process_getVersionsLazy,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    JSC::VM& vm = globalObject->vm();
    auto clientData = WebCore::clientData(vm);

    Zig::Process* thisObject = JSC::jsDynamicCast<Zig::Process*>(JSValue::decode(thisValue));
    if (!thisObject) {
        return JSValue::encode(JSC::jsUndefined());
    }
    auto scope = DECLARE_THROW_SCOPE(vm);

    GET_PROCESS_VERSIONS_OBJ(vm, globalObject, object);

    thisObject->putDirect(vm, clientData->builtinNames().versionsPublicName(), object, 0);

    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(object);
}
JSC_DEFINE_CUSTOM_SETTER(Process_setVersionsLazy,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    JSC::VM& vm = globalObject->vm();
    auto clientData = WebCore::clientData(vm);

    Zig::Process* thisObject = JSC::jsDynamicCast<Zig::Process*>(JSValue::decode(thisValue));
    if (!thisObject) {
        return JSValue::encode(JSC::jsUndefined());
    }

    thisObject->putDirect(vm, clientData->builtinNames().versionsPublicName(),
        JSC::JSValue::decode(value), 0);

    return true;
}

static JSC_DEFINE_HOST_FUNCTION(Process_functionCwd,
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

} // namespace Zig
