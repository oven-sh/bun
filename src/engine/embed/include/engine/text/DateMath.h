#pragma once

#include "engine/text/String.h"

#include <cmath>

extern "C" {
double engine_date_current_time();
double engine_date_parse_cookie_date(const WTF::Latin1Character*, size_t length);
bool engine_date_set_time_zone_override(WTF::StringView);
WTF::StringImpl* engine_date_canonical_time_zone(WTF::StringView) RETURNS_NONNULL;
}

namespace WTF {

enum class TimeType : uint8_t { UTCTime,
    LocalTime };

inline constexpr double msPerSecond = 1000;
inline constexpr double maxECMAScriptTime = 8.64e15;

// In whole milliseconds since the epoch.
inline double jsCurrentTime() { return engine_date_current_time(); }

inline double timeClip(double time)
{
    return std::abs(time) > maxECMAScriptTime ? std::numeric_limits<double>::quiet_NaN() : std::trunc(time) + 0.0;
}

// The formats of RFC 822, RFC 850 and RFC 1123. NaN if it is none of them.
inline double parseDate(std::span<const Latin1Character> string) { return engine_date_parse_cookie_date(string.data(), string.size()); }

// The empty name stands for the zone of the host. Returns false if there is no such zone.
inline bool setTimeZoneOverride(StringView name) { return engine_date_set_time_zone_override(name); }
// Empty if there is no such zone.
inline String canonicalTimeZone(StringView name) { return adoptRef(*engine_date_canonical_time_zone(name)); }

// `Option<bun_engine_date::DateFields>`.
class PlainGregorianDateTime {
public:
    constexpr PlainGregorianDateTime() = default;
    explicit constexpr PlainGregorianDateTime(uint64_t bits)
        : m_bits(bits)
    {
    }

    explicit operator bool() const { return m_bits; }

    int32_t year() const { return static_cast<int64_t>(m_bits) >> 44; }
    // From zero.
    int32_t month() const { return field<40, 4>(); }
    int32_t monthDay() const { return field<35, 5>(); }
    int32_t weekDay() const { return field<32, 3>(); }
    int32_t hour() const { return field<27, 5>(); }
    int32_t minute() const { return field<21, 6>(); }
    int32_t second() const { return field<15, 6>(); }

private:
    template<unsigned shift, unsigned width> int32_t field() const { return m_bits >> shift & ((1 << width) - 1); }

    uint64_t m_bits { 0 };
};

}

using WTF::jsCurrentTime;
using WTF::msPerSecond;
using WTF::parseDate;
using WTF::PlainGregorianDateTime;
using WTF::timeClip;
using WTF::TimeType;
