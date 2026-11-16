// What the UI library borrows from the libraries that are linked into Bun. See src/runtime/desktop/host_abi.rs.
#include "root.h"

#include <brotli/decode.h>
#include <unicode/uchar.h>
#include <unicode/utext.h>
#include <unicode/utf16.h>
#include <unicode/utf8.h>
#include <zlib.h>

#if __has_include(<unicode/ubidi.h>)
#include <unicode/ubidi.h>
#include <unicode/ubrk.h>
#include <unicode/unorm2.h>
#include <unicode/uscript.h>
#else
// macOS: libicucore has these, under these names, and the SDK has no header for them.
extern "C" {
typedef struct UBiDi UBiDi;
typedef struct UBreakIterator UBreakIterator;
typedef struct UNormalizer2 UNormalizer2;
typedef uint8_t UBiDiLevel;
typedef int32_t UScriptCode;
typedef enum { UBRK_CHARACTER = 0,
    UBRK_LINE = 2 } UBreakIteratorType;
constexpr UBiDiLevel UBIDI_DEFAULT_LTR = 0xfe;
constexpr int32_t UBRK_DONE = -1;
UBiDi* ubidi_open();
void ubidi_close(UBiDi*);
void ubidi_setPara(UBiDi*, const UChar* text, int32_t length, UBiDiLevel, UBiDiLevel* embeddingLevels, UErrorCode*);
const UBiDiLevel* ubidi_getLevels(UBiDi*, UErrorCode*);
UBiDiLevel ubidi_getParaLevel(const UBiDi*);
UBreakIterator* ubrk_open(UBreakIteratorType, const char* locale, const UChar* text, int32_t length, UErrorCode*);
void ubrk_close(UBreakIterator*);
void ubrk_setUText(UBreakIterator*, UText*, UErrorCode*);
int32_t ubrk_next(UBreakIterator*);
const UNormalizer2* unorm2_getNFCInstance(UErrorCode*);
int32_t unorm2_getRawDecomposition(const UNormalizer2*, UChar32, UChar* decomposition, int32_t capacity, UErrorCode*);
UChar32 unorm2_composePair(const UNormalizer2*, UChar32, UChar32);
UScriptCode uscript_getScript(UChar32, UErrorCode*);
const char* uscript_getShortName(UScriptCode);
}
#endif

extern "C" void* Bun__DesktopHost__inflateBegin()
{
    auto stream = std::make_unique<z_stream>();
    if (inflateInit(stream.get()) != Z_OK)
        return nullptr;
    inflateValidate(stream.get(), 0);
    return stream.release();
}

extern "C" int32_t Bun__DesktopHost__inflate(void* state, const uint8_t* input, size_t* inputLength, uint8_t* output, size_t* outputLength)
{
    auto* stream = static_cast<z_stream*>(state);
    const uInt availableIn = std::min<size_t>(*inputLength, UINT_MAX), availableOut = std::min<size_t>(*outputLength, UINT_MAX);
    stream->next_in = const_cast<uint8_t*>(input);
    stream->avail_in = availableIn;
    stream->next_out = output;
    stream->avail_out = availableOut;
    const int result = inflate(stream, Z_NO_FLUSH);
    *inputLength = availableIn - stream->avail_in;
    *outputLength = availableOut - stream->avail_out;
    return result == Z_STREAM_END ? 1 : result == Z_OK || result == Z_BUF_ERROR ? 0
                                                                                : -1;
}

extern "C" void Bun__DesktopHost__inflateEnd(void* state)
{
    std::unique_ptr<z_stream> stream(static_cast<z_stream*>(state));
    inflateEnd(stream.get());
}

extern "C" size_t Bun__DesktopHost__decodeBrotli(const uint8_t* input, size_t inputLength, uint8_t* output, size_t outputLength)
{
    auto* decoder = BrotliDecoderCreateInstance(nullptr, nullptr, nullptr);
    if (!decoder)
        return 0;
    size_t left = outputLength;
    BrotliDecoderDecompressStream(decoder, &inputLength, &input, &left, &output, nullptr);
    BrotliDecoderDestroyInstance(decoder);
    return outputLength - left;
}

extern "C" int32_t Bun__DesktopHost__characterProperty(uint32_t character, uint32_t property)
{
    return u_getIntPropertyValue(character, static_cast<UProperty>(property));
}

