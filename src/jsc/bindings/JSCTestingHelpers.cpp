#include "root.h"

#include "JavaScriptCore/ObjectConstructor.h"
#include <JavaScriptCore/JSGlobalObject.h>

#include <JavaScriptCore/JSString.h>
#include "ZigGlobalObject.h"

#if ASSERT_ENABLED
#include "StrongRef.h"
#include <JavaScriptCore/Strong.h>
#include <JavaScriptCore/StrongInlines.h>
#include <wtf/Threading.h>
#endif

#if OS(WINDOWS)
#include <JavaScriptCore/ExecutableAllocator.h>
#include <JavaScriptCore/JSBigInt.h>
#endif

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

#if OS(WINDOWS)
JSC_DEFINE_HOST_FUNCTION(jsFunctionStartOfFixedExecutableMemoryPool,
    (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    RELEASE_AND_RETURN(scope, JSValue::encode(JSBigInt::makeHeapBigIntOrBigInt32(globalObject, static_cast<uint64_t>(JSC::startOfFixedExecutableMemoryPool<uintptr_t>()))));
}
#endif

#if ASSERT_ENABLED
// Test hook: mutates a strong handle owned by this VM from a spawned thread
// without the API lock. The debug assertions in JSC::HandleSet and
// Bun__StrongRef__* must abort before the mutation lands;
// strong-handle-thread-guard.test.ts asserts on that crash.
JSC_DEFINE_HOST_FUNCTION(jsFunctionCrossThreadStrongHandleMutation,
    (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    WTF::String kind = callframe->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (kind == "strong"_s) {
        // The #30185 shape: a by-value Strong capture destroyed off-thread.
        JSC::Strong<JSC::JSObject> strong(vm, JSC::constructEmptyObject(globalObject));
        Ref<Thread> thread = Thread::create("StrongHandleGuardTest"_s, [strong]() mutable {
            strong.clear();
        });
        thread->waitForCompletion();
        return JSValue::encode(jsUndefined());
    }

    if (kind == "strongRef"_s) {
        auto* ref = Bun__StrongRef__new(globalObject, JSValue::encode(JSC::constructEmptyObject(globalObject)));
        Ref<Thread> thread = Thread::create("StrongHandleGuardTest"_s, [ref]() {
            Bun__StrongRef__delete(ref);
        });
        thread->waitForCompletion();
        return JSValue::encode(jsUndefined());
    }

    throwTypeError(globalObject, scope, "Expected \"strong\" or \"strongRef\""_s);
    return {};
}
#endif

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

#if OS(WINDOWS)
    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "startOfFixedExecutableMemoryPool"_s), 0,
        jsFunctionStartOfFixedExecutableMemoryPool, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
#endif

#if ASSERT_ENABLED
    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "crossThreadStrongHandleMutation"_s), 1,
        jsFunctionCrossThreadStrongHandleMutation, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
#endif

    return object;
}

} // namespace Bun
