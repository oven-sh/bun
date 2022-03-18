#include "Process.h"
#include <JavaScriptCore/JSMicrotask.h>
#include <JavaScriptCore/ObjectConstructor.h>

#pragma mark - Node.js Process

namespace Zig {

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

    if (!job.isObject() || !job.getObject()->isCallable(vm)) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSC::throwTypeError(globalObject, scope, "nextTick expects a function"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    switch (argCount) {

    case 1: {
        // This is a JSC builtin function
        globalObject->queueMicrotask(JSC::createJSMicrotask(vm, job, JSC::JSValue {}, JSC::JSValue {},
            JSC::JSValue {}, JSC::JSValue {}));
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
            JSC::createJSMicrotask(vm, job, argument0, argument1, argument2, argument3));
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
        //     auto callData = getCallData(vm, job);

        //     return JSC::JSValue::encode(JSC::call(globalObject, job, callData, job, argsList));
        //   });

        // globalObject->queueMicrotask(JSC::createJSMicrotask(vm, JSC::JSValue(callback)));
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
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
    auto clientData = Bun::clientData(vm);

    putDirectCustomAccessor(vm, clientData->builtinNames().pidPublicName(),
        JSC::CustomGetterSetter::create(vm, Process_getPID, nullptr),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));

    putDirectCustomAccessor(vm, clientData->builtinNames().ppidPublicName(),
        JSC::CustomGetterSetter::create(vm, Process_getPPID, nullptr),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));

    putDirectCustomAccessor(vm, clientData->builtinNames().titlePublicName(),
        JSC::CustomGetterSetter::create(vm, Process_getTitle, Process_setTitle),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));

    putDirectCustomAccessor(vm, clientData->builtinNames().argvPublicName(),
        JSC::CustomGetterSetter::create(vm, Process_getArgv, Process_setArgv),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));

    this->putDirect(vm, clientData->builtinNames().nextTickPublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 0,
            WTF::String("nextTick"), Process_functionNextTick),
        0);

    this->putDirect(vm, clientData->builtinNames().cwdPublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 0,
            WTF::String("cwd"), Process_functionCwd),
        0);

    this->putDirect(vm, clientData->builtinNames().chdirPublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 0,
            WTF::String("chdir"), Process_functionChdir),
        0);

    this->putDirect(vm, JSC::Identifier::fromString(vm, "exit"_s),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalObject()), 0,
            WTF::String("exit"), Process_functionExit),
        0);

    putDirectCustomAccessor(
        vm, clientData->builtinNames().versionsPublicName(),
        JSC::CustomGetterSetter::create(vm, Process_getVersionsLazy, Process_setVersionsLazy), 0);
    // this should be transpiled out, but just incase
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "browser"),
        JSC::JSValue(false));

    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "exitCode"),
        JSC::JSValue(JSC::jsNumber(0)));

    this->putDirect(this->vm(), clientData->builtinNames().versionPublicName(),
        JSC::jsString(this->vm(), WTF::String(Bun__version)));

    // this gives some way of identifying at runtime whether the SSR is happening in node or not.
    // this should probably be renamed to what the name of the bundler is, instead of "notNodeJS"
    // but it must be something that won't evaluate to truthy in Node.js
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "isBun"), JSC::JSValue(true));
#if defined(__APPLE__)
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "platform"),
        JSC::jsString(this->vm(), WTF::String("darwin")));
#else
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "platform"),
        JSC::jsString(this->vm(), WTF::String("linux")));
#endif

#if defined(__x86_64__)
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "arch"),
        JSC::jsString(this->vm(), WTF::String("x64")));
#elif defined(__i386__)
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "arch"),
        JSC::jsString(this->vm(), WTF::String("x86")));
#elif defined(__arm__)
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "arch"),
        JSC::jsString(this->vm(), WTF::String("arm")));
#elif defined(__aarch64__)
    this->putDirect(this->vm(), JSC::Identifier::fromString(this->vm(), "arch"),
        JSC::jsString(this->vm(), WTF::String("arm64")));
#endif
}

const JSC::ClassInfo Process::s_info = { "Process", &Base::s_info, nullptr, nullptr,
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

    JSC::JSObject* thisObject = JSC::jsDynamicCast<JSC::JSObject*>(vm, JSValue::decode(thisValue));
    JSC::JSString* jsString = JSC::jsDynamicCast<JSC::JSString*>(vm, JSValue::decode(value));
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

    Zig::Process* thisObject = JSC::jsDynamicCast<Zig::Process*>(vm, JSValue::decode(thisValue));
    if (!thisObject) {
        return JSValue::encode(JSC::jsUndefined());
    }
    auto clientData = Bun::clientData(vm);

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

    JSC::JSObject* thisObject = JSC::jsDynamicCast<JSC::JSObject*>(vm, JSValue::decode(thisValue));
    if (!thisObject) {
        return false;
    }

    auto clientData = Bun::clientData(vm);

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
    auto clientData = Bun::clientData(vm);

    Zig::Process* thisObject = JSC::jsDynamicCast<Zig::Process*>(vm, JSValue::decode(thisValue));
    if (!thisObject) {
        return JSValue::encode(JSC::jsUndefined());
    }

    if (JSC::JSValue argv = thisObject->getIfPropertyExists(
            globalObject, clientData->builtinNames().versionsPrivateName())) {
        return JSValue::encode(argv);
    }

    JSC::JSObject* object = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 9);

    object->putDirect(vm, JSC::Identifier::fromString(vm, "node"),
        JSC::JSValue(JSC::jsString(vm, WTF::String("16.14.0"))));
    object->putDirect(
        vm, JSC::Identifier::fromString(vm, "bun"),
        JSC::JSValue(JSC::jsString(vm, WTF::String(Bun__version + 1 /* prefix with v */))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "webkit"),
        JSC::JSValue(JSC::jsString(vm, WTF::String(Bun__versions_webkit))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "mimalloc"),
        JSC::JSValue(JSC::jsString(vm, WTF::String(Bun__versions_mimalloc))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "libarchive"),
        JSC::JSValue(JSC::jsString(vm, WTF::String(Bun__versions_libarchive))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "picohttpparser"),
        JSC::JSValue(JSC::jsString(vm, WTF::String(Bun__versions_picohttpparser))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "boringssl"),
        JSC::JSValue(JSC::jsString(vm, WTF::String(Bun__versions_boringssl))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "zlib"),
        JSC::JSValue(JSC::jsString(vm, WTF::String(Bun__versions_zlib))));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "zig"),
        JSC::JSValue(JSC::jsString(vm, WTF::String(Bun__versions_zig))));

    object->putDirect(vm, JSC::Identifier::fromString(vm, "modules"),
        JSC::JSValue(JSC::jsString(vm, WTF::String("67"))));

    thisObject->putDirect(vm, clientData->builtinNames().versionsPrivateName(), object);
    return JSC::JSValue::encode(object);
}
JSC_DEFINE_CUSTOM_SETTER(Process_setVersionsLazy,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{

    JSC::VM& vm = globalObject->vm();
    auto clientData = Bun::clientData(vm);

    Zig::Process* thisObject = JSC::jsDynamicCast<Zig::Process*>(vm, JSValue::decode(thisValue));
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