extern "C" uint32_t Bun__DesktopHost__scriptOf(uint32_t character)
{
    UErrorCode status = U_ZERO_ERROR;
    const char* name = uscript_getShortName(uscript_getScript(character, &status));
    if (U_FAILURE(status) || !name || strlen(name) != 4)
        name = "Zzzz";
    return name[0] << 24 | name[1] << 16 | name[2] << 8 | name[3];
}

extern "C" uint32_t Bun__DesktopHost__mirror(uint32_t character)
{
    return u_charMirror(character);
}

extern "C" uint64_t Bun__DesktopHost__decompose(uint32_t character)
{
    UErrorCode status = U_ZERO_ERROR;
    UChar units[4];
    const int32_t length = unorm2_getRawDecomposition(unorm2_getNFCInstance(&status), character, units, 4, &status);
    if (U_FAILURE(status) || length <= 0)
        return 0;
    int32_t at = 0;
    UChar32 first, second = 0;
    U16_NEXT(units, at, length, first);
    if (at < length)
        U16_NEXT(units, at, length, second);
    return static_cast<uint64_t>(second) << 32 | first;
}

extern "C" uint32_t Bun__DesktopHost__compose(uint32_t first, uint32_t second)
{
    UErrorCode status = U_ZERO_ERROR;
    const auto* normalizer = unorm2_getNFCInstance(&status);
    return U_FAILURE(status) ? 0 : std::max(unorm2_composePair(normalizer, first, second), 0);
}

extern "C" size_t Bun__DesktopHost__findBreaks(uint8_t kind, const uint8_t* text, size_t length, uint32_t* offsets)
{
    static constexpr std::array<std::pair<UBreakIteratorType, const char*>, 7> kinds { {
        { UBRK_CHARACTER, "en" },
        { UBRK_LINE, "en@lb=normal" },
        { UBRK_LINE, "en@lb=loose" },
        { UBRK_LINE, "en@lb=strict" },
        { UBRK_LINE, "zh@lb=normal" },
        { UBRK_LINE, "zh@lb=loose" },
        { UBRK_LINE, "zh@lb=strict" },
    } };
    using Iterator = std::unique_ptr<UBreakIterator, decltype([](UBreakIterator* iterator) { ubrk_close(iterator); })>;
    static thread_local std::array<Iterator, kinds.size()> iterators;
    if (kind >= kinds.size() || length > INT32_MAX)
        return 0;
    UErrorCode status = U_ZERO_ERROR;
    auto& iterator = iterators[kind];
    if (!iterator)
        iterator.reset(ubrk_open(kinds[kind].first, kinds[kind].second, nullptr, 0, &status));
    UText source = UTEXT_INITIALIZER;
    utext_openUTF8(&source, reinterpret_cast<const char*>(text), length, &status);
    if (iterator)
        ubrk_setUText(iterator.get(), &source, &status);
    size_t count = 0;
    if (iterator && U_SUCCESS(status)) {
        for (int32_t at = ubrk_next(iterator.get()); at != UBRK_DONE && count < length; at = ubrk_next(iterator.get()))
            offsets[count++] = at;
    }
    utext_close(&source);
    return count;
}

extern "C" uint8_t Bun__DesktopHost__resolveBidi(const uint8_t* text, size_t length, uint8_t direction, uint8_t* levels)
{
    const uint8_t fallback = direction == 1;
    memset(levels, fallback, length);
    if (!length || length > INT32_MAX)
        return fallback;
    Vector<UChar> units;
    units.reserveInitialCapacity(length);
    for (int32_t at = 0; at < static_cast<int32_t>(length);) {
        UChar32 character;
        U8_NEXT_UNSAFE(text, at, character);
        if (U_IS_BMP(character))
            units.append(character);
        else
            units.appendList({ U16_LEAD(character), U16_TRAIL(character) });
    }
    UErrorCode status = U_ZERO_ERROR;
    std::unique_ptr<UBiDi, decltype([](UBiDi* bidi) { ubidi_close(bidi); })> bidi(ubidi_open());
    ubidi_setPara(bidi.get(), units.span().data(), units.size(), direction > 1 ? UBIDI_DEFAULT_LTR : direction, nullptr, &status);
    const UBiDiLevel* resolved = ubidi_getLevels(bidi.get(), &status);
    if (U_FAILURE(status))
        return fallback;
    for (size_t at = 0, unit = 0, next = 0; at < length; at++) {
        if (!U8_IS_TRAIL(text[at]))
            unit = std::exchange(next, next + (text[at] >= 0xF0 ? 2 : 1));
        levels[at] = resolved[unit];
    }
    return ubidi_getParaLevel(bidi.get());
}
