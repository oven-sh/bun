#include "root.h"

#include "JavaScriptCore/ObjectConstructor.h"
#include <JavaScriptCore/JSGlobalObject.h>

#include <JavaScriptCore/JSString.h>
#include "ZigGlobalObject.h"

#include <JavaScriptCore/JSBigInt.h>
#include <JavaScriptCore/JSBigIntInlines.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/VMInspector.h>
#if OS(WINDOWS)
#include <JavaScriptCore/ExecutableAllocator.h>
#endif

extern "C" bool JSC__JSValue__isLiveCell(JSC::EncodedJSValue);

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
        RETURN_IF_EXCEPTION(scope, {});
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
        RETURN_IF_EXCEPTION(scope, {});
        if (string.is8Bit()) {
            return JSValue::encode(jsBoolean(true));
        }

        return JSValue::encode(jsBoolean(false));
    }

    throwTypeError(globalObject, scope, "Expected a string"_s);
    return {};
}

#if OS(WINDOWS)
JSC_DEFINE_HOST_FUNCTION(jsFunctionStartOfFixedExecutableMemoryPool,
    (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    RELEASE_AND_RETURN(scope, JSValue::encode(JSBigInt::createFrom(globalObject, static_cast<uint64_t>(JSC::startOfFixedExecutableMemoryPool<uintptr_t>()))));
}
#endif

// Test-only stand-in for JsRef::Weak; the address is only meaningful until that cell is swept.
JSC_DEFINE_HOST_FUNCTION(jsFunctionRawCellAddress, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = callframe->argument(0);
    if (!value.isCell())
        return JSValue::encode(jsUndefined());
    RELEASE_AND_RETURN(scope, JSValue::encode(JSBigInt::createFrom(globalObject, static_cast<uint64_t>(JSValue::encode(value)))));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsLiveCellAtRawAddress, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    uint64_t bits = JSBigInt::toBigUInt64(callframe->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(JSC__JSValue__isLiveCell(static_cast<JSC::EncodedJSValue>(bits))));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionCollectSyncWithoutSweep, (JSGlobalObject * globalObject, CallFrame*))
{
    JSC::getVM(globalObject).heap.collectSync(JSC::CollectionScope::Full);
    return JSValue::encode(jsUndefined());
}

// { words, chapters } of the expression info of the code block that calls this.
JSC_DEFINE_HOST_FUNCTION(jsFunctionExpressionInfoStats, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    CodeBlock* codeBlock = VMInspector::codeBlockForFrame(&vm, callframe, 1);
    if (!codeBlock)
        return JSValue::encode(jsUndefined());
    ExpressionInfo& info = codeBlock->unlinkedCodeBlock()->expressionInfo();
    JSObject* result = JSC::constructEmptyObject(globalObject);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "words"_s), jsNumber(info.numberOfEncodedInfo()));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "chapters"_s), jsNumber(info.numberOfChapters()));
    return JSValue::encode(result);
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
        vm, globalObject, JSC::Identifier::fromString(vm, "rawCellAddress"_s), 1,
        jsFunctionRawCellAddress, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "collectSyncWithoutSweep"_s), 0,
        jsFunctionCollectSyncWithoutSweep, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "isLiveCellAtRawAddress"_s), 1,
        jsFunctionIsLiveCellAtRawAddress, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "expressionInfoStats"_s), 0,
        jsFunctionExpressionInfoStats, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

#if OS(WINDOWS)
    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "startOfFixedExecutableMemoryPool"_s), 0,
        jsFunctionStartOfFixedExecutableMemoryPool, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
#endif

    return object;
}

} // namespace Bun
