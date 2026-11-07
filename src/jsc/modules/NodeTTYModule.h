#pragma once

#include "JSBuffer.h"
#include "_NativeModule.h"

namespace Zig {
using namespace WebCore;

bool isTTY(int fd);

JSC_DECLARE_HOST_FUNCTION(jsFunctionTty_isatty);

} // namespace Zig
