
#include "root.h"

#include "BunClientData.h"

#include "JavaScriptCore/JSFunction.h"
#include "JavaScriptCore/JSMicrotask.h"
#include "JavaScriptCore/ObjectConstructor.h"

#pragma mark - Node.js Path

namespace Zig {

static JSC::JSObject* createPath(JSC::JSGlobalObject* globalThis, bool isWindows);

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

using namespace JSC;

// clang-format off
#define DEFINE_CALLBACK_FUNCTION_BODY(ZigFunction) JSC::VM& vm = globalObject->vm(); \
    auto* thisObject = JSC::jsDynamicCast<JSC::JSFinalObject*>( callFrame->thisValue()); \
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
    auto clientData = WebCore::clientData(vm); \
    auto isWindows = thisObject->get(globalObject, clientData->builtinNames().isWindowsPrivateName()); \
    JSC::JSValue result = JSC::JSValue::decode( \
        ZigFunction(globalObject, isWindows.asBoolean(), reinterpret_cast<JSC__JSValue*>(arguments.data()), argCount) \
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

static JSC::JSObject* createPath(JSGlobalObject* globalThis, bool isWindows)
{
    JSC::VM& vm = globalThis->vm();
    JSC::Structure* plainObjectStructure = JSC::JSFinalObject::createStructure(vm, globalThis, globalThis->objectPrototype(), 0);
    JSC::JSObject* path = JSC::JSFinalObject::create(vm, plainObjectStructure);
    auto clientData = WebCore::clientData(vm);

    path->putDirect(vm, clientData->builtinNames().isWindowsPrivateName(),
        JSC::jsBoolean(isWindows), 0);

    path->putDirect(vm, clientData->builtinNames().basenamePublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            "basename"_s, Path_functionBasename, ImplementationVisibility::Public),
        0);
    path->putDirect(vm, clientData->builtinNames().dirnamePublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            "dirname"_s, Path_functionDirname, ImplementationVisibility::Public),
        0);
    path->putDirect(vm, clientData->builtinNames().extnamePublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            "extname"_s, Path_functionExtname, ImplementationVisibility::Public),
        0);
    path->putDirect(vm, clientData->builtinNames().formatPublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            "format"_s, Path_functionFormat, ImplementationVisibility::Public),
        0);
    path->putDirect(vm, clientData->builtinNames().isAbsolutePublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            "isAbsolute"_s, Path_functionIsAbsolute, ImplementationVisibility::Public),
        0);
    path->putDirect(vm, clientData->builtinNames().joinPublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            "join"_s, Path_functionJoin, ImplementationVisibility::Public),
        0);
    path->putDirect(vm, clientData->builtinNames().normalizePublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            "normalize"_s, Path_functionNormalize, ImplementationVisibility::Public),
        0);
    path->putDirect(vm, clientData->builtinNames().parsePublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            "parse"_s, Path_functionParse, ImplementationVisibility::Public),
        0);
    path->putDirect(vm, clientData->builtinNames().relativePublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            "relative"_s, Path_functionRelative, ImplementationVisibility::Public),
        0);
    path->putDirect(vm, clientData->builtinNames().resolvePublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            "resolve"_s, Path_functionResolve, ImplementationVisibility::Public),
        0);

    path->putDirect(vm, clientData->builtinNames().toNamespacedPathPublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            "toNamespacedPath"_s,
            Path_functionToNamespacedPath, ImplementationVisibility::Public),
        0);

    if (isWindows) {
        path->putDirect(vm, clientData->builtinNames().sepPublicName(),
            JSC::jsString(vm, WTF::String("\\"_s)), 0);
        path->putDirect(vm, clientData->builtinNames().delimiterPublicName(),
            JSC::jsString(vm, WTF::String(";"_s)), 0);
    } else {
        path->putDirect(vm, clientData->builtinNames().sepPublicName(),
            JSC::jsString(vm, WTF::String("/"_s)), 0);
        path->putDirect(vm, clientData->builtinNames().delimiterPublicName(),
            JSC::jsString(vm, WTF::String(":"_s)), 0);
    }

    return path;
}

} // namespace Zig

extern JSC__JSValue Bun__Path__create(JSC::JSGlobalObject* globalObject, bool isWindows)
{
    JSC::VM& vm = globalObject->vm();

    return JSC::JSValue::encode(JSC::JSValue(Zig::createPath(
        globalObject, isWindows)));
}