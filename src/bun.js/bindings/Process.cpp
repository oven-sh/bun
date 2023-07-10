#include "Process.h"
#include "JavaScriptCore/JSMicrotask.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/NumberPrototype.h"
#include "node_api.h"
#include <dlfcn.h>
#include "ZigGlobalObject.h"
#include "headers.h"
#include "JSEnvironmentVariableMap.h"
#include "ImportMetaObject.h"
#include <sys/stat.h>
#include "ZigConsoleClient.h"
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/JSSet.h>
#include "mimalloc.h"
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>

#pragma mark - Node.js Process

#if !defined(_MSC_VER)
#include <unistd.h> // setuid, getuid
#endif

namespace Zig {

using namespace JSC;

#define REPORTED_NODE_VERSION "18.15.0"
#define processObjectBindingCodeGenerator processObjectInternalsBindingCodeGenerator
#define processObjectMainModuleCodeGenerator moduleMainCodeGenerator

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
extern "C" const char* Bun__githubURL;

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
    if (arg0.isNumber()) {
        if (!arg0.isInt32()) {
            throwRangeError(globalObject, throwScope, "The \"code\" argument must be an integer"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        int extiCode32 = arg0.toInt32(globalObject);
        RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::JSValue {}));

        if (extiCode32 < 0 || extiCode32 > 127) {
            throwRangeError(globalObject, throwScope, "The \"code\" argument must be an integer between 0 and 127"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }

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
    __builtin_unreachable();
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
    Zig__ConsoleClient__messageWithTypeAndLevel(reinterpret_cast<Zig::ConsoleClient*>(globalObject->consoleClient().get())->m_client, static_cast<uint32_t>(MessageType::Log),
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
    if (!exitCode.isNumber()) {
        throwTypeError(lexicalGlobalObject, throwScope, "exitCode must be a number"_s);
        return false;
    }

    if (!exitCode.isInt32()) {
        throwRangeError(lexicalGlobalObject, throwScope, "The \"code\" argument must be an integer"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    int exitCodeInt = exitCode.toInt32(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(throwScope, false);
    if (exitCodeInt < 0 || exitCodeInt > 127) {
        throwRangeError(lexicalGlobalObject, throwScope, "exitCode must be between 0 and 127"_s);
        return false;
    }

    void* ptr = jsCast<Zig::GlobalObject*>(process->globalObject())->bunVM();
    Bun__setExitCode(ptr, static_cast<uint8_t>(exitCodeInt));
    return true;
}

static JSValue constructVersions(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    JSC::JSObject* object = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 19);

    object->putDirect(vm, JSC::Identifier::fromString(vm, "node"_s),
        JSC::JSValue(JSC::jsOwnedString(vm, makeAtomString(REPORTED_NODE_VERSION))));
    object->putDirect(
        vm, JSC::Identifier::fromString(vm, "bun"_s),
        JSC::JSValue(JSC::jsOwnedString(vm, makeAtomString(Bun__version + 1 /* prefix with v */))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "webkit"_s),
        JSC::JSValue(JSC::jsOwnedString(vm, makeAtomString(BUN_WEBKIT_VERSION))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "boringssl"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(Bun__versions_boringssl))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "libarchive"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(Bun__versions_libarchive))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "mimalloc"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(Bun__versions_mimalloc))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "picohttpparser"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(Bun__versions_picohttpparser))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "uwebsockets"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(Bun__versions_uws))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "webkit"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(Bun__versions_webkit))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "zig"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(Bun__versions_zig))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "zlib"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(Bun__versions_zlib))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "tinycc"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(Bun__versions_tinycc))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "lolhtml"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(Bun__versions_lolhtml))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "ares"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(Bun__versions_c_ares))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "usockets"_s),
        JSC::JSValue(JSC::jsString(vm, makeString(Bun__versions_usockets))), 0);

    object->putDirect(vm, JSC::Identifier::fromString(vm, "v8"_s), JSValue(JSC::jsString(vm, makeString("10.8.168.20-node.8"_s))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "uv"_s), JSValue(JSC::jsString(vm, makeString("1.44.2"_s))), 0);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "napi"_s), JSValue(JSC::jsString(vm, makeString("8"_s))), 0);

    object->putDirect(vm, JSC::Identifier::fromString(vm, "modules"_s),
        JSC::JSValue(JSC::jsString(vm, makeAtomString("108"))));

    return object;
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

