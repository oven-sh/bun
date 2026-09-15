#pragma once

#include "root.h"

namespace Bun {

// CustomValue rows, not PropertyCallback: JSC resolves globals while it links bytecode, where JS cannot run.
JSC_DECLARE_CUSTOM_GETTER(jsWebGPUGlobal);
JSC_DECLARE_CUSTOM_SETTER(setJSWebGPUGlobal);

JSC_DECLARE_HOST_FUNCTION(functionNavigatorGetGPU);

} // namespace Bun
