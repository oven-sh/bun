/*
 * Copyright (C) 2009 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "DateComponents.h"

#include <limits.h>
#include <wtf/ASCIICType.h>
#include <wtf/DateMath.h>
#include <wtf/MathExtras.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/ParsingUtilities.h>
#include <wtf/text/StringParsingBuffer.h>

namespace WebCore {

// HTML defines minimum week of year is one.
static constexpr int minimumWeekNumber = 1;

// HTML defines maximum week of year is 53.
static constexpr int maximumWeekNumber = 53;

static constexpr int maximumMonthInMaximumYear = 8; // This is September, since months are 0 based.
static constexpr int maximumDayInMaximumMonth = 13;
static constexpr int maximumWeekInMaximumYear = 37; // The week of 275760-09-13

static constexpr std::array<int, 12> daysInMonth { 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 };

// 'month' is 0-based.
static int LEGACY_NODELETE maxDayOfMonth(int year, int month)
{
    if (month != 1) // February?
        return daysInMonth[month];
    return isLeapYear(year) ? 29 : 28;
}

// 'month' is 0-based.
static int LEGACY_NODELETE dayOfWeek(int year, int month, int day)
{
    int shiftedMonth = month + 2;
    // 2:January, 3:Feburuary, 4:March, ...

    // Zeller's congruence
    if (shiftedMonth <= 3) {
        shiftedMonth += 12;
        year--;
    }
    // 4:March, ..., 14:January, 15:February

    int highYear = year / 100;
    int lowYear = year % 100;
    // We add 6 to make the result Sunday-origin.
    int result = (day + 13 * shiftedMonth / 5 + lowYear + lowYear / 4 + highYear / 4 + 5 * highYear + 6) % 7;
    return result;
}

int DateComponents::maxWeekNumberInYear() const
{
    int day = dayOfWeek(m_year, 0, 1); // January 1.
    return day == Thursday || (day == Wednesday && isLeapYear(m_year)) ? maximumWeekNumber : maximumWeekNumber - 1;
}

template<typename CharacterType> static unsigned LEGACY_NODELETE countDigits(StringParsingBuffer<CharacterType> buffer)
{
    auto begin = buffer.position();
    skipWhile<isASCIIDigit>(buffer);
    return buffer.position() - begin;
}

// Differences from parseInteger<int>: Takes StringParsingBuffer. Does not allow leading or trailing spaces. Does not allow leading "+".
template<typename CharacterType> static std::optional<int> LEGACY_NODELETE parseInt(StringParsingBuffer<CharacterType>& buffer, unsigned maximumNumberOfDigitsToParse)
{
    if (maximumNumberOfDigitsToParse > buffer.lengthRemaining() || !maximumNumberOfDigitsToParse)
        return std::nullopt;

    // We don't need to handle negative numbers for ISO 8601.

    int value = 0;
    unsigned digitsRemaining = 0;
    while (digitsRemaining < maximumNumberOfDigitsToParse) {
        if (!isASCIIDigit(*buffer))
            return std::nullopt;
        int digit = *buffer - '0';
        if (value > (INT_MAX - digit) / 10) // Check for overflow.
            return std::nullopt;
        value = value * 10 + digit;
        ++digitsRemaining;
        ++buffer;
    }
    return value;
}

template<typename CharacterType> static std::optional<int> LEGACY_NODELETE parseIntWithinLimits(StringParsingBuffer<CharacterType>& buffer, unsigned maximumNumberOfDigitsToParse, int minimumValue, int maximumValue)
{
    auto value = parseInt(buffer, maximumNumberOfDigitsToParse);
    if (!(value && *value >= minimumValue && *value <= maximumValue))
        return std::nullopt;
    return value;
}

// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#months
template<typename CharacterType> bool DateComponents::parseYear(StringParsingBuffer<CharacterType>& buffer)
{
    unsigned digitsLength = countDigits(buffer);
    // Needs at least 4 digits according to the standard.
    if (digitsLength < 4)
        return false;

    auto year = parseIntWithinLimits(buffer, digitsLength, minimumYear(), maximumYear());
    if (!year)
        return false;

    m_year = *year;
    return true;
}

static bool LEGACY_NODELETE withinHTMLDateLimits(int year, int month)
{
    if (year < DateComponents::minimumYear())
        return false;
    if (year < DateComponents::maximumYear())
        return true;
    return month <= maximumMonthInMaximumYear;
}

static bool LEGACY_NODELETE withinHTMLDateLimits(int year, int month, int monthDay)
{
    if (year < DateComponents::minimumYear())
        return false;
    if (year < DateComponents::maximumYear())
        return true;
    if (month < maximumMonthInMaximumYear)
        return true;
    return monthDay <= maximumDayInMaximumMonth;
}

static bool LEGACY_NODELETE withinHTMLDateLimits(int year, int month, int monthDay, int hour, int minute, int second, int millisecond)
{
    if (year < DateComponents::minimumYear())
        return false;
    if (year < DateComponents::maximumYear())
        return true;
    if (month < maximumMonthInMaximumYear)
        return true;
    if (monthDay < maximumDayInMaximumMonth)
        return true;
    if (monthDay > maximumDayInMaximumMonth)
        return false;
    // (year, month, monthDay) = (maximumYear, maximumMonthInMaximumYear, maximumDayInMaximumMonth)
    return !hour && !minute && !second && !millisecond;
}

template<typename F> static std::optional<DateComponents> createFromString(StringView source, NOESCAPE const F& parseFunction)
{
    if (source.isEmpty())
        return std::nullopt;

    return readCharactersForParsing(source, [&](auto buffer) -> std::optional<DateComponents> {
        DateComponents date;
        if (!parseFunction(buffer, date) || !buffer.atEnd())
            return std::nullopt;
        return date;
    });
}

std::optional<DateComponents> DateComponents::fromParsingMonth(StringView source)
{
    return createFromString(source, [] (auto& buffer, auto& date) {
        return date.parseMonth(buffer);
    });
}

std::optional<DateComponents> DateComponents::fromParsingDate(StringView source)
{
    return createFromString(source, [] (auto& buffer, auto& date) {
        return date.parseDate(buffer);
    });
}

std::optional<DateComponents> DateComponents::fromParsingWeek(StringView source)
{
    return createFromString(source, [] (auto& buffer, auto& date) {
        return date.parseWeek(buffer);
    });
}

std::optional<DateComponents> DateComponents::fromParsingTime(StringView source)
{
    return createFromString(source, [] (auto& buffer, auto& date) {
        return date.parseTime(buffer);
    });
}

std::optional<DateComponents> DateComponents::fromParsingDateTimeLocal(StringView source)
{
    return createFromString(source, [] (auto& buffer, auto& date) {
        return date.parseDateTimeLocal(buffer);
    });
}

bool DateComponents::addDay(int dayDiff)
{
    ASSERT(m_monthDay);

    int day = m_monthDay + dayDiff;
    if (day > maxDayOfMonth(m_year, m_month)) {
        day = m_monthDay;
        int year = m_year;
        int month = m_month;
        int maxDay = maxDayOfMonth(year, month);
        for (; dayDiff > 0; --dayDiff) {
            ++day;
            if (day > maxDay) {
                day = 1;
                ++month;
                if (month >= 12) { // month is 0-origin.
                    month = 0;
                    ++year;
                }
                maxDay = maxDayOfMonth(year, month);
            }
        }
        if (!withinHTMLDateLimits(year, month, day))
            return false;
        m_year = year;
        m_month = month;
    } else if (day < 1) {
        int month = m_month;
        int year = m_year;
        day = m_monthDay;
        for (; dayDiff < 0; ++dayDiff) {
            --day;
            if (day < 1) {
                --month;
                if (month < 0) {
                    month = 11;
                    --year;
                }
                day = maxDayOfMonth(year, month);
            }
        }
        if (!withinHTMLDateLimits(year, month, day))
            return false;
        m_year = year;
        m_month = month;
    } else {
        if (!withinHTMLDateLimits(m_year, m_month, day))
            return false;
    }
    m_monthDay = day;
    return true;
}

bool DateComponents::addMinute(int minute)
{
    // This function is used to adjust timezone offset. So m_year, m_month,
    // m_monthDay have values between the lower and higher limits.
    ASSERT(withinHTMLDateLimits(m_year, m_month, m_monthDay));

    int carry;
    // minute can be negative or greater than 59.
    minute += m_minute;
    if (minute > 59) {
        carry = minute / 60;
        minute = minute % 60;
    } else if (minute < 0) {
        carry = (59 - minute) / 60;
        minute += carry * 60;
        carry = -carry;
        ASSERT(minute >= 0 && minute <= 59);
    } else {
        if (!withinHTMLDateLimits(m_year, m_month, m_monthDay, m_hour, minute, m_second, m_millisecond))
            return false;
        m_minute = minute;
        return true;
    }

    int hour = m_hour + carry;
    if (hour > 23) {
        carry = hour / 24;
        hour = hour % 24;
    } else if (hour < 0) {
        carry = (23 - hour) / 24;
        hour += carry * 24;
        carry = -carry;
        ASSERT(hour >= 0 && hour <= 23);
    } else {
        if (!withinHTMLDateLimits(m_year, m_month, m_monthDay, hour, minute, m_second, m_millisecond))
            return false;
        m_minute = minute;
        m_hour = hour;
        return true;
    }
    if (!addDay(carry))
        return false;
    if (!withinHTMLDateLimits(m_year, m_month, m_monthDay, hour, minute, m_second, m_millisecond))
        return false;
    m_minute = minute;
    m_hour = hour;
    return true;
}

// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#time-zones
// Parses a timezone part, and adjust year, month, monthDay, hour, minute, second, millisecond.
template<typename CharacterType> bool DateComponents::parseTimeZone(StringParsingBuffer<CharacterType>& buffer)
{
    if (skipExactly(buffer, 'Z'))
        return true;

    bool minus;
    if (skipExactly(buffer, '+'))
        minus = false;
    else if (skipExactly(buffer, '-'))
        minus = true;
    else
        return false;

    auto hour = parseIntWithinLimits(buffer, 2, 0, 23);
    if (!hour)
        return false;

    if (!skipExactly(buffer, ':'))
        return false;

    auto minute = parseIntWithinLimits(buffer, 2, 0, 59);
    if (!minute)
        return false;

    if (minus) {
        *hour = -*hour;
        *minute = -*minute;
    }

    // Subtract the timezone offset.
    if (!addMinute(-(*hour * 60 + *minute)))
        return false;
    return true;
}

// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#months
template<typename CharacterType> bool DateComponents::parseMonth(StringParsingBuffer<CharacterType>& buffer)
{
    if (!parseYear(buffer))
        return false;

    if (!skipExactly(buffer, '-'))
        return false;

    auto month = parseIntWithinLimits(buffer, 2, 1, 12);
    if (!month)
        return false;
    --*month;

    if (!withinHTMLDateLimits(m_year, *month))
        return false;

    m_month = *month;
    m_type = DateComponentsType::Month;
    return true;
}

// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#dates
template<typename CharacterType> bool DateComponents::parseDate(StringParsingBuffer<CharacterType>& buffer)
{
    if (!parseMonth(buffer))
        return false;

    if (!skipExactly(buffer, '-'))
        return false;

    auto day = parseIntWithinLimits(buffer, 2, 1, maxDayOfMonth(m_year, m_month));
    if (!day)
        return false;

    if (!withinHTMLDateLimits(m_year, m_month, *day))
        return false;

    m_monthDay = *day;
    m_type = DateComponentsType::Date;
    return true;
}

// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#weeks
template<typename CharacterType> bool DateComponents::parseWeek(StringParsingBuffer<CharacterType>& buffer)
{
    if (!parseYear(buffer))
        return false;

    if (!skipExactly(buffer, '-'))
        return false;
    if (!skipExactly(buffer, 'W'))
        return false;

    auto week = parseIntWithinLimits(buffer, 2, minimumWeekNumber, maxWeekNumberInYear());
    if (!week)
        return false;

    if (m_year == maximumYear() && *week > maximumWeekInMaximumYear)
        return false;

    m_week = *week;
    m_type = DateComponentsType::Week;
    return true;
}

// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#times
template<typename CharacterType> bool DateComponents::parseTime(StringParsingBuffer<CharacterType>& buffer)
{
    auto hour = parseIntWithinLimits(buffer, 2, 0, 23);
    if (!hour)
        return false;

    if (!skipExactly(buffer, ':'))
        return false;

    auto minute = parseIntWithinLimits(buffer, 2, 0, 59);
    if (!minute)
        return false;

    // Optional second part.
    // Do not return with false because the part is optional.
    std::optional<int> second;
    std::optional<int> millisecond;

    auto temporaryBuffer = buffer;
    if (skipExactly(temporaryBuffer, ':')) {
        second = parseIntWithinLimits(temporaryBuffer, 2, 0, 59);
        if (second) {
            // Only after successfully parsing and validating 'second', do we increment the real buffer.
            buffer += temporaryBuffer.position() - buffer.position();

            // Optional fractional second part.
            if (skipExactly(temporaryBuffer, '.')) {
                unsigned digitsLength = countDigits(temporaryBuffer);
                if (digitsLength > 0) {
                    if (digitsLength == 1) {
                        millisecond = parseInt(temporaryBuffer, 1);
                        *millisecond *= 100;
                    } else if (digitsLength == 2) {
                        millisecond = parseInt(temporaryBuffer, 2);
                        *millisecond *= 10;
                    } else if (digitsLength == 3)
                        millisecond = parseInt(temporaryBuffer, 3);
                    else
                        return false;

                    // Due to the countDigits above, the parseInt calls should all be successful.
                    ASSERT(millisecond);

                    // Only after successfully parsing and validating 'millisecond', do we increment the real buffer.
                    buffer += 1 + digitsLength;
                }
            }
        }
    }

    m_hour = *hour;
    m_minute = *minute;
    m_second = second.value_or(0);
    m_millisecond = millisecond.value_or(0);
    m_type = DateComponentsType::Time;
    return true;
}

// Gecko allows both 'T' and a space as datetime-local separator (see https://github.com/whatwg/html/issues/2276).
// WPT tests also expect this behavior.
template<typename CharacterType> static bool LEGACY_NODELETE isDateTimeLocalSeparator(CharacterType c)
{
    return c == 'T' || c == ' ';
}

// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#local-dates-and-times
template<typename CharacterType> bool DateComponents::parseDateTimeLocal(StringParsingBuffer<CharacterType>& buffer)
{
    if (!parseDate(buffer))
        return false;

    if (!skipExactly<isDateTimeLocalSeparator>(buffer))
        return false;

    if (!parseTime(buffer))
        return false;

    if (!withinHTMLDateLimits(m_year, m_month, m_monthDay, m_hour, m_minute, m_second, m_millisecond))
        return false;

    m_type = DateComponentsType::DateTimeLocal;
    return true;
}

static inline double positiveFmod(double value, double divider)
{
    double remainder = fmod(value, divider);
    return remainder < 0 ? remainder + divider : remainder;
}

template<typename F> static std::optional<DateComponents> createFromTimeOffset(double timeOffset, NOESCAPE const F& function)
{
    DateComponents result;
    if (!function(result, timeOffset))
        return std::nullopt;
    return result;
}

std::optional<DateComponents> DateComponents::fromMillisecondsSinceEpochForDate(double ms)
{
    return createFromTimeOffset(ms, [] (auto& date, auto ms) {
        return date.setMillisecondsSinceEpochForDate(ms);
    });
}

std::optional<DateComponents> DateComponents::fromMillisecondsSinceEpochForDateTimeLocal(double ms)
{
    return createFromTimeOffset(ms, [] (auto& date, auto ms) {
        return date.setMillisecondsSinceEpochForDateTimeLocal(ms);
    });
}

std::optional<DateComponents> DateComponents::fromMillisecondsSinceEpochForMonth(double ms)
{
    return createFromTimeOffset(ms, [] (auto& date, auto ms) {
        return date.setMillisecondsSinceEpochForMonth(ms);
    });
}

std::optional<DateComponents> DateComponents::fromMillisecondsSinceEpochForWeek(double ms)
{
    return createFromTimeOffset(ms, [] (auto& date, auto ms) {
        return date.setMillisecondsSinceEpochForWeek(ms);
    });
}

std::optional<DateComponents> DateComponents::fromMillisecondsSinceMidnight(double ms)
{
    return createFromTimeOffset(ms, [] (auto& date, auto ms) {
        return date.setMillisecondsSinceMidnight(ms);
    });
}

std::optional<DateComponents> DateComponents::fromMonthsSinceEpoch(double months)
{
    return createFromTimeOffset(months, [] (auto& date, auto months) {
        return date.setMonthsSinceEpoch(months);
    });
}

void DateComponents::setMillisecondsSinceMidnightInternal(double msInDay)
{
    ASSERT(msInDay >= 0 && msInDay < msPerDay);
    m_millisecond = static_cast<int>(fmod(msInDay, msPerSecond));
    double value = floor(msInDay / msPerSecond);
    m_second = static_cast<int>(fmod(value, secondsPerMinute));
    value = floor(value / secondsPerMinute);
    m_minute = static_cast<int>(fmod(value, minutesPerHour));
    m_hour = static_cast<int>(value / minutesPerHour);
}

bool DateComponents::setMillisecondsSinceEpochForDateInternal(double ms)
{
    m_year = msToYear(ms);
    int yearDay = dayInYear(ms, m_year);
    m_month = monthFromDayInYear(yearDay, isLeapYear(m_year));
    m_monthDay = dayInMonthFromDayInYear(yearDay, isLeapYear(m_year));
    return true;
}

bool DateComponents::setMillisecondsSinceEpochForDate(double ms)
{
    m_type = DateComponentsType::Invalid;
    if (!std::isfinite(ms))
        return false;
    if (!setMillisecondsSinceEpochForDateInternal(round(ms)))
        return false;
    if (!withinHTMLDateLimits(m_year, m_month, m_monthDay))
        return false;
    m_type = DateComponentsType::Date;
    return true;
}

bool DateComponents::setMillisecondsSinceEpochForDateTimeLocal(double ms)
{
    m_type = DateComponentsType::Invalid;
    if (!std::isfinite(ms))
        return false;
    ms = round(ms);
    setMillisecondsSinceMidnightInternal(positiveFmod(ms, msPerDay));
    if (!setMillisecondsSinceEpochForDateInternal(ms))
        return false;
    if (!withinHTMLDateLimits(m_year, m_month, m_monthDay, m_hour, m_minute, m_second, m_millisecond))
        return false;
    m_type = DateComponentsType::DateTimeLocal;
    return true;
}

bool DateComponents::setMillisecondsSinceEpochForMonth(double ms)
{
    m_type = DateComponentsType::Invalid;
    if (!std::isfinite(ms))
        return false;
    if (!setMillisecondsSinceEpochForDateInternal(round(ms)))
        return false;
    if (!withinHTMLDateLimits(m_year, m_month))
        return false;
    m_type = DateComponentsType::Month;
    return true;
}

bool DateComponents::setMillisecondsSinceMidnight(double ms)
{
    m_type = DateComponentsType::Invalid;
    if (!std::isfinite(ms))
        return false;
    setMillisecondsSinceMidnightInternal(positiveFmod(round(ms), msPerDay));
    m_type = DateComponentsType::Time;
    return true;
}

bool DateComponents::setMonthsSinceEpoch(double months)
{
    if (!std::isfinite(months))
        return false;
    months = round(months);
    double doubleMonth = positiveFmod(months, 12);
    double doubleYear = 1970 + (months - doubleMonth) / 12;
    if (doubleYear < minimumYear() || maximumYear() < doubleYear)
        return false;
    int year = static_cast<int>(doubleYear);
    int month = static_cast<int>(doubleMonth);
    if (!withinHTMLDateLimits(year, month))
        return false;
    m_year = year;
    m_month = month;
    m_type = DateComponentsType::Month;
    return true;
}

// Offset from January 1st to Monday of the ISO 8601's first week.
//   ex. If January 1st is Friday, such Monday is 3 days later. Returns 3.
static int LEGACY_NODELETE offsetTo1stWeekStart(int year)
{
    int offsetTo1stWeekStart = 1 - dayOfWeek(year, 0, 1);
    if (offsetTo1stWeekStart <= -4)
        offsetTo1stWeekStart += 7;
    return offsetTo1stWeekStart;
}

bool DateComponents::setMillisecondsSinceEpochForWeek(double ms)
{
    m_type = DateComponentsType::Invalid;
    if (!std::isfinite(ms))
        return false;
    ms = round(ms);

    m_year = msToYear(ms);
    if (m_year < minimumYear() || m_year > maximumYear())
        return false;

    int yearDay = dayInYear(ms, m_year);
    int offset = offsetTo1stWeekStart(m_year);
    if (yearDay < offset) {
        // The day belongs to the last week of the previous year.
        m_year--;
        if (m_year <= minimumYear())
            return false;
        m_week = maxWeekNumberInYear();
    } else {
        m_week = ((yearDay - offset) / 7) + 1;
        if (m_week > maxWeekNumberInYear()) {
            m_year++;
            m_week = 1;
        }
        if (m_year > maximumYear() || (m_year == maximumYear() && m_week > maximumWeekInMaximumYear))
            return false;
    }
    m_type = DateComponentsType::Week;
    return true;
}

double DateComponents::millisecondsSinceEpochForTime() const
{
    ASSERT(m_type == DateComponentsType::Time || m_type == DateComponentsType::DateTimeLocal);
    return ((m_hour * minutesPerHour + m_minute) * secondsPerMinute + m_second) * msPerSecond + m_millisecond;
}

double DateComponents::millisecondsSinceEpoch() const
{
    switch (m_type) {
    case DateComponentsType::Date:
        return dateToDaysFrom1970(m_year, m_month, m_monthDay) * msPerDay;
    case DateComponentsType::DateTimeLocal:
        return dateToDaysFrom1970(m_year, m_month, m_monthDay) * msPerDay + millisecondsSinceEpochForTime();
    case DateComponentsType::Month:
        return dateToDaysFrom1970(m_year, m_month, 1) * msPerDay;
    case DateComponentsType::Time:
        return millisecondsSinceEpochForTime();
    case DateComponentsType::Week:
        return (dateToDaysFrom1970(m_year, 0, 1) + offsetTo1stWeekStart(m_year) + (m_week - 1) * 7) * msPerDay;
    case DateComponentsType::Invalid:
        break;
    }
    ASSERT_NOT_REACHED();
    return invalidMilliseconds();
}

double DateComponents::monthsSinceEpoch() const
{
    ASSERT(m_type == DateComponentsType::Month);
    return (m_year - 1970) * 12 + m_month;
}

String DateComponents::toStringForTime(SecondFormat format) const
{
    ASSERT(m_type == DateComponentsType::DateTimeLocal || m_type == DateComponentsType::Time);
    SecondFormat effectiveFormat = format;
    if (m_millisecond)
        effectiveFormat = SecondFormat::Millisecond;
    else if (format == SecondFormat::None && m_second)
        effectiveFormat = SecondFormat::Second;

    switch (effectiveFormat) {
    default:
        ASSERT_NOT_REACHED();
#if !ASSERT_ENABLED
        [[fallthrough]]; // To None.
#endif
    case SecondFormat::None:
        return makeString(pad('0', 2, m_hour), ':', pad('0', 2, m_minute));
    case SecondFormat::Second:
        return makeString(pad('0', 2, m_hour), ':', pad('0', 2, m_minute), ':', pad('0', 2, m_second));
    case SecondFormat::Millisecond: {
        auto resultWithoutMilliseconds = makeString(pad('0', 2, m_hour), ':', pad('0', 2, m_minute), ':', pad('0', 2, m_second), '.');
        if (!(m_millisecond % 100))
            return makeString(resultWithoutMilliseconds, m_millisecond / 100);
        if (!(m_millisecond % 10))
            return makeString(resultWithoutMilliseconds, pad('0', 2, m_millisecond / 10));
        return makeString(resultWithoutMilliseconds, pad('0', 3, m_millisecond));
    }
    }
}

String DateComponents::toString(SecondFormat format) const
{
    switch (m_type) {
    case DateComponentsType::Date:
        return makeString(pad('0', 4, m_year), '-', pad('0', 2, m_month + 1), '-', pad('0', 2, m_monthDay));
    case DateComponentsType::DateTimeLocal:
        return makeString(pad('0', 4, m_year), '-', pad('0', 2, m_month + 1), '-', pad('0', 2, m_monthDay), 'T', toStringForTime(format));
    case DateComponentsType::Month:
        return makeString(pad('0', 4, m_year), '-', pad('0', 2, m_month + 1));
    case DateComponentsType::Time:
        return toStringForTime(format);
    case DateComponentsType::Week:
        return makeString(pad('0', 4, m_year), "-W"_s, pad('0', 2, m_week));
    case DateComponentsType::Invalid:
        break;
    }
    ASSERT_NOT_REACHED();
    return "(Invalid DateComponents)"_str;
}

} // namespace WebCore
