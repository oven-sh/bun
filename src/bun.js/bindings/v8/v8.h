#pragma once

#include "ZigGlobalObject.h"

#define V8_UNIMPLEMENTED()                                                                                          \
    do {                                                                                                            \
        const auto str = WTF::makeString(                                                                           \
            "You're using a module which calls a V8 function \""_s,                                                 \
            WTF::ASCIILiteral::fromLiteralUnsafe(__PRETTY_FUNCTION__),                                              \
            "\" that Bun does not yet implement. Track progress at https://github.com/oven-sh/bun/issues/4290."_s); \
        auto utf8 = str.utf8();                                                                                     \
        Bun__panic(utf8.data(), utf8.length());                                                                     \
    } while (0)

// Use only for types and functions that are exposed in the public V8 API
namespace v8 {

// Use for types added to Bun to support V8 APIs that aren't used in the actual V8 API
namespace shim {
}

} // namespace v8
