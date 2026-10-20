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

#pragma once

#include <limits>
#include <optional>
#include <unicode/utypes.h>
#include <wtf/Forward.h>

namespace WebCore {

enum class SecondFormat : uint8_t {
    None, // Suppress the second part and the millisecond part if they are 0.
    Second, // Always show the second part, and suppress the millisecond part if it is 0.
    Millisecond // Always show the second part and the millisecond part.
};

enum class DateComponentsType : uint8_t {
    Invalid,
    Date,
    DateTimeLocal,
    Month,
    Time,
    Week,
};

// A DateComponents instance represents one of the following date and time combinations:
// * Month type: year-month
// * Date type: year-month-day
// * Week type: year-week
// * Time type: hour-minute-second-millisecond
// * DateTime or DateTimeLocal type: year-month-day hour-minute-second-millisecond
class DateComponents {
public:
    DateComponents()
        : m_millisecond(0)
        , m_second(0)
        , m_minute(0)
        , m_hour(0)
        , m_monthDay(0)
        , m_month(0)
        , m_year(0)
        , m_week(0)
        , m_type(DateComponentsType::Invalid)
    {
    }

    int millisecond() const { return m_millisecond; }
    int second() const { return m_second; }
    int minute() const { return m_minute; }
    int hour() const { return m_hour; }
    int monthDay() const { return m_monthDay; }
    int month() const { return m_month; }
    int fullYear() const { return m_year; }
    int week() const { return m_week; }
    DateComponentsType type() const { return m_type; }

    // Returns an ISO 8601 representation for this instance.
    // The format argument is valid for DateTimeLocal and Time types.
    String toString(SecondFormat = SecondFormat::None) const;

    // Sets year and month.
    static std::optional<DateComponents> fromParsingMonth(StringView);
    // Sets year, month and monthDay.
    static std::optional<DateComponents> fromParsingDate(StringView);
    // Sets year and week.
    static std::optional<DateComponents> fromParsingWeek(StringView);
    // Sets hour, minute, second and millisecond.
    static std::optional<DateComponents> fromParsingTime(StringView);
    // Sets year, month, monthDay, hour, minute, second and millisecond.
    static std::optional<DateComponents> fromParsingDateTimeLocal(StringView);


    // For Date type. Updates m_year, m_month and m_monthDay.
    static std::optional<DateComponents> fromMillisecondsSinceEpochForDate(double ms);
    // For DateTimeLocal type. Updates m_year, m_month, m_monthDay, m_hour, m_minute, m_second and m_millisecond.
    static std::optional<DateComponents> fromMillisecondsSinceEpochForDateTimeLocal(double ms);
    // For Month type. Updates m_year and m_month.
    static std::optional<DateComponents> fromMillisecondsSinceEpochForMonth(double ms);
    // For Week type. Updates m_year and m_week.
    static std::optional<DateComponents> fromMillisecondsSinceEpochForWeek(double ms);

    // For Time type. Updates m_hour, m_minute, m_second and m_millisecond.
    static std::optional<DateComponents> fromMillisecondsSinceMidnight(double ms);

    // Another initializer for Month type. Updates m_year and m_month.
    static std::optional<DateComponents> fromMonthsSinceEpoch(double months);

    // Returns the number of milliseconds from 1970-01-01 00:00:00 UTC.
    // For a DateComponents initialized with LEGACY_NODELETE parseDateTimeLocal(),
    // millisecondsSinceEpoch() returns a value for UTC timezone.
    double millisecondsSinceEpoch() const;

    // Returns the number of months from 1970-01.
    // Do not call this for types other than Month.
    double LEGACY_NODELETE monthsSinceEpoch() const;

    static inline double invalidMilliseconds() { return std::numeric_limits<double>::quiet_NaN(); }

