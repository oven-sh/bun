#pragma once

#include "root.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/CallData.h>

#if ASSERT_ENABLED
#include <atomic>
#endif

namespace Bun {

// JSC::profiledCall(globalObject, ProfilingReason::API, ...) for the callbacks the event loop invokes
// from native code (timers, request and socket handlers, fs callbacks, ...). Those are a handful of
// functions called over and over, so a plain JS function taking at most MicrotaskCall::maxCallArguments
// arguments goes through VM::hostCallCache(): the first call links its CodeBlock into a cache entry and
// later calls enter it directly through vmEntryToJavaScriptWith{N}Arguments, skipping getCallData,
// prepareForExecution and the ProtoCallFrame / argument copy of Interpreter::executeCallImpl. Anything
// else (bound functions, proxies, InternalFunctions, host functions, more arguments than that, a callee
// declaring more parameters than it is passed) takes the regular JSC::call path. Either way the call
// runs under a VMEntryScope for the callee's realm, exactly like executeCallImpl.
//
// `callData` is getCallData(functionObject); callers handle CallData::Type::None themselves.
JSC::JSValue hostCall(JSC::JSGlobalObject*, JSC::JSValue functionObject, const JSC::CallData&, JSC::JSValue thisValue, const JSC::ArgList&);

#if ASSERT_ENABLED
// Process-wide counters (all VMs). Exposed to tests through bun:internal-for-testing and printed at exit
// when BUN_DEBUG_HOST_CALL_CACHE=1 is set.
struct HostCallCacheStats {
    // Calls that found their function in the cache.
    std::atomic<uint64_t> hits { 0 };
    // Calls that did not and linked their function into an entry.
    std::atomic<uint64_t> misses { 0 };
    // The misses that evicted an entry still holding a live function. The cache is thrashing when this
    // tracks misses.
    std::atomic<uint64_t> replacements { 0 };
    // Calls that ended up in JSC::call: not a plain JS function, too many arguments, or the callee
    // declares more parameters than it was passed (those last ones are also counted as hits or misses).
    std::atomic<uint64_t> fallbacks { 0 };
};
const HostCallCacheStats& hostCallCacheStats();
#endif

} // namespace Bun
