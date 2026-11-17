#include "root.h"

#include "DesktopICU.h"
#include "GeneratedBlob.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/JSDateMath.h>
#include <unicode/uchar.h>
#include <wtf/WallTime.h>
#include <wtf/text/MakeString.h>
#include <wtf/unicode/icu/ICUHelpers.h>

extern "C" BunString Blob__getFileNameString(void* impl);

namespace Bun {

extern "C" BunString Bun__DOM__nameOfFile(JSC::EncodedJSValue file)
{
    auto* blob = dynamicDowncast<Bindgen::Generated::JSBlob>(JSC::JSValue::decode(file));
    return blob ? Blob__getFileNameString(blob->wrapped()) : BunString { BunStringTag::Empty };
}

static ASCIICString withLatinDigits(const char* locale)
{
    return makeString(StringView::fromLatin1(locale), "@calendar=gregorian;numbers=latn"_s).ascii();
}

extern "C" uint32_t Bun__DOM__bestDatePattern(const char* locale, const char16_t* skeleton, uint32_t length, char16_t* out, uint32_t capacity)
{
    UErrorCode status = U_ZERO_ERROR;
    std::unique_ptr<UDateTimePatternGenerator, ICUDeleter<udatpg_close>> generator(udatpg_open(withLatinDigits(locale).data(), &status));
    int32_t written = udatpg_getBestPatternWithOptions(generator.get(), skeleton, length, UDATPG_MATCH_HOUR_FIELD_LENGTH, out, capacity, &status);
    return U_SUCCESS(status) ? written : 0;
}

extern "C" uint32_t Bun__DOM__formatDate(const char* locale, const char16_t* pattern, uint32_t length, double time, char16_t* out, uint32_t capacity)
{
    UErrorCode status = U_ZERO_ERROR;
    std::unique_ptr<UDateFormat, ICUDeleter<udat_close>> format(udat_open(UDAT_PATTERN, UDAT_PATTERN, withLatinDigits(locale).data(), u"UTC", 3, pattern, length, &status));
    int32_t written = udat_format(format.get(), time, out, capacity, nullptr, &status);
    return U_SUCCESS(status) ? written : 0;
}

extern "C" uint32_t Bun__DOM__firstDayOfWeek(const char* locale)
{
    UErrorCode status = U_ZERO_ERROR;
    std::unique_ptr<UCalendar, ICUDeleter<ucal_close>> calendar(ucal_open(u"UTC", 3, locale, UCAL_GREGORIAN, &status));
    return ((U_SUCCESS(status) ? ucal_getAttribute(calendar.get(), UCAL_FIRST_DAY_OF_WEEK) : UCAL_SUNDAY) + 5) % 7;
}

extern "C" double Bun__DOM__localTime(JSC::JSGlobalObject* globalObject)
{
    double now = WallTime::now().secondsSinceEpoch().milliseconds();
    return now + globalObject->vm().dateCache.msToGregorianDateTime(now, WTF::TimeType::LocalTime).utcOffsetInMinute() * WTF::msPerMinute;
}

extern "C" uint64_t Bun__DOM__clusterAt(const char16_t* text, uint32_t length, uint32_t offset)
{
    static thread_local std::unique_ptr<UBreakIterator, ICUDeleter<ubrk_close>> characters;
    UErrorCode status = U_ZERO_ERROR;
    if (!characters)
        characters.reset(ubrk_open(UBRK_CHARACTER, "", nullptr, 0, &status));
    auto* iterator = characters.get();
    RELEASE_ASSERT(iterator);
    ubrk_setText(iterator, text, length, &status);
    int32_t end = ubrk_following(iterator, offset);
    if (end == UBRK_DONE)
        return static_cast<uint64_t>(length) << 32 | length;
    return static_cast<uint64_t>(end) << 32 | static_cast<uint32_t>(ubrk_previous(iterator));
}

extern "C" bool Bun__DOM__isMark(uint32_t character)
{
    return U_GET_GC_MASK(character) & U_GC_M_MASK;
}

}
