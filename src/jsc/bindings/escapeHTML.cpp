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
// allocated once via WTF::String::tryCreateUninitialized, and a third one
// fills it (src/simd_kernels/html.rs).
//
// UTF-16 input is copied through code unit by code unit except for the five
// metacharacters; surrogate pairs and lone surrogates are preserved verbatim
// (they are > 0x80 and cannot match a metacharacter) so the output round-trips
// the same text — only markup characters change.

#include "root.h"
#include "escapeHTML.h"
#include "bun_simd.h"

#include <array>
#include <span>
#include <JavaScriptCore/ExceptionHelpers.h>
#include <wtf/text/StringImpl.h>
#include <wtf/text/WTFString.h>

namespace Bun {

// Indexed by a Latin-1 character.
static constexpr auto kIsEscaped = [] {
    std::array<bool, 256> table {};
    for (const uint8_t c : { '&', '<', '>', '"', '\'' })
        table[c] = true;
    return table;
}();

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
// whose overhead dominates for a handful of characters, and most
// `Bun.escapeHTML` calls are on short strings. The 8-bit path scans 8 bytes at
// a time with SWAR; the 16-bit path uses a short scalar loop.
template<typename CharacterType>
static ALWAYS_INLINE size_t indexOfHTMLEscape(std::span<const CharacterType> span)
{
    constexpr size_t kScalarThreshold = sizeof(CharacterType) == 1 ? 32 : 20;
    const size_t length = span.size();
    const CharacterType* const data = span.data();

    if constexpr (sizeof(CharacterType) == 1) {
        if (length >= kScalarThreshold)
            return bun_simd_index_of_html_escape_char8(reinterpret_cast<const uint8_t*>(data), length);
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
            if (kIsEscaped[data[i]])
                return i;
        }
        return length;
    } else {
        if (length >= kScalarThreshold && data[0] != '<')
            return bun_simd_index_of_html_escape_char16(reinterpret_cast<const uint16_t*>(data), length);
        for (size_t i = 0; i < length; ++i) {
            const char16_t c = data[i];
            if (c < 0x100 && kIsEscaped[c])
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
        return bun_simd_html_escape_extra_len8(reinterpret_cast<const uint8_t*>(span.data()), span.size());
    else
        return bun_simd_html_escape_extra_len16(reinterpret_cast<const uint16_t*>(span.data()), span.size());
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

    // Clean prefix up to the first metacharacter, copied in one shot.
    if (firstEscape > 0)
        memcpy(out.data(), span.data(), firstEscape * sizeof(CharacterType));

    const auto from = span.subspan(firstEscape);
    const auto to = out.subspan(firstEscape);
    if constexpr (sizeof(CharacterType) == 1)
        bun_simd_escape_html8(reinterpret_cast<const uint8_t*>(from.data()), from.size(), reinterpret_cast<uint8_t*>(to.data()), to.size());
    else
        bun_simd_escape_html16(reinterpret_cast<const uint16_t*>(from.data()), from.size(), reinterpret_cast<uint16_t*>(to.data()), to.size());
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
