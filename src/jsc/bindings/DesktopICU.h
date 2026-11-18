#pragma once

#include <unicode/utext.h>
#include <unicode/utypes.h>

#if __has_include(<unicode/ubidi.h>)
#include <unicode/ubidi.h>
#include <unicode/ubrk.h>
#include <unicode/ucal.h>
#include <unicode/udat.h>
#include <unicode/udatpg.h>
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
    UBRK_WORD = 1,
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
void ubrk_setText(UBreakIterator*, const UChar* text, int32_t length, UErrorCode*);
int32_t ubrk_next(UBreakIterator*);
int32_t ubrk_previous(UBreakIterator*);
int32_t ubrk_following(UBreakIterator*, int32_t offset);
const UNormalizer2* unorm2_getNFCInstance(UErrorCode*);
int32_t unorm2_getRawDecomposition(const UNormalizer2*, UChar32, UChar* decomposition, int32_t capacity, UErrorCode*);
UChar32 unorm2_composePair(const UNormalizer2*, UChar32, UChar32);
UScriptCode uscript_getScript(UChar32, UErrorCode*);
const char* uscript_getShortName(UScriptCode);

typedef void* UCalendar;
typedef void* UDateFormat;
typedef void* UDateTimePatternGenerator;
typedef struct UFieldPosition UFieldPosition;
typedef enum { UCAL_DEFAULT = 0,
    UCAL_GREGORIAN = 1 } UCalendarType;
typedef enum { UCAL_FIRST_DAY_OF_WEEK = 1 } UCalendarAttribute;
typedef enum { UDAT_PATTERN = -2 } UDateFormatStyle;
typedef enum { UDATPG_MATCH_HOUR_FIELD_LENGTH = 1 << 11 } UDateTimePatternMatchOptions;
constexpr int32_t UCAL_SUNDAY = 1;
UCalendar* ucal_open(const UChar* zone, int32_t length, const char* locale, UCalendarType, UErrorCode*);
void ucal_close(UCalendar*);
int32_t ucal_getHostTimeZone(UChar* result, int32_t capacity, UErrorCode*);
int32_t ucal_getAttribute(const UCalendar*, UCalendarAttribute);
UDateFormat* udat_open(UDateFormatStyle time, UDateFormatStyle date, const char* locale, const UChar* zone, int32_t zoneLength, const UChar* pattern, int32_t patternLength, UErrorCode*);
void udat_close(UDateFormat*);
int32_t udat_format(const UDateFormat*, UDate, UChar* result, int32_t capacity, UFieldPosition*, UErrorCode*);
UDateTimePatternGenerator* udatpg_open(const char* locale, UErrorCode*);
void udatpg_close(UDateTimePatternGenerator*);
int32_t udatpg_getBestPatternWithOptions(UDateTimePatternGenerator*, const UChar* skeleton, int32_t length, UDateTimePatternMatchOptions, UChar* result, int32_t capacity, UErrorCode*);
}
#endif
