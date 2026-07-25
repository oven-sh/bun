#pragma once

#include "root.h"
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/text/WTFString.h>

namespace JSC {
class VM;
}

namespace Bun {

// Generate a Claude-friendly text-based heap profile
// This format is designed specifically for analysis by LLMs with grep/sed/awk tools
// The output is hierarchical but with clear section markers for easy navigation
WTF::String generateHeapProfile(JSC::VM& vm);

// V8 `--heap-prof`-compatible sampling heap profile JSON ({head, samples}),
// synthesized from the time-based SamplingProfiler. See BunHeapProfiler.cpp.
WTF::String generateHeapSamplingProfile(JSC::VM& vm);

// v8.GCProfiler recorder (JSC::HeapObserver-backed); see BunHeapProfiler.cpp.
JSC_DECLARE_HOST_FUNCTION(jsFunction_startGCProfile);
JSC_DECLARE_HOST_FUNCTION(jsFunction_stopGCProfile);
// Backs node:v8's v8.startHeapProfile()/handle.stop().
JSC_DECLARE_HOST_FUNCTION(jsFunction_takeSamplingHeapProfile);

} // namespace Bun
