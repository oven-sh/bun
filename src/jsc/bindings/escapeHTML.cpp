// Implementation of `Bun.escapeHTML` — replace the five HTML metacharacters
// (& < > " ') with their entities so a string can be embedded in HTML text or
// attribute values without injecting markup.
//
//   &  ->  &amp;
//   <  ->  &lt;
//   >  ->  &gt;
//   "  ->  &quot;
//   '  ->  &#x27;   (numeric; &apos; is not defined in HTML4)
//
// The common case — a string with nothing to escape — is detected with a SIMD
// scan and returns the input JSString unchanged (no allocation). Otherwise a
// second SIMD pass computes the exact escaped length, the result string is
// allocated once via WTF::String::tryCreateUninitialized, and a single
// table-driven scalar pass fills it: a 256-entry length table turns the hot
// loop into one load + branch per character (copy it, or memcpy its entity),
// with no per-run SIMD dispatch, no reallocation and no per-append bookkeeping.
// This keeps both the 8-bit (Latin-1) and 16-bit (UTF-16) paths ahead of the
// previous implementations on passthrough, sparse and escape-dense input alike.
//
// UTF-16 input is copied through code unit by code unit except for the five
// metacharacters; surrogate pairs and lone surrogates are preserved verbatim
// (they are > 0x80 and cannot match a metacharacter) so the output round-trips
// the same text — only markup characters change.

#include "root.h"
#include "escapeHTML.h"

#include <array>
#include <span>
#include <JavaScriptCore/ExceptionHelpers.h>
#include <wtf/text/StringImpl.h>
#include <wtf/text/WTFString.h>

// SIMD kernels implemented in highway_strings.cpp.
extern "C" size_t highway_index_of_html_escape_char8(const uint8_t* text, size_t text_len);
extern "C" size_t highway_index_of_html_escape_char16(const uint16_t* text, size_t text_len);
extern "C" size_t highway_html_escape_extra_len8(const uint8_t* text, size_t text_len);
extern "C" size_t highway_html_escape_extra_len16(const uint16_t* text, size_t text_len);

