#include "config.h"

#include "ZigGlobalObject.h"
#include "BunProcess.h"
#include "mimalloc.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {

using namespace JSC;

// node:v8 getHeapStatistics() backing. Reads the counters directly instead of
// going through jsc.heapStats(), which does a full forEachLiveCell per call.
// Returns: [heapSize, heapCapacity, extraMemorySize, globalObjectCount, currentRSS, peakRSS]
JSC_DEFINE_HOST_FUNCTION(jsGetHeapStatisticsArray, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& heap = vm.heap;

    size_t elapsed_msecs = 0, user_msecs = 0, system_msecs = 0;
    size_t current_rss = 0, peak_rss = 0;
    size_t current_commit = 0, peak_commit = 0, page_faults = 0;
    mi_process_info(&elapsed_msecs, &user_msecs, &system_msecs, &current_rss,
        &peak_rss, &current_commit, &peak_commit, &page_faults);
    // mi_process_info produces incorrect rss size on linux.
    Bun::getRSS(&current_rss);

    // globalObjectCount() walks every live cell; protected-only is equivalent
    // because ZigGlobalObject::create gcProtect()s each global.
    const size_t globalObjectCount = heap.protectedGlobalObjectCount();

    auto* result = JSC::constructEmptyArray(globalObject, nullptr, 6);
    RETURN_IF_EXCEPTION(throwScope, {});
    result->putDirectIndex(globalObject, 0, jsNumber(heap.size()));
    result->putDirectIndex(globalObject, 1, jsNumber(heap.capacity()));
    result->putDirectIndex(globalObject, 2, jsNumber(heap.extraMemorySize()));
    result->putDirectIndex(globalObject, 3, jsNumber(globalObjectCount));
    result->putDirectIndex(globalObject, 4, jsNumber(current_rss));
    result->putDirectIndex(globalObject, 5, jsNumber(peak_rss));
    return JSValue::encode(result);
}

} // namespace Bun
