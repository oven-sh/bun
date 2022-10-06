#include "Process.h"
#include "JavaScriptCore/JSMicrotask.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "node_api.h"
#include <dlfcn.h>
#include "ZigGlobalObject.h"
#include "headers.h"

#pragma mark - Node.js Process

namespace Zig {

using namespace JSC;

#define REPORTED_NODE_VERSION "18.10.1"

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

static JSC_DECLARE_HOST_FUNCTION(Process_functionNextTick);
static JSC_DEFINE_HOST_FUNCTION(Process_functionNextTick,
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

    switch (argCount) {

    case 1: {
        // This is a JSC builtin function
        globalObject->queueMicrotask(job, JSC::JSValue {}, JSC::JSValue {},
            JSC::JSValue {}, JSC::JSValue {});
        break;
    }

    case 2:
    case 3:
    case 4:
    case 5: {
        JSC::JSValue argument0 = callFrame->uncheckedArgument(1);
        JSC::JSValue argument1 = argCount > 2 ? callFrame->uncheckedArgument(2) : JSC::JSValue {};
        JSC::JSValue argument2 = argCount > 3 ? callFrame->uncheckedArgument(3) : JSC::JSValue {};
        JSC::JSValue argument3 = argCount > 4 ? callFrame->uncheckedArgument(4) : JSC::JSValue {};
        globalObject->queueMicrotask(
            job, argument0, argument1, argument2, argument3);
        break;
    }

    default: {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope,
            "nextTick doesn't support more than 4 arguments currently"_s);
        return JSC::JSValue::encode(JSC::JSValue {});

        break;
    }

        // JSC::MarkedArgumentBuffer args;
        // for (unsigned i = 1; i < callFrame->argumentCount(); i++) {
        //   args.append(callFrame->uncheckedArgument(i));
        // }

        // JSC::ArgList argsList(args);
        // JSC::gcProtect(job);
        // JSC::JSFunction *callback = JSC::JSNativeStdFunction::create(
        //   vm, globalObject, 0, String(),
        //   [job, &argsList](JSC::JSGlobalObject *globalObject, JSC::CallFrame *callFrame) {
        //     JSC::VM &vm = globalObject->vm();
        //     auto callData = getCallData(job);

        //     return JSC::JSValue::encode(JSC::call(globalObject, job, callData, job, argsList));
        //   });

        // globalObject->queueMicrotask(JSC::createJSMicrotask(vm, JSC::JSValue(callback)));
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

static JSC_DECLARE_HOST_FUNCTION(Process_functionDlopen);
static JSC_DEFINE_HOST_FUNCTION(Process_functionDlopen,
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

static JSC_DECLARE_HOST_FUNCTION(Process_functionExit);
static JSC_DEFINE_HOST_FUNCTION(Process_functionExit,
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

static JSC_DECLARE_HOST_FUNCTION(Process_functionHRTime);

static JSC_DEFINE_HOST_FUNCTION(Process_functionHRTime,
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

void Process::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    auto clientData = WebCore::clientData(vm);

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
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 1,
            MAKE_STATIC_STRING_IMPL("nextTick"), Process_functionNextTick, ImplementationVisibility::Public),
        PropertyAttribute::Function | 0);

    this->putDirect(vm, JSC::Identifier::fromString(vm, "dlopen"_s),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 1,
            MAKE_STATIC_STRING_IMPL("dlopen"), Process_functionDlopen, ImplementationVisibility::Public),
        PropertyAttribute::Function | 0);

    this->putDirect(vm, clientData->builtinNames().cwdPublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 0,
            MAKE_STATIC_STRING_IMPL("cwd"), Process_functionCwd, ImplementationVisibility::Public),
        PropertyAttribute::Function | 0);

    this->putDirect(vm, clientData->builtinNames().chdirPublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 0,
            MAKE_STATIC_STRING_IMPL("chdir"), Process_functionChdir, ImplementationVisibility::Public),
        PropertyAttribute::Function | 0);

    this->putDirect(vm, JSC::Identifier::fromString(vm, "exit"_s),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 0,
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
        JSC::jsString(this->vm(), makeAtomString(REPORTED_NODE_VERSION)));

    // this gives some way of identifying at runtime whether the SSR is happening in node or not.
    // this should probably be renamed to what the name of the bundler is, instead of "notNodeJS"
    // but it must be something that won't evaluate to truthy in Node.js
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "isBun"_s), JSC::JSValue(true));
#if defined(__APPLE__)
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "platform"_s),
        JSC::jsString(this->vm(), makeAtomString("darwin")));
