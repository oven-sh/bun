#pragma once

#include "engine/support/HashFunctions.h"
#include "engine/text/AtomString.h"

extern "C" unsigned engine_text_hash_ignoring_ascii_case(WTF::StringView);

namespace WTF {

struct StringHash {
    static unsigned hash(const String& key) { return key.isNull() ? 0 : key.impl()->hash(); }
    static bool equal(const String& a, const String& b) { return a == b; }
};

struct ASCIICaseInsensitiveHash {
    static unsigned hash(const String& key) { return engine_text_hash_ignoring_ascii_case(key); }
    static bool equal(const String& a, const String& b) { return equalIgnoringASCIICase(StringView { a }, StringView { b }); }
};

struct ASCIILiteralHash {
    static unsigned hash(ASCIILiteral key) { return StringHasher::computeHashAndMaskTop8Bits(key.span8()); }
    static bool equal(ASCIILiteral a, ASCIILiteral b) { return a == b; }
};

template<> struct DefaultHash<ASCIILiteral> : ASCIILiteralHash {};
template<> struct DefaultHash<String> : StringHash {};

}

using WTF::ASCIICaseInsensitiveHash;
using WTF::StringHash;
