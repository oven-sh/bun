#include "root.h"
#include "HostCall.h"

#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/MicrotaskCallInlines.h>
#include <JavaScriptCore/ScriptProfilingScope.h>
#include <JavaScriptCore/VMEntryScopeInlines.h>
#include <JavaScriptCore/VMInlines.h>

#if ASSERT_ENABLED
#include <cstdlib>
#include <cstring>
#include <wtf/DataLog.h>
extern "C" void Bun__atexit(void (*)(void));
#endif

namespace Bun {
using namespace JSC;

#if ASSERT_ENABLED

static HostCallCacheStats hostCallCacheStatsStorage;

const HostCallCacheStats& hostCallCacheStats()
{
    return hostCallCacheStatsStorage;
}

static void printHostCallCacheStats()
{
    const auto& stats = hostCallCacheStatsStorage;
    dataLogLn("[host_call_cache] hits=", stats.hits.load(std::memory_order_relaxed), " misses=", stats.misses.load(std::memory_order_relaxed), " replacements=", stats.replacements.load(std::memory_order_relaxed), " fallbacks=", stats.fallbacks.load(std::memory_order_relaxed));
}

// BUN_DEBUG_HOST_CALL_CACHE=1 prints the counters when the process exits.
static ALWAYS_INLINE void installHostCallCacheStatsPrinter()
{
    [[maybe_unused]] static const bool installed = [] {
        const char* value = getenv("BUN_DEBUG_HOST_CALL_CACHE");
        if (value && *value && strcmp(value, "0"))
            Bun__atexit(printHostCallCacheStats);
        return true;
    }();
}

static ALWAYS_INLINE void countHit()
{
    installHostCallCacheStatsPrinter();
    hostCallCacheStatsStorage.hits.fetch_add(1, std::memory_order_relaxed);
}

static ALWAYS_INLINE void countMiss(MicrotaskCall& entryBeingReplaced)
{
    installHostCallCacheStatsPrinter();
    hostCallCacheStatsStorage.misses.fetch_add(1, std::memory_order_relaxed);
    if (entryBeingReplaced.functionExecutable())
        hostCallCacheStatsStorage.replacements.fetch_add(1, std::memory_order_relaxed);
}

static ALWAYS_INLINE void countFallback()
{
    installHostCallCacheStatsPrinter();
    hostCallCacheStatsStorage.fallbacks.fetch_add(1, std::memory_order_relaxed);
}

#else

static ALWAYS_INLINE void countHit() {}
static ALWAYS_INLINE void countMiss(MicrotaskCall&) {}
static ALWAYS_INLINE void countFallback() {}

#endif

static ALWAYS_INLINE JSValue tryCachedHostCall(VM& vm, MicrotaskCall& entry, JSFunction* function, JSValue thisValue, const ArgList& args)
{
    // The context cell is the async stack trace origin recorded in the VMEntryRecord; a call from native
    // code has none, which is also what JSC::call passes.
    static_assert(MicrotaskCall::maxCallArguments == 6, "the switch below covers exactly the arities the thunks exist for");
    switch (args.size()) {
    case 0:
        return entry.tryCallWithArguments(vm, function, thisValue, nullptr);
    case 1:
        return entry.tryCallWithArguments(vm, function, thisValue, nullptr, args.at(0));
    case 2:
        return entry.tryCallWithArguments(vm, function, thisValue, nullptr, args.at(0), args.at(1));
    case 3:
        return entry.tryCallWithArguments(vm, function, thisValue, nullptr, args.at(0), args.at(1), args.at(2));
    case 4:
        return entry.tryCallWithArguments(vm, function, thisValue, nullptr, args.at(0), args.at(1), args.at(2), args.at(3));
    case 5:
        return entry.tryCallWithArguments(vm, function, thisValue, nullptr, args.at(0), args.at(1), args.at(2), args.at(3), args.at(4));
    case 6:
        return entry.tryCallWithArguments(vm, function, thisValue, nullptr, args.at(0), args.at(1), args.at(2), args.at(3), args.at(4), args.at(5));
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

JSValue hostCall(JSGlobalObject* globalObject, JSValue functionObject, const CallData& callData, JSValue thisValue, const ArgList& args)
{
    auto& vm = JSC::getVM(globalObject);
    ASSERT(callData.type != CallData::Type::None);

    // CallData::Type::JS means a JSFunction with a FunctionExecutable, which is the only thing a
    // MicrotaskCall can link. The last two conditions are the ones executeCallImpl turns into a stack
    // overflow error / checkVMEntryPermission(); letting it do that keeps those paths identical.
    if (callData.type != CallData::Type::JS || args.size() > MicrotaskCall::maxCallArguments || vm.disallowVMEntryCount || !vm.isSafeToRecurseSoft()) [[unlikely]] {
        countFallback();
        return JSC::profiledCall(globalObject, ProfilingReason::API, functionObject, callData, thisValue, args);
    }

    // Same order as profiledCall(): the profiling scope is opened before the VMEntryScope, so an outer
    // entry scope (if any) is what gets reported.
    ScriptProfilingScope profilingScope(vm.deprecatedVMEntryGlobalObject(globalObject), ProfilingReason::API);
    auto scope = DECLARE_THROW_SCOPE(vm);
    scope.assertNoException();

    auto* function = uncheckedDowncast<JSFunction>(functionObject.asCell());
    // tryCallWithArguments expects the caller to have entered the VM; executeCallImpl enters the
    // callee's realm, not the global object the caller happens to hold.
    VMEntryScope entryScope(vm, callData.js.scope->realm());

    auto& cache = vm.hostCallCache();
    auto* entry = cache.find(functionObject);
    if (entry) [[likely]] {
        countHit();
    } else {
        entry = cache.nextEntryToReplace();
        countMiss(*entry);
        entry->initialize(vm, function);
        RETURN_IF_EXCEPTION_WITH_TRAPS_DEFERRED(scope, {});
    }

    JSValue result = tryCachedHostCall(vm, *entry, function, thisValue, args);
    if (result) [[likely]]
        RELEASE_AND_RETURN(scope, result);

    // An empty result is either an exception (thrown by the callee, or while relinking a CodeBlock that
    // was jettisoned since the last call) or an entry that cannot take this call because the callee
    // declares more parameters than it is being passed (the linked entry point skips the arity check).
    // Only the latter may fall through to the generic call.
    RETURN_IF_EXCEPTION_WITH_TRAPS_DEFERRED(scope, {});
    countFallback();
    RELEASE_AND_RETURN(scope, JSC::call(globalObject, functionObject, callData, thisValue, args));
}

} // namespace Bun
