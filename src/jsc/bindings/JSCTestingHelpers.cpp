#include "root.h"

#include "JavaScriptCore/ObjectConstructor.h"
#include <JavaScriptCore/JSGlobalObject.h>

#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSString.h>
#include "ZigGlobalObject.h"

#include <wtf/Scope.h>
#include <wtf/Threading.h>
#include <wtf/text/AtomString.h>
#include <wtf/text/MakeString.h>

namespace Bun {
using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsUTF16String,
    (JSGlobalObject * globalObject,
        CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue value = callframe->argument(0);
    if (value.isString()) {
        WTF::String string = value.toWTFString(globalObject);
        if (string.is8Bit()) {
            return JSValue::encode(jsBoolean(false));
        }

        return JSValue::encode(jsBoolean(true));
    }

    throwTypeError(globalObject, scope, "Expected a string"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsLatin1String,
    (JSGlobalObject * globalObject,
        CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue value = callframe->argument(0);
    if (value.isString()) {
        WTF::String string = value.toWTFString(globalObject);
        if (string.is8Bit()) {
            return JSValue::encode(jsBoolean(true));
        }

        return JSValue::encode(jsBoolean(false));
    }

    throwTypeError(globalObject, scope, "Expected a string"_s);
    return {};
}

// Materializes an error's stack string through the same callback and in the
// same execution context as ErrorInstance::finalizeUnconditionally when GC
// collects the frames of an error whose .stack was never accessed: JSC's
// Heap::runEndPhase nulls out the current thread's atom string table around
// finalizeUnconditionalFinalizers(). The sourceURL out-parameter slot is
// seeded with an atom string holding its last reference — modeling
// ErrorInstance::m_sourceURL pointing at code that was already collected —
// so that formatStackTrace's overwrite of the slot drops the last reference
// to an atom inside the finalizer context.
// https://github.com/oven-sh/bun/issues/17087
JSC_DEFINE_HOST_FUNCTION(jsFunctionMaterializeErrorInfoInGCFinalizerContext,
    (JSGlobalObject * globalObject,
        CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* errorInstance = dynamicDowncast<JSC::ErrorInstance>(callframe->argument(0));
    if (!errorInstance) {
        throwTypeError(globalObject, scope, "Expected an Error instance"_s);
        return {};
    }
    auto* stackTrace = errorInstance->stackTrace();
    if (!stackTrace) {
        throwTypeError(globalObject, scope, "Error has no unmaterialized stack trace (was .stack already accessed?)"_s);
        return {};
    }
    auto& onComputeErrorInfo = vm.onComputeErrorInfo();
    if (!onComputeErrorInfo) {
        throwTypeError(globalObject, scope, "VM has no onComputeErrorInfo callback"_s);
        return {};
    }

    // Created while the VM's atom table is current (we hold the API lock), so
    // the atom is registered in the VM's table. The local String keeps the
    // only reference once the temporary AtomString goes away.
    static unsigned atomCounter = 0;
    WTF::String sourceURL = WTF::AtomString(WTF::makeString("bun-testing://gc-finalizer-last-ref-atom-"_s, atomCounter++)).string();

    unsigned line = 0;
    unsigned column = 0;
    WTF::String stackString;
    {
        auto* previousAtomStringTable = WTF::Thread::currentSingleton().setCurrentAtomStringTable(nullptr);
        auto restore = WTF::makeScopeExit([&] {
            WTF::Thread::currentSingleton().setCurrentAtomStringTable(previousAtomStringTable);
        });
        stackString = onComputeErrorInfo(vm, *stackTrace, line, column, sourceURL, errorInstance->bunErrorData());
    }

    return JSValue::encode(JSC::jsString(vm, stackString));
}

JSC::JSValue createJSCTestingHelpers(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* object = JSC::constructEmptyObject(globalObject);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "isUTF16String"_s), 1,
        jsFunctionIsUTF16String, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "isLatin1String"_s), 1,
        jsFunctionIsLatin1String, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "materializeErrorInfoInGCFinalizerContext"_s), 1,
        jsFunctionMaterializeErrorInfoInGCFinalizerContext, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    return object;
}

} // namespace Bun
