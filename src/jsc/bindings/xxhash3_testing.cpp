// Testing-only JS binding for the SIMD xxHash3 kernel.
//
// Kept in its own TU (not xxhash3.cpp) so the Highway kernel stays free of
// JSC/WebKit headers — otherwise `ZigGlobalObject.h` drags the whole JSC type
// universe into a SIMD-only unit, ballooning its debug info and compile cost.
// This wrapper just forwards to the C entry point.

#include "root.h"

#include "xxhash3.h"
#include "xxhash3_testing.h"

#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSBigInt.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSCast.h>

namespace Bun {

// Hash a typed array with the dispatched kernel and return the result as a
// BigInt. Exposed through `bun:internal-for-testing` so a test can drive the
// Highway path directly (not just via Bun.hash.xxHash3).
//   (view: ArrayBufferView, seed?: number | bigint) -> bigint
BUN_DEFINE_HOST_FUNCTION(Bun__xxhash3_64_forTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* view = dynamicDowncast<JSC::JSArrayBufferView>(callFrame->argument(0));
    if (!view) {
        throwTypeError(globalObject, scope, "expected an ArrayBufferView"_s);
        return {};
    }
    if (view->isDetached()) {
        throwTypeError(globalObject, scope, "ArrayBufferView is detached"_s);
        return {};
    }

    uint64_t seed = 0;
    if (callFrame->argumentCount() > 1) {
        JSC::JSValue seedValue = callFrame->argument(1);
        if (seedValue.isNumber()) {
            // toBigUInt64 performs ToBigInt, which throws on a Number. ToUint32
            // is a defined conversion (no float-cast UB for NaN/Inf/negatives)
            // and matches the u32 truncation Bun.hash.xxHash3 applies anyway.
            seed = seedValue.toUInt32(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        } else if (seedValue.isBigInt()) {
            seed = seedValue.toBigUInt64(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        } else if (!seedValue.isUndefined()) {
            // Per the (seed?: number | bigint) contract: undefined means "no
            // seed" (0); anything else is a mistaken call, so surface it.
            throwTypeError(globalObject, scope, "seed must be a number or bigint"_s);
            return {};
        }
    }

    const uint8_t* data = reinterpret_cast<const uint8_t*>(view->vector());
    size_t len = view->byteLength();
    uint64_t result = highway_xxhash3_64(data, len, seed);
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::JSBigInt::createFrom(globalObject, result)));
}

} // namespace Bun
