#include "EncodeURIComponent.h"

// from JSGlobalObjectFunctions.cpp

namespace JSC {

template<typename CharacterType>
static WebCore::ExceptionOr<void> encode(VM& vm, const WTF::BitSet<256>& doNotEscape, std::span<const CharacterType> characters, StringBuilder& builder)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    // 18.2.6.1.1 Runtime Semantics: Encode ( string, unescapedSet )
    // https://tc39.github.io/ecma262/#sec-encode

    auto throwException = [] {
        return WebCore::ExceptionOr<void>(WebCore::Exception { WebCore::EncodingError, "String contained an illegal UTF-16 sequence."_s });
    };

    builder.reserveCapacity(characters.size());

    // 4. Repeat
    auto* end = characters.data() + characters.size();
    for (auto* cursor = characters.data(); cursor != end; ++cursor) {
        auto character = *cursor;

        // 4-c. If C is in unescapedSet, then
        if (character < doNotEscape.size() && doNotEscape.get(character)) {
            // 4-c-i. Let S be a String containing only the code unit C.
            // 4-c-ii. Let R be a new String value computed by concatenating the previous value of R and S.
            builder.append(static_cast<Latin1Character>(character));
            continue;
        }

        // 4-d-i. If the code unit value of C is not less than 0xDC00 and not greater than 0xDFFF, throw a URIError exception.
        if (U16_IS_TRAIL(character))
            return throwException();

        // 4-d-ii. If the code unit value of C is less than 0xD800 or greater than 0xDBFF, then
        // 4-d-ii-1. Let V be the code unit value of C.
        char32_t codePoint;
        if (!U16_IS_LEAD(character))
            codePoint = character;
        else {
            // 4-d-iii. Else,
            // 4-d-iii-1. Increase k by 1.
            ++cursor;

            // 4-d-iii-2. If k equals strLen, throw a URIError exception.
            if (cursor == end)
                return throwException();

            // 4-d-iii-3. Let kChar be the code unit value of the code unit at index k within string.
            auto trail = *cursor;

            // 4-d-iii-4. If kChar is less than 0xDC00 or greater than 0xDFFF, throw a URIError exception.
            if (!U16_IS_TRAIL(trail))
                return throwException();

            // 4-d-iii-5. Let V be UTF16Decode(C, kChar).
            codePoint = U16_GET_SUPPLEMENTARY(character, trail);
        }

        // 4-d-iv. Let Octets be the array of octets resulting by applying the UTF-8 transformation to V, and let L be the array size.
        Latin1Character utf8OctetsBuffer[U8_MAX_LENGTH];
        unsigned utf8Length = 0;
        // We can use U8_APPEND_UNSAFE here since codePoint is either
        // 1. non surrogate one, correct code point.
        // 2. correct code point generated from validated lead and trail surrogates.
        U8_APPEND_UNSAFE(utf8OctetsBuffer, utf8Length, codePoint);

        // 4-d-v. Let j be 0.
        // 4-d-vi. Repeat, while j < L
        for (unsigned index = 0; index < utf8Length; ++index) {
            // 4-d-vi-1. Let jOctet be the value at index j within Octets.
            // 4-d-vi-2. Let S be a String containing three code units "%XY" where XY are two uppercase hexadecimal digits encoding the value of jOctet.
            // 4-d-vi-3. Let R be a new String value computed by concatenating the previous value of R and S.
            builder.append('%');
            builder.append(hex(utf8OctetsBuffer[index], 2));
        }
    }
    return {};
}

static WebCore::ExceptionOr<void> encode(VM& vm, WTF::StringView view, const WTF::BitSet<256>& doNotEscape, StringBuilder& builder)
{
    if (view.is8Bit())
        return encode(vm, doNotEscape, view.span8(), builder);
    return encode(vm, doNotEscape, view.span16(), builder);
}

WebCore::ExceptionOr<void> encodeURIComponent(VM& vm, WTF::StringView source, StringBuilder& builder)
{
    static constexpr auto doNotEscapeWhenEncodingURIComponent = makeLatin1CharacterBitSet(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        "abcdefghijklmnopqrstuvwxyz"
        "0123456789"
        "!'()*-._~");
    return encode(vm, source, doNotEscapeWhenEncodingURIComponent, builder);
}

}
