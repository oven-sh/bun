#pragma once

#include "ZigGlobalObject.h"

#if defined(WIN32) || defined(_WIN32)
#define BUN_EXPORT __declspec(dllexport)
#else
#define BUN_EXPORT JS_EXPORT
#endif

extern "C" Zig::GlobalObject* Bun__getDefaultGlobalObject();

namespace v8 {
}
