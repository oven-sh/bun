#pragma once

#include "root.h"
#include <JavaScriptCore/JSGlobalObject.h>

namespace Bun {

// Backs `performance.nodeTiming`'s milestone getters (node:perf_hooks).
JSC_DECLARE_HOST_FUNCTION(jsFunction_getNodeTimingMilestone);

} // namespace Bun
