#pragma once

#include "JSBuffer.h"
#include "_NativeModule.h"

#if OS(WINDOWS)
#include <uv.h>
#endif

namespace Zig {
using namespace WebCore;

JSC_DECLARE_HOST_FUNCTION(jsFunctionTty_isatty);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNotImplementedYet);

} // namespace Zig
