#pragma once

#include "root.h"

namespace Bun {

// node:v8 GCProfiler start/stop (v8.GCProfiler).
JSC_DECLARE_HOST_FUNCTION(jsFunction_startGCProfile);
JSC_DECLARE_HOST_FUNCTION(jsFunction_stopGCProfile);

// --heap-prof sampling heap profile in V8's JSON shape.
JSC_DECLARE_HOST_FUNCTION(jsFunction_takeSamplingHeapProfile);

} // namespace Bun
