#pragma once

#include "root.h"

namespace Bun {

// The exotic objects of the windows of `bun:desktop`.
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopRemoteWindow);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopWindowProperties);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopFacade);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopMakeEnumerable);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopUndetectable);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopWindowOf);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopCallingWindow);

} // namespace Bun
