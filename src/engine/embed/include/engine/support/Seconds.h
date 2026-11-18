#pragma once

#include "engine/support/MathExtras.h"

#include <compare>

namespace WTF {

class Seconds final {
public:
    constexpr Seconds() = default;
    explicit constexpr Seconds(double value)
        : m_value(value)
    {
    }

    static constexpr Seconds fromMilliseconds(double milliseconds) { return Seconds(milliseconds / 1000); }
    static constexpr Seconds fromMicroseconds(double microseconds) { return fromMilliseconds(microseconds / 1000); }
    static constexpr Seconds infinity() { return Seconds(std::numeric_limits<double>::infinity()); }

    constexpr double value() const { return m_value; }
    constexpr double seconds() const { return m_value; }
    constexpr double milliseconds() const { return seconds() * 1000; }
    constexpr double microseconds() const { return milliseconds() * 1000; }
    template<std::integral T> constexpr T microsecondsAs() const { return clampTo<T>(microseconds()); }

    constexpr Seconds operator+(Seconds other) const { return Seconds(m_value + other.m_value); }
    constexpr Seconds operator-(Seconds other) const { return Seconds(m_value - other.m_value); }

    friend constexpr auto operator<=>(Seconds, Seconds) = default;

private:
    double m_value { 0 };
};

constexpr Seconds operator""_ms(unsigned long long milliseconds)
{
    return Seconds::fromMilliseconds(milliseconds);
}

}

using WTF::Seconds;
using WTF::operator""_ms;
