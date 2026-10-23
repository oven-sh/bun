// Async stack recovery for errors created from native code with no JavaScript frames on
// the stack: walk the pending promise's reaction chain to the async functions awaiting it
// and use their frames as the error's stack. See AsyncStackTrace.cpp.
#pragma once

#include "root.h"

#include <JavaScriptCore/JSPromise.h>

// Attaches an async stack (from `promise`'s await chain) to `errorValue` when it is an
// ErrorInstance with no stack of its own; no-op otherwise. Never throws.
extern "C" void Bun__attachAsyncStackFromPromise(JSC::JSGlobalObject*, JSC::EncodedJSValue errorValue, JSC::JSPromise*);

// Gives `errorValue` the stack that `sourceValue` (another ErrorInstance) captured, when its own has no
// JavaScript frame: an error that native code throws from a promise reaction, on behalf of an earlier
// call. No-op otherwise. Never throws.
extern "C" void Bun__takeStackIfNativeOnly(JSC::JSGlobalObject*, JSC::EncodedJSValue errorValue, JSC::EncodedJSValue sourceValue);

namespace Bun {

// C++ convenience wrapper over Bun__attachAsyncStackFromPromise.
inline void attachAsyncStackFromPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue error, JSC::JSPromise* promise)
{
    Bun__attachAsyncStackFromPromise(globalObject, JSC::JSValue::encode(error), promise);
}

} // namespace Bun
