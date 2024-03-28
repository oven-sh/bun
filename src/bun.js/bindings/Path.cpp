#include "Path.h"
#include "root.h"
#include "headers.h"
#include "BunClientData.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSMicrotask.h>
#include <JavaScriptCore/ObjectConstructor.h>

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
    auto* thisObject = JSC::jsDynamicCast<JSC::JSFinalObject*>(callFrame->thisValue()); \
    if (!thisObject) { \
        auto scope = DECLARE_THROW_SCOPE(vm); \
        return throwVMTypeError(globalObject, scope); \
    } \
    auto argCount = static_cast<uint16_t>(callFrame->argumentCount()); \
    WTF::Vector<JSC::EncodedJSValue, 16> arguments; \
    arguments.reserveInitialCapacity(argCount); \
    if (argCount) { \
        for (uint16_t i = 0; i < argCount; ++i) { \
            arguments.unsafeAppendWithoutCapacityCheck(JSC::JSValue::encode(callFrame->uncheckedArgument(i))); \
        } \
    } \
    auto isWindows = thisObject->get(globalObject, WebCore::clientData(vm)->builtinNames().isWindowsPrivateName()); \
    return ZigFunction(globalObject, isWindows.asBoolean(), reinterpret_cast<JSC__JSValue*>(arguments.data()), argCount);

// clang-format on

JSC_DECLARE_HOST_FUNCTION(Path_functionBasename);
JSC_DEFINE_HOST_FUNCTION(Path_functionBasename,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__basename);
}

JSC_DECLARE_HOST_FUNCTION(Path_functionDirname);
JSC_DEFINE_HOST_FUNCTION(Path_functionDirname,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__dirname);
}

JSC_DEFINE_HOST_FUNCTION(Path_functionExtname,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__extname);
}

JSC_DEFINE_HOST_FUNCTION(Path_functionFormat,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__format);
}

JSC_DEFINE_HOST_FUNCTION(Path_functionIsAbsolute,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__isAbsolute);
}

JSC_DEFINE_HOST_FUNCTION(Path_functionJoin,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__join);
}

JSC_DEFINE_HOST_FUNCTION(Path_functionNormalize,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__normalize);
}

JSC_DEFINE_HOST_FUNCTION(Path_functionParse,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__parse);
}

JSC_DEFINE_HOST_FUNCTION(Path_functionRelative,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__relative);
}

JSC_DEFINE_HOST_FUNCTION(Path_functionResolve,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__resolve);
}

JSC_DEFINE_HOST_FUNCTION(Path_functionToNamespacedPath,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Path__toNamespacedPath);
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
    path->putDirect(vm, vm.propertyNames->resolve,
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            "resolve"_s, Path_functionResolve, ImplementationVisibility::Public),
        0);

    path->putDirect(vm, clientData->builtinNames().toNamespacedPathPublicName(),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            "toNamespacedPath"_s,
            Path_functionToNamespacedPath, ImplementationVisibility::Public),
        0);

    return path;
}

} // namespace Zig

namespace Bun {

JSC::JSValue createNodePathBinding(Zig::GlobalObject* globalObject)
{
    auto binding = constructEmptyArray(globalObject, nullptr, 2);
    binding->putByIndexInline(
        globalObject,
        (unsigned)0,
        Zig::createPath(globalObject, false),
        false);
    binding->putByIndexInline(
        globalObject,
        (unsigned)1,
        Zig::createPath(globalObject, true),
        false);
    return binding;
}

} // namespace Bun
