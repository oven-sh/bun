
#include "root.h"

#include "BunClientData.h"

#include "JavaScriptCore/JSFunction.h"
#include "JavaScriptCore/JSMicrotask.h"
#include "JavaScriptCore/ObjectConstructor.h"

#pragma mark - Node.js Os

namespace Zig {

static JSC::JSObject* createOs(JSC::JSGlobalObject* globalThis, bool isWindows);

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

static JSC_DECLARE_HOST_FUNCTION(Os_functionArch);
static JSC_DEFINE_HOST_FUNCTION(Os_functionArch,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    DEFINE_CALLBACK_FUNCTION_BODY(Bun__Os__arch);
}

static JSC::JSObject* createOs(JSGlobalObject* globalThis, bool isWindows)
{
    JSC::VM& vm = globalThis->vm();
    JSC::Structure* plainObjectStructure = JSC::JSFinalObject::createStructure(vm, globalThis, globalThis->objectPrototype(), 0);
    JSC::JSObject* os = JSC::JSFinalObject::create(vm, plainObjectStructure);

    os->putDirect(vm, JSC::Identifier::fromString(vm, "arch"_s),
        JSC::JSFunction::create(vm, JSC::jsCast<JSC::JSGlobalObject*>(globalThis), 0,
            "arch"_s, Os_functionArch, ImplementationVisibility::Public),
        0);

    if (isWindows) {
        os->putDirect(vm, JSC::Identifier::fromString(vm, "devNull"_s),
           JSC::jsString(vm, makeAtomString("\\\\.\nul"_s)));
    } else {
        os->putDirect(vm, JSC::Identifier::fromString(vm, "devNull"_s),
           JSC::jsString(vm, makeAtomString("/dev/null"_s)));
    }

    #if defined(__x86_64__)
        os->putDirect(vm, JSC::Identifier::fromString(vm, "__arch"_s),
            JSC::jsString(vm, makeAtomString("x64")));
    #elif defined(__i386__)
        os->putDirect(vm, JSC::Identifier::fromString(vm, "__arch"_s),
            JSC::jsString(vm, makeAtomString("x86")));
    #elif defined(__arm__)
        os->putDirect(vm, JSC::Identifier::fromString(vm, "__arch"_s),
            JSC::jsString(vm, makeAtomString("arm")));
    #elif defined(__aarch64__)
        os->putDirect(vm, JSC::Identifier::fromString(vm, "__arch"_s),
            JSC::jsString(vm, makeAtomString("arm64")));
    #endif

    return os;
}

} // namespace Zig

extern JSC__JSValue Bun__Os__create(JSC::JSGlobalObject* globalObject, bool isWindows)
{
    JSC::VM& vm = globalObject->vm();

    return JSC::JSValue::encode(JSC::JSValue(Zig::createOs(
        globalObject, isWindows)));
}