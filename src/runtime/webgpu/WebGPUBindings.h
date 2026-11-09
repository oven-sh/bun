#pragma once

#include "root.h"

#if BUN_WEBGPU

namespace Bun {

// `GPUBuffer`, `GPUBufferUsage` and the other names that WebGPU gives the global object.
void addWebGPUGlobals(JSC::VM&, JSC::JSGlobalObject*);
// `navigator.gpu`.
void addWebGPUToNavigator(JSC::VM&, JSC::JSObject* navigator);

}

#endif
