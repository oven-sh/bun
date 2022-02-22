#include "Path.h"
#include <JavaScriptCore/JSMicrotask.h>
#include <JavaScriptCore/ObjectConstructor.h>

#pragma mark - Node.js Path

extern JSC__JSValue Bun__Path__create(JSC::JSGlobalObject* globalObject, bool isWindows)
{
    JSC::VM& vm = globalObject->vm();

    return JSC::JSValue::encode(JSC::JSValue(Zig::Path::create(
        vm, isWindows, Zig::Path::createStructure(vm, globalObject, globalObject->objectPrototype()))));
}

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

// clang-format off
#define DEFINE_CALLBACK_FUNCTION_BODY(ZigFunction) JSC::VM& vm = globalObject->vm(); \
    auto* thisObject = JSC::jsDynamicCast<Path*>(vm, callFrame->thisValue()); \
    auto scope = DECLARE_THROW_SCOPE(vm); \
    if (!thisObject) \
        return throwVMTypeError(globalObject, scope); \
    auto argCount = static_cast<uint16_t>(callFrame->argumentCount()); \
    WTF::Vector<JSC::EncodedJSValue, 16> arguments; \
    arguments.reserveInitialCapacity(argCount); \
     if (argCount) { \
        for (uint16_t i = 0; i < argCount; ++i) { \
            arguments.uncheckedAppend(JSC::JSValue::encode(callFrame->uncheckedArgument(i))); \
        } \
     } \
    JSC::JSValue result = JSC::JSValue::decode( \
        ZigFunction(globalObject, thisObject->isWindows, arguments.data(), argCount) \
    ); \
    JSC::JSObject *obj = result.getObject(); \
    if (UNLIKELY(obj != nullptr && obj->isErrorInstance())) { \
        scope.throwException(globalObject, obj); \
        return JSC::JSValue::encode(JSC::jsUndefined()); \
    } \
    if (UNLIKELY(scope.exception())) \
        return JSC::JSValue::encode(JSC::jsUndefined()); \
    return JSC::JSValue::encode(result);

// clang-format on

static JSC_DECLARE_HOST_FUNCTION(Path_functionBasename);
static JSC_DEFINE_HOST_FUNCTION(Path_functionBasename,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__basename);
}

static JSC_DECLARE_HOST_FUNCTION(Path_functionDirname);
static JSC_DEFINE_HOST_FUNCTION(Path_functionDirname,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__dirname);
}
static JSC_DECLARE_HOST_FUNCTION(Path_functionExtname);
static JSC_DEFINE_HOST_FUNCTION(Path_functionExtname,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__extname);
}
static JSC_DECLARE_HOST_FUNCTION(Path_functionFormat);
static JSC_DEFINE_HOST_FUNCTION(Path_functionFormat,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__format);
}
static JSC_DECLARE_HOST_FUNCTION(Path_functionIsAbsolute);
static JSC_DEFINE_HOST_FUNCTION(Path_functionIsAbsolute,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__isAbsolute);
}
static JSC_DECLARE_HOST_FUNCTION(Path_functionJoin);
static JSC_DEFINE_HOST_FUNCTION(Path_functionJoin,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__join);
}
static JSC_DECLARE_HOST_FUNCTION(Path_functionNormalize);
static JSC_DEFINE_HOST_FUNCTION(Path_functionNormalize,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__normalize);
}
static JSC_DECLARE_HOST_FUNCTION(Path_functionParse);
static JSC_DEFINE_HOST_FUNCTION(Path_functionParse,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__parse);
}
static JSC_DECLARE_HOST_FUNCTION(Path_functionRelative);
static JSC_DEFINE_HOST_FUNCTION(Path_functionRelative,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__relative);
}
static JSC_DECLARE_HOST_FUNCTION(Path_functionResolve);
static JSC_DEFINE_HOST_FUNCTION(Path_functionResolve,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__resolve);
}
static JSC_DECLARE_HOST_FUNCTION(Path_functionToNamespacedPath);
static JSC_DEFINE_HOST_FUNCTION(Path_functionToNamespacedPath,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto argCount = static_cast<uint16_t>(callFrame->argumentCount());
    // TODO:
    return JSC::JSValue::encode(callFrame->argument(0));
}

void Path::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    auto clientData = Bun::clientData(vm);

    JSC::JSGlobalObject* globalThis = globalObject();
    this->putDirect(vm, clientData->builtinNames().basenamePublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            WTF::String("basename"), Path_functionBasename),
        0);
    this->putDirect(vm, clientData->builtinNames().dirnamePublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            WTF::String("dirname"), Path_functionDirname),
        0);
    this->putDirect(vm, clientData->builtinNames().extnamePublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            WTF::String("extname"), Path_functionExtname),
        0);
    this->putDirect(vm, clientData->builtinNames().formatPublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            WTF::String("format"), Path_functionFormat),
        0);
    this->putDirect(vm, clientData->builtinNames().isAbsolutePublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            WTF::String("isAbsolute"), Path_functionIsAbsolute),
        0);
    this->putDirect(vm, clientData->builtinNames().joinPublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            WTF::String("join"), Path_functionJoin),
        0);
    this->putDirect(vm, clientData->builtinNames().normalizePublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            WTF::String("normalize"), Path_functionNormalize),
        0);
    this->putDirect(vm, clientData->builtinNames().parsePublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            WTF::String("parse"), Path_functionParse),
        0);
    this->putDirect(vm, clientData->builtinNames().relativePublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            WTF::String("relative"), Path_functionRelative),
        0);
    this->putDirect(vm, clientData->builtinNames().resolvePublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            WTF::String("resolve"), Path_functionResolve),
        0);

    this->putDirect(vm, clientData->builtinNames().toNamespacedPathPublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            WTF::String("toNamespacedPath"),
            Path_functionToNamespacedPath),
        0);

    if (isWindows) {
        this->putDirect(vm, clientData->builtinNames().sepPublicName(),
            JSC::jsString(vm, WTF::String("\\"_s)), 0);
        this->putDirect(vm, clientData->builtinNames().delimiterPublicName(),
            JSC::jsString(vm, WTF::String(";"_s)), 0);
    } else {
        this->putDirect(vm, clientData->builtinNames().sepPublicName(),
            JSC::jsString(vm, WTF::String("/"_s)), 0);
        this->putDirect(vm, clientData->builtinNames().delimiterPublicName(),
            JSC::jsString(vm, WTF::String(":"_s)), 0);
    }
}

const JSC::ClassInfo Path::s_info = { "Path", &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(Path) };
} // namespace Zig