#else
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "platform"_s),
        JSC::jsString(this->vm(), makeAtomString("linux")));
#endif

#if defined(__x86_64__)
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "arch"_s),
        JSC::jsString(this->vm(), makeAtomString("x64")));
#elif defined(__i386__)
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "arch"_s),
        JSC::jsString(this->vm(), makeAtomString("x86")));
#elif defined(__arm__)
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "arch"_s),
        JSC::jsString(this->vm(), makeAtomString("arm")));
#elif defined(__aarch64__)
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "arch"_s),
        JSC::jsString(this->vm(), makeAtomString("arm64")));
#endif

    JSC::JSFunction* hrtime = JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 0,
        MAKE_STATIC_STRING_IMPL("hrtime"), Process_functionHRTime, ImplementationVisibility::Public);

    JSC::JSFunction* hrtimeBigInt = JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 0,
        MAKE_STATIC_STRING_IMPL("bigint"), Process_functionHRTimeBigInt, ImplementationVisibility::Public);

    hrtime->putDirect(vm, JSC::Identifier::fromString(vm, "bigint"_s), hrtimeBigInt);
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "hrtime"_s), hrtime);
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
    auto clientData = WebCore::clientData(vm);

    if (JSC::JSValue argv = thisObject->getIfPropertyExists(
            globalObject, clientData->builtinNames().argvPrivateName())) {
        return JSValue::encode(argv);
    }

    JSC::EncodedJSValue argv_ = Bun__Process__getArgv(globalObject);
    thisObject->putDirect(vm, clientData->builtinNames().argvPrivateName(),
        JSC::JSValue::decode(argv_));

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

    return thisObject->putDirect(vm, clientData->builtinNames().argvPrivateName(),
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

    if (JSC::JSValue argv = thisObject->getIfPropertyExists(
            globalObject, clientData->builtinNames().versionsPrivateName())) {
        return JSValue::encode(argv);
    }

// BUN_WEBKIT_VERSION is typically injected in the github actions
#ifndef BUN_WEBKIT_VERSION
#define BUN_WEBKIT_VERSION Bun__versions_webkit
#endif

    JSC::JSObject* object = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 9);

    object->putDirect(vm, JSC::Identifier::fromString(vm, "node"_s),
        JSC::JSValue(JSC::jsOwnedString(vm, makeAtomString(REPORTED_NODE_VERSION))));
    object->putDirect(
        vm, JSC::Identifier::fromString(vm, "bun"_s),
        JSC::JSValue(JSC::jsOwnedString(vm, makeAtomString(Bun__version + 1 /* prefix with v */))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "webkit"_s),
        JSC::JSValue(JSC::jsOwnedString(vm, makeAtomString(BUN_WEBKIT_VERSION))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "mimalloc"_s),
        JSC::JSValue(JSC::jsOwnedString(vm, makeAtomString(Bun__versions_mimalloc))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "libarchive"_s),
        JSC::JSValue(JSC::jsOwnedString(vm, makeAtomString(Bun__versions_libarchive))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "picohttpparser"_s),
        JSC::JSValue(JSC::jsOwnedString(vm, makeAtomString(Bun__versions_picohttpparser))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "boringssl"_s),
        JSC::JSValue(JSC::jsOwnedString(vm, makeAtomString(Bun__versions_boringssl))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "zlib"_s),
        JSC::JSValue(JSC::jsOwnedString(vm, makeAtomString(Bun__versions_zlib))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "zig"_s),
        JSC::JSValue(JSC::jsOwnedString(vm, makeAtomString(Bun__versions_zig))));

    object->putDirect(vm, JSC::Identifier::fromString(vm, "modules"_s),
        JSC::JSValue(JSC::jsOwnedString(vm, makeAtomString("67"))));

    thisObject->putDirect(vm, clientData->builtinNames().versionsPrivateName(), object);
    return JSC::JSValue::encode(object);
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

    thisObject->putDirect(vm, clientData->builtinNames().versionsPrivateName(),
        JSC::JSValue::decode(value));

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