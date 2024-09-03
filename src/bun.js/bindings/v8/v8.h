#pragma once

#include "ZigGlobalObject.h"

#if defined(WIN32) || defined(_WIN32)
#define BUN_EXPORT __declspec(dllexport)
#else
#define BUN_EXPORT JS_EXPORT
#endif

#define V8_UNIMPLEMENTED() BUN_PANIC("You're using a module which calls a V8 function that Bun does not yet implement. Track progress at https://github.com/oven-sh/bun/issues/4290.")

extern "C" Zig::GlobalObject* Bun__getDefaultGlobalObject();

// Use only for types and functions that are exposed in the public V8 API
namespace v8 {

// Use for types added to Bun to support V8 APIs that aren't used in the actual V8 API
namespace shim {
}

} // namespace v8