static JSValue constructProcessReleaseObject(VM& vm, JSObject* processObject)
{
    auto* globalObject = processObject->globalObject();
    auto* release = JSC::constructEmptyObject(globalObject);
    release->putDirect(vm, Identifier::fromString(vm, "name"_s), jsString(vm, WTF::String("bun"_s)), 0);
    release->putDirect(vm, Identifier::fromString(vm, "lts"_s), jsBoolean(false), 0);
    release->putDirect(vm, Identifier::fromString(vm, "sourceUrl"_s), jsString(vm, WTF::String(Bun__githubURL, strlen(Bun__githubURL))), 0);
    release->putDirect(vm, Identifier::fromString(vm, "headersUrl"_s), jsEmptyString(vm), 0);
    release->putDirect(vm, Identifier::fromString(vm, "libUrl"_s), jsEmptyString(vm), 0);

    return release;
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

static JSValue constructStdioWriteStream(JSC::JSGlobalObject* globalObject, int fd)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSFunction* getStdioWriteStream = JSC::JSFunction::create(vm, processObjectInternalsGetStdioWriteStreamCodeGenerator(vm), globalObject);
    JSC::MarkedArgumentBuffer args;
    args.append(JSC::jsNumber(fd));

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

static JSValue constructStdin(VM& vm, JSObject* processObject)
{
    auto* globalObject = Bun__getDefaultGlobal();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    JSC::JSFunction* getStdioWriteStream = JSC::JSFunction::create(vm, processObjectInternalsGetStdinStreamCodeGenerator(vm), globalObject);
    JSC::MarkedArgumentBuffer args;
    args.append(JSC::jsNumber(STDIN_FILENO));

    auto clientData = WebCore::clientData(vm);
    JSC::CallData callData = JSC::getCallData(getStdioWriteStream);

    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::call(globalObject, getStdioWriteStream, callData, globalObject, args, returnedException);
    RETURN_IF_EXCEPTION(scope, {});

    if (UNLIKELY(returnedException)) {
        throwException(globalObject, scope, returnedException.get());
        return {};
    }

    RELEASE_AND_RETURN(scope, result);
}

static JSValue constructPid(VM& vm, JSObject* processObject)
{
    return jsNumber(getpid());
}

static JSValue constructPpid(VM& vm, JSObject* processObject)
{
    return jsNumber(getppid());
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

static JSValue constructArch(VM& vm, JSObject* processObject)
{
#if defined(__x86_64__)
    return JSC::jsString(vm, makeAtomString("x64"));
#elif defined(__i386__)
    return JSC::jsString(vm, makeAtomString("x86"));
#elif defined(__arm__)
    return JSC::jsString(vm, makeAtomString("arm"));
#elif defined(__aarch64__)
    return JSC::jsString(vm, makeAtomString("arm64"));
#else
#error "Unknown architecture"
#endif
}

static JSValue constructPlatform(VM& vm, JSObject* processObject)
{
#if defined(__APPLE__)
    return JSC::jsString(vm, makeAtomString("darwin"));
#elif defined(__linux__)
    return JSC::jsString(vm, makeAtomString("linux"));
#else
#error "Unknown platform"
#endif
}

static JSValue constructBrowser(VM& vm, JSObject* processObject)
{
    return jsBoolean(false);
}

static JSValue constructVersion(VM& vm, JSObject* processObject)
{
    return JSC::jsString(vm, makeString("v", REPORTED_NODE_VERSION));
}

static JSValue constructIsBun(VM& vm, JSObject* processObject)
{
    return jsBoolean(true);
}

static JSValue constructRevision(VM& vm, JSObject* processObject)
{
    return JSC::jsString(vm, makeAtomString(Bun__version_sha));
}

static JSValue constructEnv(VM& vm, JSObject* processObject)
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(processObject->globalObject());
    return globalObject->processEnvObject();
}

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
        SystemError error;
        error.errno_ = errno;
        error.syscall = Bun::toString("getgroups"_s);
        throwException(globalObject, throwScope, JSValue::decode(SystemError__toErrorInstance(&error, globalObject)));
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

JSC_DEFINE_HOST_FUNCTION(Process_functionReallyExit, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    uint8_t exitCode = 0;
    JSValue arg0 = callFrame->argument(0);
    if (arg0.isNumber()) {
        if (!arg0.isInt32()) {
            throwRangeError(globalObject, throwScope, "The \"code\" argument must be an integer"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        int extiCode32 = arg0.toInt32(globalObject);
        RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::JSValue {}));

        if (extiCode32 < 0 || extiCode32 > 127) {
            throwRangeError(globalObject, throwScope, "The \"code\" argument must be an integer between 0 and 127"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
        }

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
    Bun__Process__exit(zigGlobal, exitCode);
    __builtin_unreachable();
}

template<typename Visitor>
void Process::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    Process* thisObject = jsCast<Process*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    thisObject->cpuUsageStructure.visit(visitor);
    thisObject->memoryUsageStructure.visit(visitor);
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

JSC_DEFINE_HOST_FUNCTION(Process_functionCpuUsage,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    struct rusage rusage;
    if (getrusage(RUSAGE_SELF, &rusage) != 0) {
        SystemError error;
        error.errno_ = errno;
        error.syscall = Bun::toString("getrusage"_s);
        error.message = Bun::toString("Failed to get CPU usage"_s);
        throwException(globalObject, throwScope, JSValue::decode(SystemError__toErrorInstance(&error, globalObject)));
        return JSValue::encode(jsUndefined());
    }

    auto* process = getProcessObject(globalObject, callFrame->thisValue());

    Structure* cpuUsageStructure = process->cpuUsageStructure.getInitializedOnMainThread(process);
    JSC::JSObject* result = JSC::constructEmptyObject(vm, cpuUsageStructure);
    RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));

    constexpr double MICROS_PER_SEC = 1000000.0;

    double user = MICROS_PER_SEC * rusage.ru_utime.tv_sec + rusage.ru_utime.tv_usec;
    double system = MICROS_PER_SEC * rusage.ru_stime.tv_sec + rusage.ru_stime.tv_usec;

    if (callFrame->argumentCount() > 0) {
        JSValue comparatorValue = callFrame->argument(0);
        if (!comparatorValue.isObject()) {
            throwTypeError(globalObject, throwScope, "Expected an object as the first argument"_s);
            return JSC::JSValue::encode(JSC::jsUndefined());
        }

        JSC::JSObject* comparator = comparatorValue.getObject();
        JSValue userValue;
        JSValue systemValue;

        if (comparator->structureID() == cpuUsageStructure->structureID()) {
            userValue = comparator->getDirect(0);
            systemValue = comparator->getDirect(1);
        } else {
            userValue = comparator->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "user"_s));
            RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));

            systemValue = comparator->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "system"_s));
            RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));
        }

        if (!userValue || !userValue.isNumber()) {
            throwTypeError(globalObject, throwScope, "Expected a number for the user property"_s);
            return JSC::JSValue::encode(JSC::jsUndefined());
        }

        if (!systemValue || !systemValue.isNumber()) {
            throwTypeError(globalObject, throwScope, "Expected a number for the user property"_s);
            return JSC::JSValue::encode(JSC::jsUndefined());
        }

        double userComparator = userValue.asNumber();
        double systemComparator = systemValue.asNumber();

        user -= userComparator;
        system -= systemComparator;
    }

    result->putDirectOffset(vm, 0, JSC::jsNumber(user));
    result->putDirectOffset(vm, 1, JSC::jsNumber(system));

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(result));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionMemoryUsage,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    size_t elapsed_msecs = 0;
    size_t user_msecs = 0;
    size_t system_msecs = 0;
    size_t current_rss = 0;
    size_t peak_rss = 0;
    size_t current_commit = 0;
    size_t peak_commit = 0;
    size_t page_faults = 0;

    mi_process_info(&elapsed_msecs, &user_msecs, &system_msecs,
        &current_rss, &peak_rss,
        &current_commit, &peak_commit, &page_faults);

    auto* process = getProcessObject(globalObject, callFrame->thisValue());
    JSC::JSObject* result = JSC::constructEmptyObject(vm, process->memoryUsageStructure.getInitializedOnMainThread(process));
    if (UNLIKELY(throwScope.exception())) {
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    // {
    //  rss: 4935680,
    //  heapTotal: 1826816,
    //  heapUsed: 650472,
    //  external: 49879,
    //  arrayBuffers: 9386
    // }

    result->putDirectOffset(vm, 0, JSC::jsNumber(current_rss));
    result->putDirectOffset(vm, 1, JSC::jsNumber(peak_commit));
    result->putDirectOffset(vm, 2, JSC::jsNumber(vm.heap.size()));
    result->putDirectOffset(vm, 3, JSC::jsNumber(vm.heap.extraMemorySize() + vm.heap.externalMemorySize()));
    result->putDirectOffset(vm, 4, JSC::jsNumber(vm.heap.objectTypeCounts()->count("ArrayBuffer")));

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(result));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionMemoryUsageRSS,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();

    size_t elapsed_msecs = 0;
    size_t user_msecs = 0;
    size_t system_msecs = 0;
    size_t current_rss = 0;
    size_t peak_rss = 0;
    size_t current_commit = 0;
    size_t peak_commit = 0;
    size_t page_faults = 0;

    mi_process_info(&elapsed_msecs, &user_msecs, &system_msecs,
        &current_rss, &peak_rss,
        &current_commit, &peak_commit, &page_faults);

    return JSValue::encode(jsNumber(current_rss));
}

