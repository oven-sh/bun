#include "config.h"

#include "ZigGlobalObject.h"
#include "BunProcess.h"
#include "mimalloc.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {

using namespace JSC;

// Returns the raw values needed by node:v8 getHeapStatistics() without doing any
// full heap walks, mimalloc collection, or JSON serialization. `jsc.heapStats()`
// walks every live cell in the heap (twice) and serializes mimalloc stats to JSON
// on every call, which made v8.getHeapStatistics() O(n) in heap size and unsuitable
// for the common pattern of calling it periodically to monitor memory.
//
// Returns: [heapSize, heapCapacity, extraMemorySize, globalObjectCount, currentRSS, peakRSS]
JSC_DEFINE_HOST_FUNCTION(jsGetHeapStatisticsArray, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    VM& vm = globalObject->vm();
    auto& heap = vm.heap;

    size_t elapsed_msecs = 0, user_msecs = 0, system_msecs = 0;
    size_t current_rss = 0, peak_rss = 0;
    size_t current_commit = 0, peak_commit = 0, page_faults = 0;
    mi_process_info(&elapsed_msecs, &user_msecs, &system_msecs, &current_rss,
        &peak_rss, &current_commit, &peak_commit, &page_faults);
    // mi_process_info produces incorrect rss size on linux.
    Bun::getRSS(&current_rss);

    // Active JSGlobalObjects are always GC-protected (see ZigGlobalObject.cpp), so
    // protectedGlobalObjectCount() — which only iterates the handful of protected
    // cells — gives the same answer as globalObjectCount() without walking the
    // entire heap.
    const size_t globalObjectCount = heap.protectedGlobalObjectCount();

    auto* result = JSC::constructEmptyArray(globalObject, nullptr, 6);
    if (!result) [[unlikely]]
        return {};
    result->putDirectIndex(globalObject, 0, jsNumber(heap.size()));
    result->putDirectIndex(globalObject, 1, jsNumber(heap.capacity()));
    result->putDirectIndex(globalObject, 2, jsNumber(heap.extraMemorySize()));
    result->putDirectIndex(globalObject, 3, jsNumber(globalObjectCount));
    result->putDirectIndex(globalObject, 4, jsNumber(current_rss));
    result->putDirectIndex(globalObject, 5, jsNumber(peak_rss));
    return JSValue::encode(result);
}

} // namespace Bun
