#pragma once

#include "root.h"
#include <JavaScriptCore/JSGlobalObject.h>

namespace Bun {

// Backs node:v8's v8.startHeapProfile()/handle.stop().
JSC_DECLARE_HOST_FUNCTION(jsFunction_takeSamplingHeapProfile);

} // namespace Bun