    // Minimum and maxmimum limits for setMillisecondsSince*(),
    // setMonthsSinceEpoch(), millisecondsSinceEpoch(), and monthsSinceEpoch().
    static constexpr inline double minimumDate() { return -62135596800000.0; } // 0001-01-01T00:00Z
    static constexpr inline double minimumDateTime() { return -62135596800000.0; } // ditto.
    static constexpr inline double minimumMonth() { return (1 - 1970) * 12.0 + 1 - 1; } // 0001-01
    static constexpr inline double minimumTime() { return 0; } // 00:00:00.000
    static constexpr inline double minimumWeek() { return -62135596800000.0; } // 0001-01-01, the first Monday of 0001.
    static constexpr inline double maximumDate() { return 8640000000000000.0; } // 275760-09-13T00:00Z
    static constexpr inline double maximumDateTime() { return 8640000000000000.0; } // ditto.
    static constexpr inline double maximumMonth() { return (275760 - 1970) * 12.0 + 9 - 1; } // 275760-09
    static constexpr inline double maximumTime() { return 86399999; } // 23:59:59.999
    static constexpr inline double maximumWeek() { return 8639999568000000.0; } // 275760-09-08, the Monday of the week including 275760-09-13.

    // HTML uses ISO-8601 format with year >= 1. Gregorian calendar started in
    // 1582. However, we need to support 0001-01-01 in Gregorian calendar rule.
    static constexpr inline int minimumYear() { return 1; }

    // Date in ECMAScript can't represent dates later than 275760-09-13T00:00Z.
    // So, we have the same upper limit in HTML5 date/time types.
    static constexpr inline int maximumYear() { return 275760; }

private:
    template<typename CharacterType> bool LEGACY_NODELETE parseYear(StringParsingBuffer<CharacterType>&);
    template<typename CharacterType> bool parseTimeZone(StringParsingBuffer<CharacterType>&);
    template<typename CharacterType> bool LEGACY_NODELETE parseMonth(StringParsingBuffer<CharacterType>&);
    template<typename CharacterType> bool LEGACY_NODELETE parseDate(StringParsingBuffer<CharacterType>&);
    template<typename CharacterType> bool LEGACY_NODELETE parseWeek(StringParsingBuffer<CharacterType>&);
    template<typename CharacterType> bool LEGACY_NODELETE parseTime(StringParsingBuffer<CharacterType>&);
    template<typename CharacterType> bool parseDateTimeLocal(StringParsingBuffer<CharacterType>&);

    // The following setMillisecondsSinceEpochFor*() functions take
    // the number of milliseconds since 1970-01-01 00:00:00.000 UTC as
    // the argument, and update all fields for the corresponding
    // DateComponents type. The functions return true if it succeeds, and
    // false if they fail.
    bool setMillisecondsSinceEpochForDate(double);
    bool setMillisecondsSinceEpochForDateTimeLocal(double);
    bool setMillisecondsSinceEpochForMonth(double);
    bool setMillisecondsSinceEpochForWeek(double);
    bool setMillisecondsSinceMidnight(double);
    bool setMonthsSinceEpoch(double);
    bool setMillisecondsSinceEpochForDateInternal(double);
    void setMillisecondsSinceMidnightInternal(double);

    // Returns the maximum week number in this DateComponents's year.
    // The result is either of 52 and 53.
    int LEGACY_NODELETE maxWeekNumberInYear() const;

    bool LEGACY_NODELETE addDay(int);
    bool LEGACY_NODELETE addMinute(int);

    // Helper for millisecondsSinceEpoch().
    double LEGACY_NODELETE millisecondsSinceEpochForTime() const;

    // Helper for toString().
    String toStringForTime(SecondFormat) const;

    // m_weekDay values
    enum {
        Sunday = 0,
        Monday,
        Tuesday,
        Wednesday,
        Thursday,
        Friday,
        Saturday,
    };

    int m_millisecond; // 0 - 999
    int m_second;
    int m_minute;
    int m_hour;
    int m_monthDay; // 1 - 31
    int m_month; // 0:January - 11:December
    int m_year; //  1582 -
    int m_week; // 1 - 53

    DateComponentsType m_type;
};

} // namespace WebCore
