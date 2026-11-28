#pragma once

#include "root.h"
#include <JavaScriptCore/JSCJSValue.h>

JSC_DECLARE_HOST_FUNCTION(jsFunction_startCPUProfiler);
JSC_DECLARE_HOST_FUNCTION(jsFunction_stopCPUProfiler);
JSC_DECLARE_HOST_FUNCTION(jsFunction_startPreciseCoverage);
JSC_DECLARE_HOST_FUNCTION(jsFunction_stopPreciseCoverage);
JSC_DECLARE_HOST_FUNCTION(jsFunction_collectPreciseCoverage);
