#pragma once

// Shared prefix for everything under webgpu/ (the WebCore GPU* objects, their
// generated bindings, InternalAPI/, Implementation/, WGSL/ and the Metal
// backend in WebGPU/). The sources are imported from WebKit by
// scripts/import-webgpu-from-webkit.ts and keep their `#include "config.h"`.
//
// Bun's WTF is the JSCOnly configuration, so the WebCore feature macros these
// files test are not defined by cmakeconfig.h. The ones that apply here are
// set below; the rest (ENABLE(VIDEO), ENABLE(WEB_CODECS), ENABLE(WEBXR),
// ENABLE(OFFSCREEN_CANVAS), HAVE(TASK_IDENTITY_TOKEN), ...) stay off, which
// compiles out the parts of the implementation that need a browser around
// them.

#include "root.h"

// The Metal backend is linked into this binary, so the Implementation/ layer
// that drives it through the webgpu.h C API is always present.
#define HAVE_WEBGPU_IMPLEMENTATION 1

// MTLGPUFamilyApple8/9 exist in the SDK bun builds against; -supportsFamily:
// answers NO for families an older Metal.framework does not know about.
#define HAVE_METAL_FAMILY_8 1
#define HAVE_METAL_FAMILY_9 1
