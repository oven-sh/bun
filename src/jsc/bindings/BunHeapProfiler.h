#pragma once

#include "root.h"
#include <JavaScriptCore/JSGlobalObject.h>

namespace Bun {

// v8.GCProfiler recorder (JSC::HeapObserver-backed); see BunHeapProfiler.cpp.
JSC_DECLARE_HOST_FUNCTION(jsFunction_startGCProfile);
JSC_DECLARE_HOST_FUNCTION(jsFunction_stopGCProfile);
// Backs node:v8's v8.startHeapProfile()/handle.stop().
JSC_DECLARE_HOST_FUNCTION(jsFunction_takeSamplingHeapProfile);

} // namespace Bun
