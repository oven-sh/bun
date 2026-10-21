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
// ErrorInstance whose stack is undecided (see errorStackIsUndecided); no-op otherwise. Never throws.
extern "C" void Bun__attachAsyncStackFromPromise(JSC::JSGlobalObject*, JSC::EncodedJSValue errorValue, JSC::JSPromise*);

// The same for an error that the calling native code just built. No script has seen the error,
// so this entry does not look for a `stack` property or a structure that is not extensible.
extern "C" void Bun__attachAsyncStackToFreshError(JSC::JSGlobalObject*, JSC::EncodedJSValue errorValue, JSC::JSPromise*);

namespace Bun {

// True while frames from another place can still become the stack of `error`: it has formatted no
// stack, has no frames of its own, is extensible, and owns no `stack` property of any kind (a value,
// an accessor, or the lazy accessor of Error.captureStackTrace). A read of `stack` decides nothing.
// Runs no JavaScript and does not throw.
bool errorStackIsUndecided(JSC::VM&, JSC::ErrorInstance*);

// C++ convenience wrapper over Bun__attachAsyncStackFromPromise.
inline void attachAsyncStackFromPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue error, JSC::JSPromise* promise)
{
    Bun__attachAsyncStackFromPromise(globalObject, JSC::JSValue::encode(error), promise);
}

} // namespace Bun