JSC_DEFINE_HOST_FUNCTION(Process_functionOpenStdin, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    Zig::GlobalObject* global = jsDynamicCast<Zig::GlobalObject*>(globalObject);
    if (UNLIKELY(!global)) {
        global = Bun__getDefaultGlobal();
    }
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (JSValue stdin = global->processObject()->getIfPropertyExists(globalObject, Identifier::fromString(vm, "stdin"_s))) {
        RETURN_IF_EXCEPTION(throwScope, JSValue::encode(jsUndefined()));

        if (!stdin.isObject()) {
            throwTypeError(globalObject, throwScope, "stdin is not an object"_s);
            return JSValue::encode(jsUndefined());
        }

        JSValue resumeValue = stdin.getObject()->getIfPropertyExists(globalObject, Identifier::fromString(vm, "resume"_s));
        RETURN_IF_EXCEPTION(throwScope, JSValue::encode(jsUndefined()));
        if (!resumeValue.isUndefinedOrNull()) {
            auto resumeFunction = jsDynamicCast<JSFunction*>(resumeValue);
            if (UNLIKELY(!resumeFunction)) {
                throwTypeError(globalObject, throwScope, "stdin.resume is not a function"_s);
                return JSValue::encode(jsUndefined());
            }

            auto callData = getCallData(resumeFunction);

            MarkedArgumentBuffer args;
            JSC::call(globalObject, resumeFunction, callData, stdin, args);
            RETURN_IF_EXCEPTION(throwScope, JSValue::encode(jsUndefined()));
        }

        RELEASE_AND_RETURN(throwScope, JSValue::encode(stdin));
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

static JSValue Process_stubEmptyObject(VM& vm, JSObject* processObject)
{
    return JSC::constructEmptyObject(processObject->globalObject());
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

    memoryUsage->putDirect(vm, JSC::Identifier::fromString(vm, "rss"_s), rss, JSC::PropertyAttribute::Function | 0);
    return memoryUsage;
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

    if (!value.isInt32()) {
        throwRangeError(globalObject, scope, "debugPort must be 0 or in range 1024 to 65535"_s);
        return false;
    }

    int port = value.asInt32();

    if (port != 0) {
        if (port < 1024 || port > 65535) {
            throwRangeError(globalObject, scope, "debugPort must be 0 or in range 1024 to 65535"_s);
            return false;
        }
    }

    _debugPort = port;
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(processTitle, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    ZigString str;
    Bun__Process__getTitle(globalObject, &str);
    return JSValue::encode(Zig::toJSStringValue(str, globalObject));
}

JSC_DEFINE_CUSTOM_SETTER(setProcessTitle,
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

/* Source for Process.lut.h
@begin processObjectTable
  abort                            Process_functionAbort                    Function 1
  allowedNodeEnvironmentFlags      Process_stubEmptySet                     PropertyCallback
  arch                             constructArch                            PropertyCallback
  argv                             constructArgv                            PropertyCallback
  argv0                            constructArgv0                           PropertyCallback
  assert                           Process_functionAssert                   Function 1
  binding                          JSBuiltin                                Function 1
  browser                          constructBrowser                         PropertyCallback
  chdir                            Process_functionChdir                    Function 1
  config                           constructProcessConfigObject             PropertyCallback
  cpuUsage                         Process_functionCpuUsage                 Function 1
  cwd                              Process_functionCwd                      Function 1
  debugPort                        processDebugPort                         CustomAccessor
  dlopen                           Process_functionDlopen                   Function 1
  emitWarning                      Process_emitWarning                      Function 1
  env                              constructEnv                             PropertyCallback
  execArgv                         constructExecArgv                        PropertyCallback
  execPath                         constructExecPath                        PropertyCallback
  exit                             Process_functionExit                     Function 1
  exitCode                         processExitCode                          CustomAccessor
  features                         constructFeatures                        PropertyCallback
  getActiveResourcesInfo           Process_stubFunctionReturningArray       Function 0
  getegid                          Process_functiongetegid                  Function 0
  geteuid                          Process_functiongeteuid                  Function 0
  getgid                           Process_functiongetgid                   Function 0
  getgroups                        Process_functiongetgroups                Function 0
  getuid                           Process_functiongetuid                   Function 0
  hrtime                           constructProcessHrtimeObject             PropertyCallback
  isBun                            constructIsBun                           PropertyCallback
  mainModule                       JSBuiltin                                ReadOnly|Builtin|Accessor|Function 0
  memoryUsage                      constructMemoryUsage                     PropertyCallback
  moduleLoadList                   Process_stubEmptyArray                   PropertyCallback
  nextTick                         Process_functionNextTick                 Function 1
  openStdin                        Process_functionOpenStdin                Function 0
  pid                              constructPid                             PropertyCallback
  platform                         constructPlatform                        PropertyCallback
  ppid                             constructPpid                            PropertyCallback
  reallyExit                       Process_functionReallyExit               Function 1
  release                          constructProcessReleaseObject            PropertyCallback
  revision                         constructRevision                        PropertyCallback
  setSourceMapsEnabled             Process_stubEmptyFunction                Function 1
  stderr                           constructStderr                          PropertyCallback
  stdin                            constructStdin                           PropertyCallback
  stdout                           constructStdout                          PropertyCallback
  title                            processTitle                             CustomAccessor
  umask                            Process_functionUmask                    Function 1
  uptime                           Process_functionUptime                   Function 1
  version                          constructVersion                         PropertyCallback
  versions                         constructVersions                        PropertyCallback
  _debugEnd                        Process_stubEmptyFunction                Function 0
  _debugProcess                    Process_stubEmptyFunction                Function 0
  _fatalException                  Process_stubEmptyFunction                Function 1
  _getActiveRequests               Process_stubFunctionReturningArray       Function 0
  _getActiveHandles                Process_stubFunctionReturningArray       Function 0
  _linkedBinding                   Process_stubEmptyFunction                Function 0
  _preload_modules                 Process_stubEmptyObject                  PropertyCallback
  _rawDebug                        Process_stubEmptyFunction                Function 0
  _startProfilerIdleNotifier       Process_stubEmptyFunction                Function 0
  _stopProfilerIdleNotifier        Process_stubEmptyFunction                Function 0
  _tickCallback                    Process_stubEmptyFunction                Function 0
@end
*/

#include "Process.lut.h"
const JSC::ClassInfo Process::s_info = { "Process"_s, &Base::s_info, &processObjectTable, nullptr,
    CREATE_METHOD_TABLE(Process) };

void Process::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);

    this->cpuUsageStructure.initLater([](const JSC::LazyProperty<JSC::JSObject, JSC::Structure>::Initializer& init) {
        init.set(constructCPUUsageStructure(init.vm, init.owner->globalObject()));
    });

    this->memoryUsageStructure.initLater([](const JSC::LazyProperty<JSC::JSObject, JSC::Structure>::Initializer& init) {
        init.set(constructMemoryUsageStructure(init.vm, init.owner->globalObject()));
    });

    this->putDirect(vm, vm.propertyNames->toStringTagSymbol, jsString(vm, String("process"_s)), 0);
}

} // namespace Zig
