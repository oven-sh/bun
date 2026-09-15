#pragma once

#include "root.h"

namespace Bun {

// The WebGPU globals that are JavaScript classes (src/js/internal/webgpu.ts):
// GPUDevice, GPUError, GPUBufferUsage, ... One getter serves them all, keyed by
// the property name. They are CustomValue entries in ZigGlobalObject.lut.txt and
// not PropertyCallbacks because a PropertyCallback can run while bytecode is
// being linked, where evaluating the module's JavaScript is not allowed. The
// native classes (GPUBuffer, GPUTexture, ...) are ClassStructure entries there.
JSC_DECLARE_CUSTOM_GETTER(jsWebGPUGlobal);
JSC_DECLARE_CUSTOM_SETTER(setJSWebGPUGlobal);

JSC_DECLARE_HOST_FUNCTION(functionNavigatorGetGPU);

} // namespace Bun
