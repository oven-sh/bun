// Async stack recovery for errors created from native code with no JavaScript frames on
// the stack: walk the pending promise's reaction chain to the async functions awaiting it
// and use their frames as the error's stack. See AsyncStackTrace.cpp.
#pragma once

#include "root.h"

#include <JavaScriptCore/JSPromise.h>

namespace JSC {
class ErrorInstance;
}

// Attaches an async stack (from `promise`'s await chain) to `errorValue` when it is an
// ErrorInstance whose stack is undecided (Bun::errorStackIsUndecided); no-op otherwise. Never throws.
extern "C" void Bun__attachAsyncStackFromPromise(JSC::JSGlobalObject*, JSC::EncodedJSValue errorValue, JSC::JSPromise*);

// For an error that the caller just built, so that no script has seen it: skips the lookup of an own `stack`.
extern "C" void Bun__attachAsyncStackToFreshError(JSC::JSGlobalObject*, JSC::EncodedJSValue errorValue, JSC::JSPromise*);

namespace Bun {

// True while borrowed frames can still become the stack of `error`: it captured a frame list with no frames, formatted nothing, is extensible, and owns no `stack` but the unread lazy one of Error.captureStackTrace(). Runs no JavaScript.
bool errorStackIsUndecided(JSC::VM&, JSC::ErrorInstance*);

// C++ convenience wrapper over Bun__attachAsyncStackFromPromise.
inline void attachAsyncStackFromPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue error, JSC::JSPromise* promise)
{
    Bun__attachAsyncStackFromPromise(globalObject, JSC::JSValue::encode(error), promise);
}

} // namespace Bun
