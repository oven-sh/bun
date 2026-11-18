#pragma once

#include "engine/support/Seconds.h"

extern "C" double Support__monotonicTime();
extern "C" double Support__wallTime();

namespace WTF {

namespace Detail {

template<typename Time>
class TimePoint {
public:
    static constexpr Time fromRawSeconds(double value)
    {
        Time result;
        result.m_value = value;
        return result;
    }

    constexpr Seconds secondsSinceEpoch() const { return Seconds(m_value); }
    explicit constexpr operator bool() const { return m_value != 0; }

    constexpr Time operator+(Seconds duration) const { return fromRawSeconds(m_value + duration.value()); }
    constexpr Time operator-(Seconds duration) const { return fromRawSeconds(m_value - duration.value()); }
    constexpr Seconds operator-(Time other) const { return Seconds(m_value - other.m_value); }

    friend constexpr auto operator<=>(TimePoint, TimePoint) = default;

    // The same moment on another clock.
    template<typename OtherTime>
    OtherTime approximate() const
    {
        if (std::isinf(m_value))
            return OtherTime::fromRawSeconds(m_value);
        Seconds fromNow = *this - Time::now();
        return OtherTime::now() + fromNow;
    }

private:
    double m_value { 0 };
};

}

class MonotonicTime final : public Detail::TimePoint<MonotonicTime> {
public:
    static MonotonicTime now() { return fromRawSeconds(Support__monotonicTime()); }
};

class WallTime final : public Detail::TimePoint<WallTime> {
public:
    static WallTime now() { return fromRawSeconds(Support__wallTime()); }
};

}

using WTF::MonotonicTime;
using WTF::WallTime;
