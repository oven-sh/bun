// Async stack recovery for errors created from native code with no JavaScript frames on
// the stack: walk the pending promise's reaction chain to the async functions awaiting it
// and use their frames as the error's stack. See AsyncStackTrace.cpp.
#pragma once

#include "root.h"

#include <JavaScriptCore/BytecodeIndex.h>
#include <JavaScriptCore/JSPromise.h>

namespace JSC {
class CodeBlock;
}

// Attaches an async stack (from `promise`'s await chain) to `errorValue` when it is an
// ErrorInstance with no stack of its own; no-op otherwise. Never throws.
extern "C" void Bun__attachAsyncStackFromPromise(JSC::JSGlobalObject*, JSC::EncodedJSValue errorValue, JSC::JSPromise*);

namespace Bun {

// Where a suspended generator body (an async function, a module with a top-level await) resumes: its State field holds the value that the body's resume switch dispatches on. Offset 0 when that says nothing.
JSC::BytecodeIndex bytecodeIndexOfSuspension(JSC::CodeBlock*, JSC::JSValue state);

// C++ convenience wrapper over Bun__attachAsyncStackFromPromise.
inline void attachAsyncStackFromPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue error, JSC::JSPromise* promise)
{
    Bun__attachAsyncStackFromPromise(globalObject, JSC::JSValue::encode(error), promise);
}

} // namespace Bun
