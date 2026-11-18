// What the UI library borrows from the libraries that are linked into Bun. See src/runtime/desktop/host_abi.rs.
#include "root.h"
#include <wtf/DateMath.h>

#include "DesktopICU.h"
#include <unicode/uchar.h>
#include <unicode/utext.h>
#include <unicode/utf16.h>
#include <unicode/utf8.h>

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

extern "C" double Bun__DesktopHost__localTimeOffset(double time)
{
    return WTF::calculateLocalTimeOffset(time).offset;
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
    static constexpr std::array<std::pair<UBreakIteratorType, const char*>, 8> kinds { {
        { UBRK_CHARACTER, "en" },
        { UBRK_LINE, "en@lb=normal" },
        { UBRK_LINE, "en@lb=loose" },
        { UBRK_LINE, "en@lb=strict" },
        { UBRK_LINE, "zh@lb=normal" },
        { UBRK_LINE, "zh@lb=loose" },
        { UBRK_LINE, "zh@lb=strict" },
        { UBRK_WORD, "en" },
    } };
    using Iterator = std::unique_ptr<UBreakIterator, decltype([](UBreakIterator* iterator) { ubrk_close(iterator); })>;
    [[clang::always_destroy]] static thread_local std::array<Iterator, kinds.size()> iterators;
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
