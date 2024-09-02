#pragma once

#include "ZigGlobalObject.h"

#if defined(WIN32) || defined(_WIN32)
#define BUN_EXPORT __declspec(dllexport)
#else
#define BUN_EXPORT JS_EXPORT
#endif

#define V8_UNIMPLEMENTED()                                                                                          \
    do {                                                                                                            \
        const auto str = WTF::makeString(                                                                           \
            "You're using a module which calls a V8 function \""_s,                                                 \
            WTF::ASCIILiteral::fromLiteralUnsafe(__PRETTY_FUNCTION__),                                              \
            "\" that Bun does not yet implement. Track progress at https://github.com/oven-sh/bun/issues/4290."_s); \
        auto utf8 = str.utf8();                                                                                     \
        Bun__panic(utf8.data(), utf8.length());                                                                     \
    } while (0)

namespace v8 {
}