namespace Bun {

// Per-byte escaped length: 1 for ordinary characters, the entity length for the
// five metacharacters. Only indices 0-127 can be non-1 (metacharacters are
// ASCII), so this also covers the low byte of any UTF-16 code unit.
static constexpr std::array<uint8_t, 256> makeEscapeLengthTable()
{
    std::array<uint8_t, 256> table {};
    for (auto& v : table)
        v = 1;
    table['&'] = 5; // &amp;
    table['<'] = 4; // &lt;
    table['>'] = 4; // &gt;
    table['"'] = 6; // &quot;
    table['\''] = 6; // &#x27;
    return table;
}
static constexpr auto kEscapeLength = makeEscapeLengthTable();

// Write the entity for metacharacter `c` into `out`, returning the count. Only
// reached for the five metacharacters; entity bytes are ASCII and widen
// implicitly to CharacterType.
template<typename CharacterType>
static ALWAYS_INLINE size_t writeEntity(CharacterType* out, CharacterType c)
{
    switch (c) {
    case '&':
        out[0] = '&';
        out[1] = 'a';
        out[2] = 'm';
        out[3] = 'p';
        out[4] = ';';
        return 5;
    case '<':
        out[0] = '&';
        out[1] = 'l';
        out[2] = 't';
        out[3] = ';';
        return 4;
    case '>':
        out[0] = '&';
        out[1] = 'g';
        out[2] = 't';
        out[3] = ';';
        return 4;
    case '"':
        out[0] = '&';
        out[1] = 'q';
        out[2] = 'u';
        out[3] = 'o';
        out[4] = 't';
        out[5] = ';';
        return 6;
    default: // '\''
        out[0] = '&';
        out[1] = '#';
        out[2] = 'x';
        out[3] = '2';
        out[4] = '7';
        out[5] = ';';
        return 6;
    }
}

// SWAR "does this 8-byte word contain byte `b`?" — sets the high bit of any
// matching byte's lane, 0 elsewhere. Classic bit trick, no SIMD dispatch.
static ALWAYS_INLINE uint64_t swarHasByte(uint64_t x, uint8_t b)
{
    const uint64_t ones = 0x0101010101010101ULL;
    const uint64_t y = x ^ (ones * b);
    return (y - ones) & ~y & 0x8080808080808080ULL;
}

// Index of the first metacharacter in `span`, or span.size() if none. Short
// inputs avoid the SIMD kernels — those dispatch through an indirect call
// (HWY_DYNAMIC_DISPATCH) whose overhead dominates for a handful of characters,
// and most `Bun.escapeHTML` calls are on short strings. The 8-bit path scans
// 8 bytes at a time with SWAR; the 16-bit path uses a short scalar loop.
template<typename CharacterType>
static ALWAYS_INLINE size_t indexOfHTMLEscape(std::span<const CharacterType> span)
{
    constexpr size_t kScalarThreshold = 32;
    const size_t length = span.size();
    const CharacterType* const data = span.data();

    if constexpr (sizeof(CharacterType) == 1) {
        if (length >= kScalarThreshold)
            return highway_index_of_html_escape_char8(reinterpret_cast<const uint8_t*>(data), length);
        size_t i = 0;
        for (; i + 8 <= length; i += 8) {
            uint64_t word;
            memcpy(&word, data + i, 8);
            const uint64_t hit = swarHasByte(word, '"') | swarHasByte(word, '&')
                | swarHasByte(word, '\'') | swarHasByte(word, '<') | swarHasByte(word, '>');
            if (hit)
                return i + (__builtin_ctzll(hit) >> 3);
        }
        for (; i < length; ++i) {
            if (kEscapeLength[data[i]] != 1)
                return i;
        }
        return length;
    } else {
        if (length >= kScalarThreshold)
            return highway_index_of_html_escape_char16(reinterpret_cast<const uint16_t*>(data), length);
        for (size_t i = 0; i < length; ++i) {
            const char16_t c = data[i];
            if (c < 0x100 && kEscapeLength[static_cast<uint8_t>(c)] != 1)
                return i;
        }
        return length;
    }
}

// Bytes the escaped output needs beyond the input length (0 for passthrough).
template<typename CharacterType>
static ALWAYS_INLINE size_t htmlEscapeExtraLen(std::span<const CharacterType> span)
{
    if constexpr (sizeof(CharacterType) == 1)
        return highway_html_escape_extra_len8(reinterpret_cast<const uint8_t*>(span.data()), span.size());
    else
        return highway_html_escape_extra_len16(reinterpret_cast<const uint16_t*>(span.data()), span.size());
}

// Shared escape routine for both 8-bit (Latin-1) and 16-bit (UTF-16) input.
// Throws and returns nullptr if the escaped output would exceed
// String::MaxLength — each metacharacter expands up to 6× (`&quot;`/`&#x27;`),
// so `outLength` can be several times the input length.
template<typename CharacterType>
static JSC::JSString* escapeHTMLString(JSC::JSGlobalObject* globalObject, JSC::JSString* input, std::span<const CharacterType> span)
{
    auto& vm = JSC::getVM(globalObject);
    const size_t length = span.size();
    const CharacterType* const src = span.data();
    const size_t firstEscape = indexOfHTMLEscape(span);
    // Nothing to escape — hand back the original string without allocating.
    if (firstEscape == length)
        return input;

    // Pass 2: exact output length. firstEscape is a metacharacter, so extra > 0.
    const size_t extra = htmlEscapeExtraLen(span.subspan(firstEscape));
    const size_t outLength = length + extra;

    // Bail before allocating if the escaped output can't fit in a WTF::String.
    // `outLength` is a size_t that can reach ~6× the input (well past
    // UINT_MAX for a near-max-length input of all `"`/`'`), so check the full
    // 64-bit value explicitly rather than relying on the allocator.
    if (outLength > WTF::StringImpl::MaxLength) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(vm);
        throwOutOfMemoryError(globalObject, scope);
        return nullptr;
    }

    std::span<CharacterType> out;
    RefPtr<WTF::StringImpl> impl = WTF::StringImpl::tryCreateUninitialized(outLength, out);
    if (!impl) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(vm);
        throwOutOfMemoryError(globalObject, scope);
        return nullptr;
    }

    CharacterType* dst = out.data();

    // Clean prefix up to the first metacharacter, copied in one shot.
    if (firstEscape > 0) {
        memcpy(dst, src, firstEscape * sizeof(CharacterType));
        dst += firstEscape;
    }

    // Table-driven single pass over the rest: one table load + branch per
    // character. Ordinary characters (length 1) are copied; metacharacters
    // expand to their entity. A code unit > 0xFF has a low byte that might
    // index a metacharacter slot, so gate the table lookup on c < 0x100 for the
    // 16-bit path (folds away for the 8-bit path).
    for (size_t i = firstEscape; i < length; ++i) {
        const CharacterType c = src[i];
        if (sizeof(CharacterType) == 1 || c < 0x100) {
            const uint8_t entityLength = kEscapeLength[static_cast<uint8_t>(c)];
            if (entityLength != 1) {
                dst += writeEntity(dst, c);
                continue;
            }
        }
        *dst++ = c;
    }

    ASSERT(static_cast<size_t>(dst - out.data()) == outLength);
    return JSC::jsString(vm, WTF::String(impl.releaseNonNull()));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunEscapeHTML, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSValue argument = callFrame->argument(0);
    if (argument.isEmpty())
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));
    if (argument.isNumber() || argument.isBoolean() || argument.isUndefined() || argument.isNull())
        return JSC::JSValue::encode(argument.toString(globalObject));

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSString* string = argument.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (string->length() == 0)
        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(string));

    const auto view = string->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSC::JSString* result = view->is8Bit()
        ? escapeHTMLString<Latin1Character>(globalObject, string, view->span8())
        : escapeHTMLString<char16_t>(globalObject, string, view->span16());
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(result));
}

} // namespace Bun
