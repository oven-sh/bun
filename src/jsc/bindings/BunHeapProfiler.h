#pragma once

#include "root.h"
#include <JavaScriptCore/JSGlobalObject.h>

namespace Bun {

// node:v8 GCProfiler (v8.GCProfiler#start()/stop()).
JSC_DECLARE_HOST_FUNCTION(jsFunction_startGCProfile);
JSC_DECLARE_HOST_FUNCTION(jsFunction_stopGCProfile);

// node:v8 startHeapProfile() handle.stop() — V8 SamplingHeapProfile JSON.
JSC_DECLARE_HOST_FUNCTION(jsFunction_takeSamplingHeapProfile);

} // namespace Bun
