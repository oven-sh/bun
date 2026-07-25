#include "root.h"
#include "headers-handwritten.h"
#include "WebCoreJSBuiltins.h"
#include "ZigGlobalObject.h"

// Bridges for bun:test's `test.extend()` fixtures. The implementation lives in
// src/js/builtins/BunTestFixtures.ts; the Rust test runner
// (src/runtime/test_runner/ScopeFunctions.rs) calls these to merge fixture
// registries and to wrap test callbacks with fixture setup/teardown.

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue Bun__TestFixtures__merge(Zig::GlobalObject* global, JSC::EncodedJSValue parentFixtures, JSC::EncodedJSValue newFixtures)
{
    auto& vm = JSC::getVM(global);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSFunction* mergeFunction = global->m_bunTestMergeFixturesFunction.getInitializedOnMainThread(global);
    JSC::CallData callData = JSC::getCallData(mergeFunction);

    JSC::MarkedArgumentBuffer args;
    args.append(JSC::JSValue::decode(parentFixtures));
    args.append(JSC::JSValue::decode(newFixtures));

    auto result = JSC::call(global, mergeFunction, callData, JSC::jsUndefined(), args);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(result);
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue Bun__TestFixtures__wrapCallback(Zig::GlobalObject* global, JSC::EncodedJSValue fixtures, JSC::EncodedJSValue testCallback)
{
    auto& vm = JSC::getVM(global);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSFunction* wrapFunction = global->m_bunTestWrapFixtureCallbackFunction.getInitializedOnMainThread(global);
    JSC::CallData callData = JSC::getCallData(wrapFunction);

    JSC::MarkedArgumentBuffer args;
    args.append(JSC::JSValue::decode(fixtures));
    args.append(JSC::JSValue::decode(testCallback));

    auto result = JSC::call(global, wrapFunction, callData, JSC::jsUndefined(), args);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(result);
}
