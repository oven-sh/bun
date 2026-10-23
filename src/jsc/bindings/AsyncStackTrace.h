// Async stack recovery for errors created from native code with no JavaScript frames on
// the stack: walk the pending promise's reaction chain to the async functions awaiting it
// and use their frames as the error's stack. See AsyncStackTrace.cpp.
#pragma once

#include "root.h"

#include "JSFFIFunction.h"
#include <JavaScriptCore/JSPromise.h>

// Attaches an async stack (from `promise`'s await chain) to `errorValue` when it is an
// ErrorInstance with no stack of its own; no-op otherwise. Never throws.
extern "C" void Bun__attachAsyncStackFromPromise(JSC::JSGlobalObject*, JSC::EncodedJSValue errorValue, JSC::JSPromise*);

// The context of the one `JSC__JSValue___then(promise, context, onFulfilled, onRejected)` registration that waits for
// the async function running now: on that function's promise, or on the promise of the async function that awaits it,
// and so on up the await chain. Empty when the VM was not entered to resume an async function, and when a promise on
// the way is settled or does not have exactly one reaction: then no single registration waits for the running code.
// Allocates nothing and never throws.
extern "C" JSC::EncodedJSValue Bun__thenContextAwaitingRunningAsyncFunction(JSC::JSGlobalObject*, Zig::FFIFunction onFulfilled, Zig::FFIFunction onRejected);

namespace Bun {

// C++ convenience wrapper over Bun__attachAsyncStackFromPromise.
inline void attachAsyncStackFromPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue error, JSC::JSPromise* promise)
{
    Bun__attachAsyncStackFromPromise(globalObject, JSC::JSValue::encode(error), promise);
}

} // namespace Bun
