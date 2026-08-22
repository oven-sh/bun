#pragma once

#include "root.h"

namespace Bun {

// node:v8 GCProfiler start/stop (JSC HeapObserver-backed).
JSC_DECLARE_HOST_FUNCTION(jsFunction_startGCProfile);
JSC_DECLARE_HOST_FUNCTION(jsFunction_stopGCProfile);

// node:v8 sampling heap profile (--heap-prof / v8.writeHeapSnapshot helper).
JSC_DECLARE_HOST_FUNCTION(jsFunction_takeSamplingHeapProfile);

} // namespace Bun
