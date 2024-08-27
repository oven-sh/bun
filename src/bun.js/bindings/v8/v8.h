#pragma once

#include "ZigGlobalObject.h"

#if defined(WIN32) || defined(_WIN32)
#define BUN_EXPORT __declspec(dllexport)
#else
#define BUN_EXPORT JS_EXPORT
#endif

#define V8_UNIMPLEMENTED()                                                                                                                                                                                                     \
    {                                                                                                                                                                                                                          \
        const str = WTF::makeString("You're using a module which calls a V8 function \""_s, __PRETTY_FUNCTION__ "" _s, "\" that Bun does not yet implement. Track progress at https://github.com/oven-sh/bun/issues/4290."_s); \
        auto utf8 = str->utf8();                                                                                                                                                                                               \
        Bun__panic(utf8.data(), utf8.size());                                                                                                                                                                                  \
    }

extern "C" Zig::GlobalObject* Bun__getDefaultGlobalObject();

namespace v8 {
}
