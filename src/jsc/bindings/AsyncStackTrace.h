// Async stack recovery for errors created from native code with no JavaScript frames on
// the stack: walk the pending promise's reaction chain to the async functions awaiting it
// and use their frames as the error's stack. See AsyncStackTrace.cpp.
#pragma once

#include "root.h"

#include <JavaScriptCore/JSPromise.h>

// Attaches an async stack (from `promise`'s await chain) to `errorValue` when it is an
// ErrorInstance with no stack of its own; no-op otherwise. Never throws.
extern "C" void Bun__attachAsyncStackFromPromise(JSC::JSGlobalObject*, JSC::EncodedJSValue errorValue, JSC::JSPromise*);

namespace JSC {
class StackFrame;
}

namespace Bun {

// C++ convenience wrapper over Bun__attachAsyncStackFromPromise.
inline void attachAsyncStackFromPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue error, JSC::JSPromise* promise)
{
    Bun__attachAsyncStackFromPromise(globalObject, JSC::JSValue::encode(error), promise);
}

// VM::onAppendStackTrace hook: appends the `at async` frames JSC's own walk drops when
// AsyncLocalStorage wraps await contexts in InternalFieldTuple. See AsyncStackTrace.cpp.
void appendAsyncLocalStorageStackFrames(JSC::VM&, JSC::JSCell* owner, WTF::Vector<JSC::StackFrame>&, size_t maxToAppend);

} // namespace Bun
