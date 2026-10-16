/*
 * Copyright (C) 2012-2015 Google Inc. All rights reserved.
 * Copyright (C) 2022 Apple Inc. All rights reserved.
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
#include "Decimal.h"

#include <algorithm>
#include <float.h>

#include <wtf/Assertions.h>
#include <wtf/Int128.h>
#include <wtf/MathExtras.h>
#include <wtf/Noncopyable.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/StringBuilder.h>

namespace WebCore {

namespace DecimalPrivate {

// This class handles Decimal special values.
class SpecialValueHandler {
    WTF_MAKE_NONCOPYABLE(SpecialValueHandler);
public:
    enum HandleResult {
        BothFinite,
        BothInfinity,
        EitherNaN,
        LHSIsInfinity,
        RHSIsInfinity,
    };

    SpecialValueHandler(const Decimal& lhs, const Decimal& rhs);
    HandleResult handle();
    Decimal value() const;

private:
    enum Result {
        ResultIsLHS,
        ResultIsRHS,
        ResultIsUnknown,
    };

    const Decimal& m_lhs;
    const Decimal& m_rhs;
    Result m_result;
};

SpecialValueHandler::SpecialValueHandler(const Decimal& lhs, const Decimal& rhs)
    : m_lhs(lhs), m_rhs(rhs), m_result(ResultIsUnknown)
{
}

SpecialValueHandler::HandleResult LEGACY_NODELETE SpecialValueHandler::handle()
{
    if (m_lhs.isFinite() && m_rhs.isFinite())
        return BothFinite;

    const Decimal::EncodedData::FormatClass lhsClass = m_lhs.value().formatClass();
    const Decimal::EncodedData::FormatClass rhsClass = m_rhs.value().formatClass();
    if (lhsClass == Decimal::EncodedData::ClassNaN) {
        m_result = ResultIsLHS;
        return EitherNaN;
     }

    if (rhsClass == Decimal::EncodedData::ClassNaN) {
        m_result = ResultIsRHS;
        return EitherNaN;
     }

    if (lhsClass == Decimal::EncodedData::ClassInfinity)
        return rhsClass == Decimal::EncodedData::ClassInfinity ? BothInfinity : LHSIsInfinity;

    if (rhsClass == Decimal::EncodedData::ClassInfinity)
        return RHSIsInfinity;

    ASSERT_NOT_REACHED();
    return BothFinite;
}

Decimal SpecialValueHandler::value() const
{
    switch (m_result) {
    case ResultIsLHS:
        return m_lhs;
    case ResultIsRHS:
        return m_rhs;
    case ResultIsUnknown:
    default:
        ASSERT_NOT_REACHED();
        return m_lhs;
    }
}

static int LEGACY_NODELETE countDigits(uint64_t x)
{
    int numberOfDigits = 0;
    for (uint64_t powerOfTen = 1; x >= powerOfTen; powerOfTen *= 10) {
        ++numberOfDigits;
        if (powerOfTen >= std::numeric_limits<uint64_t>::max() / 10)
            break;
    }
    return numberOfDigits;
}

static uint64_t LEGACY_NODELETE scaleDown(uint64_t x, int n)
{
    ASSERT(n >= 0);
    while (n > 0 && x) {
        x /= 10;
        --n;
    }
    return x;
}

static uint64_t LEGACY_NODELETE scaleUp(uint64_t x, int n)
{
    ASSERT(n >= 0);
    ASSERT(n < Decimal::Precision);

    uint64_t y = 1;
    uint64_t z = 10;
    for (;;) {
        if (n & 1)
            y = y * z;

        n >>= 1;
        if (!n)
            return x * y;

        z = z * z;
    }
}

} // namespace DecimalPrivate

using namespace DecimalPrivate;

WTF_MAKE_TZONE_ALLOCATED_IMPL(Decimal);

Decimal& Decimal::operator+=(const Decimal& other)
{
    m_data = (*this + other).m_data;
    return *this;
}

Decimal& Decimal::operator-=(const Decimal& other)
{
    m_data = (*this - other).m_data;
    return *this;
}

Decimal& Decimal::operator*=(const Decimal& other)
{
    m_data = (*this * other).m_data;
    return *this;
}

Decimal& Decimal::operator/=(const Decimal& other)
{
    m_data = (*this / other).m_data;
    return *this;
}

Decimal Decimal::operator-() const
{
    if (isNaN())
        return *this;

    Decimal result(*this);
    result.m_data.setSign(invertSign(m_data.sign()));
    return result;
}

Decimal Decimal::operator+(const Decimal& rhs) const
{
    const Decimal& lhs = *this;
    const Sign lhsSign = lhs.sign();
    const Sign rhsSign = rhs.sign();

    SpecialValueHandler handler(lhs, rhs);
    switch (handler.handle()) {
    case SpecialValueHandler::BothFinite:
        break;

    case SpecialValueHandler::BothInfinity:
        return lhsSign == rhsSign ? lhs : nan();

    case SpecialValueHandler::EitherNaN:
        return handler.value();

    case SpecialValueHandler::LHSIsInfinity:
        return lhs;

    case SpecialValueHandler::RHSIsInfinity:
        return rhs;
    }

    const AlignedOperands alignedOperands = alignOperands(lhs, rhs);

    const uint64_t result = lhsSign == rhsSign
        ? alignedOperands.lhsCoefficient + alignedOperands.rhsCoefficient
        : alignedOperands.lhsCoefficient - alignedOperands.rhsCoefficient;

    if (lhsSign == Negative && rhsSign == Positive && !result)
        return Decimal(Positive, alignedOperands.exponent, 0);

    return static_cast<int64_t>(result) >= 0
        ? Decimal(lhsSign, alignedOperands.exponent, result)
        : Decimal(invertSign(lhsSign), alignedOperands.exponent, -static_cast<int64_t>(result));
}

Decimal Decimal::operator-(const Decimal& rhs) const
{
    const Decimal& lhs = *this;
    const Sign lhsSign = lhs.sign();
    const Sign rhsSign = rhs.sign();

    SpecialValueHandler handler(lhs, rhs);
    switch (handler.handle()) {
    case SpecialValueHandler::BothFinite:
        break;

    case SpecialValueHandler::BothInfinity:
        return lhsSign == rhsSign ? nan() : lhs;

    case SpecialValueHandler::EitherNaN:
        return handler.value();

    case SpecialValueHandler::LHSIsInfinity:
        return lhs;

    case SpecialValueHandler::RHSIsInfinity:
        return infinity(invertSign(rhsSign));
    }

    const AlignedOperands alignedOperands = alignOperands(lhs, rhs);

    const uint64_t result = lhsSign == rhsSign
        ? alignedOperands.lhsCoefficient - alignedOperands.rhsCoefficient
        : alignedOperands.lhsCoefficient + alignedOperands.rhsCoefficient;

    if (lhsSign == Negative && rhsSign == Negative && !result)
        return Decimal(Positive, alignedOperands.exponent, 0);

    return static_cast<int64_t>(result) >= 0
        ? Decimal(lhsSign, alignedOperands.exponent, result)
        : Decimal(invertSign(lhsSign), alignedOperands.exponent, -static_cast<int64_t>(result));
}

Decimal Decimal::operator*(const Decimal& rhs) const
{
    const Decimal& lhs = *this;
    const Sign lhsSign = lhs.sign();
    const Sign rhsSign = rhs.sign();
    const Sign resultSign = lhsSign == rhsSign ? Positive : Negative;

    SpecialValueHandler handler(lhs, rhs);
    switch (handler.handle()) {
    case SpecialValueHandler::BothFinite: {
        const uint64_t lhsCoefficient = lhs.m_data.coefficient();
        const uint64_t rhsCoefficient = rhs.m_data.coefficient();
        int resultExponent = lhs.exponent() + rhs.exponent();
        UInt128 work = static_cast<UInt128>(lhsCoefficient) * static_cast<UInt128>(rhsCoefficient);
        while (work >> 64) {
            work /= 10;
            ++resultExponent;
        }
        return Decimal(resultSign, resultExponent, static_cast<uint64_t>(work));
    }

    case SpecialValueHandler::BothInfinity:
        return infinity(resultSign);

    case SpecialValueHandler::EitherNaN:
        return handler.value();

    case SpecialValueHandler::LHSIsInfinity:
        return rhs.isZero() ? nan() : infinity(resultSign);

    case SpecialValueHandler::RHSIsInfinity:
        return lhs.isZero() ? nan() : infinity(resultSign);
    }

    ASSERT_NOT_REACHED();
    return nan();
}

Decimal Decimal::operator/(const Decimal& rhs) const
{
    const Decimal& lhs = *this;
    const Sign lhsSign = lhs.sign();
    const Sign rhsSign = rhs.sign();
    const Sign resultSign = lhsSign == rhsSign ? Positive : Negative;

    SpecialValueHandler handler(lhs, rhs);
    switch (handler.handle()) {
    case SpecialValueHandler::BothFinite:
        break;

    case SpecialValueHandler::BothInfinity:
        return nan();

    case SpecialValueHandler::EitherNaN:
        return handler.value();

    case SpecialValueHandler::LHSIsInfinity:
        return infinity(resultSign);

    case SpecialValueHandler::RHSIsInfinity:
        return zero(resultSign);
    }

    ASSERT(lhs.isFinite());
    ASSERT(rhs.isFinite());

    if (rhs.isZero())
        return lhs.isZero() ? nan() : infinity(resultSign);

    int resultExponent = lhs.exponent() - rhs.exponent();

    if (lhs.isZero())
        return Decimal(resultSign, resultExponent, 0);

    uint64_t remainder = lhs.m_data.coefficient();
    const uint64_t divisor = rhs.m_data.coefficient();
    uint64_t result = 0;
    for (;;) {
        while (remainder < divisor && result < MaxCoefficient / 10) {
            remainder *= 10;
            result *= 10;
            --resultExponent;
        }
        if (remainder < divisor)
            break;
        uint64_t quotient = remainder / divisor;
        if (result > MaxCoefficient - quotient)
            break;
        result += quotient;
        remainder %= divisor;
        if (!remainder)
            break;
    }

    if (remainder > divisor / 2)
        ++result;

    return Decimal(resultSign, resultExponent, result);
}

Decimal Decimal::abs() const
{
    Decimal result(*this);
    result.m_data.setSign(Positive);
    return result;
}

Decimal::AlignedOperands Decimal::alignOperands(const Decimal& lhs, const Decimal& rhs)
{
    ASSERT(lhs.isFinite());
    ASSERT(rhs.isFinite());

    const int lhsExponent = lhs.exponent();
    const int rhsExponent = rhs.exponent();
    int exponent = std::min(lhsExponent, rhsExponent);
    uint64_t lhsCoefficient = lhs.m_data.coefficient();
    uint64_t rhsCoefficient = rhs.m_data.coefficient();

    if (lhsExponent > rhsExponent) {
        const int numberOfLHSDigits = countDigits(lhsCoefficient);
        if (numberOfLHSDigits) {
            const int lhsShiftAmount = lhsExponent - rhsExponent;
            const int overflow = numberOfLHSDigits + lhsShiftAmount - Precision;
            if (overflow <= 0)
                lhsCoefficient = scaleUp(lhsCoefficient, lhsShiftAmount);
            else {
                lhsCoefficient = scaleUp(lhsCoefficient, lhsShiftAmount - overflow);
                rhsCoefficient = scaleDown(rhsCoefficient, overflow);
                exponent += overflow;
            }
        }

    } else if (lhsExponent < rhsExponent) {
        const int numberOfRHSDigits = countDigits(rhsCoefficient);
        if (numberOfRHSDigits) {
            const int rhsShiftAmount = rhsExponent - lhsExponent;
            const int overflow = numberOfRHSDigits + rhsShiftAmount - Precision;
            if (overflow <= 0)
                rhsCoefficient = scaleUp(rhsCoefficient, rhsShiftAmount);
            else {
                rhsCoefficient = scaleUp(rhsCoefficient, rhsShiftAmount - overflow);
                lhsCoefficient = scaleDown(lhsCoefficient, overflow);
                exponent += overflow;
            }
        }
    }

    AlignedOperands alignedOperands;
    alignedOperands.exponent = exponent;
    alignedOperands.lhsCoefficient = lhsCoefficient;
    alignedOperands.rhsCoefficient = rhsCoefficient;
    return alignedOperands;
}

static bool LEGACY_NODELETE isMultiplePowersOfTen(uint64_t coefficient, int n)
{
    return !coefficient || !(coefficient % scaleUp(1, n));
}

// Round toward positive infinity.
Decimal Decimal::ceil() const
{
    if (isSpecial())
        return *this;

    if (exponent() >= 0)
        return *this;

    uint64_t result = m_data.coefficient();
    const int numberOfDigits = countDigits(result);
    const int numberOfDropDigits = -exponent();
    if (numberOfDigits <= numberOfDropDigits)
        return isPositive() ? Decimal(1) : zero(Positive);

    result = scaleDown(result, numberOfDropDigits);
    if (isPositive() && !isMultiplePowersOfTen(result, numberOfDropDigits))
        ++result;
    return Decimal(sign(), 0, result);
}

Decimal Decimal::compareTo(const Decimal& rhs) const
{
    const Decimal result(*this - rhs);
    switch (result.m_data.formatClass()) {
    case EncodedData::ClassInfinity:
        return result.isNegative() ? Decimal(-1) : Decimal(1);

    case EncodedData::ClassNaN:
    case EncodedData::ClassNormal:
        return result;

    case EncodedData::ClassZero:
        return zero(Positive);

    default:
        ASSERT_NOT_REACHED();
        return nan();
    }
}

// Round toward negative infinity.
Decimal Decimal::floor() const
{
    if (isSpecial())
        return *this;

    if (exponent() >= 0)
        return *this;

    uint64_t result = m_data.coefficient();
    const int numberOfDigits = countDigits(result);
    const int numberOfDropDigits = -exponent();
    if (numberOfDigits < numberOfDropDigits)
        return isPositive() ? zero(Positive) : Decimal(-1);

    result = scaleDown(result, numberOfDropDigits);
    if (isNegative() && !isMultiplePowersOfTen(result, numberOfDropDigits))
        ++result;
    return Decimal(sign(), 0, result);
}

Decimal Decimal::fromDouble(double doubleValue)
{
    if (std::isfinite(doubleValue)) {
        NumberToStringBuffer buffer;
        return fromString(StringView { numberToStringAndSize(doubleValue, buffer) });
    }

    if (std::isinf(doubleValue))
        return infinity(doubleValue < 0 ? Negative : Positive);

    return nan();
}

Decimal Decimal::fromString(StringView str)
{
    int exponent = 0;
    Sign exponentSign = Positive;
    int numberOfDigits = 0;
    int numberOfDigitsAfterDot = 0;
    int numberOfExtraDigits = 0;
    Sign sign = Positive;

    enum {
        StateDigit,
        StateDot,
        StateDotDigit,
        StateE,
        StateEDigit,
        StateESign,
        StateSign,
        StateStart,
        StateZero,
    } state = StateStart;

#define HandleCharAndBreak(expected, nextState) \
    if (ch == expected) { \
        state = nextState; \
        break; \
    }

#define HandleTwoCharsAndBreak(expected1, expected2, nextState) \
    if (ch == expected1 || ch == expected2) { \
        state = nextState; \
        break; \
    }

    uint64_t accumulator = 0;
    for (unsigned index = 0; index < str.length(); ++index) {
        const int ch = str[index];
        switch (state) {
        case StateDigit:
            if (isASCIIDigit(ch)) {
                if (numberOfDigits < Precision) {
                    ++numberOfDigits;
                    accumulator *= 10;
                    accumulator += ch - '0';
                } else
                    ++numberOfExtraDigits;
                break;
            }

            HandleCharAndBreak('.', StateDot);
            HandleTwoCharsAndBreak('E', 'e', StateE);
            return nan();

        case StateDot:
        case StateDotDigit:
            if (isASCIIDigit(ch)) {
                if (numberOfDigits < Precision) {
                    ++numberOfDigits;
                    ++numberOfDigitsAfterDot;
                    accumulator *= 10;
                    accumulator += ch - '0';
                }
                // FIXME: <http://webkit.org/b/127667> Decimal::fromString's EBNF documentation does not match implementation.
                state = StateDotDigit;
                break;
            }

            HandleTwoCharsAndBreak('E', 'e', StateE);
            return nan();

        case StateE:
            if (ch == '+') {
                exponentSign = Positive;
                state = StateESign;
                break;
            }

            if (ch == '-') {
                exponentSign = Negative;
                state = StateESign;
                break;
            }

            if (isASCIIDigit(ch)) {
                exponent = ch - '0';
                state = StateEDigit;
                break;
            }

            return nan();

        case StateEDigit:
            if (isASCIIDigit(ch)) {
                exponent *= 10;
                exponent += ch - '0';
                if (exponent > ExponentMax + Precision) {
                    if (accumulator)
                        return exponentSign == Negative ? zero(Positive) : infinity(sign);
                    return zero(sign);
                }
                state = StateEDigit;
                break;
            }

            return nan();

        case StateESign:
            if (isASCIIDigit(ch)) {
                exponent = ch - '0';
                state = StateEDigit;
                break;
            }

            return nan();

        case StateSign:
            if (ch >= '1' && ch <= '9') {
                accumulator = ch - '0';
                numberOfDigits = 1;
                state = StateDigit;
                break;
            }

            HandleCharAndBreak('0', StateZero);
            HandleCharAndBreak('.', StateDot);
            return nan();

        case StateStart:
            if (ch >= '1' && ch <= '9') {
                accumulator = ch - '0';
                numberOfDigits = 1;
                state = StateDigit;
                break;
            }

            if (ch == '-') {
                sign = Negative;
                state = StateSign;
                break;
            }

            if (ch == '+') {
                sign = Positive;
                state = StateSign;
                break;
            }

            HandleCharAndBreak('0', StateZero);
            HandleCharAndBreak('.', StateDot);
            return nan();

        case StateZero:
            if (ch == '0')
                break;

            if (ch >= '1' && ch <= '9') {
                accumulator = ch - '0';
                numberOfDigits = 1;
                state = StateDigit;
                break;
            }

            HandleCharAndBreak('.', StateDot);
            HandleTwoCharsAndBreak('E', 'e', StateE);
            return nan();

        default:
            ASSERT_NOT_REACHED();
            return nan();
        }
    }

    if (state == StateZero)
        return zero(sign);

    if (state == StateDigit || state == StateDot || state == StateDotDigit || state == StateEDigit) {
        int resultExponent = exponent * (exponentSign == Negative ? -1 : 1) - numberOfDigitsAfterDot + numberOfExtraDigits;
        if (resultExponent < ExponentMin)
            return zero(Positive);

        const int overflow = resultExponent - ExponentMax + 1;
        if (overflow > 0) {
            if (overflow + numberOfDigits - numberOfDigitsAfterDot > Precision)
                return infinity(sign);
            accumulator = scaleUp(accumulator, overflow);
            resultExponent -= overflow;
        }

        return Decimal(sign, resultExponent, accumulator);
    }

    return nan();
}

Decimal Decimal::remainder(const Decimal& rhs) const
{
    const Decimal quotient = *this / rhs;
    return quotient.isSpecial() ? quotient : *this - (quotient.isNegative() ? quotient.ceil() : quotient.floor()) * rhs;
}

Decimal Decimal::round() const
{
    if (isSpecial())
        return *this;

    if (exponent() >= 0)
        return *this;

    uint64_t result = m_data.coefficient();
    const int numberOfDigits = countDigits(result);
    const int numberOfDropDigits = -exponent();
    if (numberOfDigits < numberOfDropDigits)
        return zero(Positive);

    result = scaleDown(result, numberOfDropDigits - 1);
    if (result % 10 >= 5)
        result += 10;
    result /= 10;
    return Decimal(sign(), 0, result);
}

double Decimal::toDouble() const
{
    if (isFinite()) {
        bool valid;
        const double doubleValue = toString().toDouble(&valid);
        return valid ? doubleValue : std::numeric_limits<double>::quiet_NaN();
    }

    if (isInfinity())
        return isNegative() ? -std::numeric_limits<double>::infinity() : std::numeric_limits<double>::infinity();

    return std::numeric_limits<double>::quiet_NaN();
}

String Decimal::toString() const
{
    switch (m_data.formatClass()) {
    case EncodedData::ClassInfinity:
        return sign() ? "-Infinity"_s : "Infinity"_s;

    case EncodedData::ClassNaN:
        return "NaN"_s;

    case EncodedData::ClassNormal:
    case EncodedData::ClassZero:
        break;

    default:
        ASSERT_NOT_REACHED();
        return emptyString();
    }

    StringBuilder builder;
    if (sign())
        builder.append('-');

    int originalExponent = exponent();
    uint64_t coefficient = m_data.coefficient();

    if (originalExponent < 0) {
        const int maxDigits = DBL_DIG;
        uint64_t lastDigit = 0;
        while (countDigits(coefficient) > maxDigits) {
            lastDigit = coefficient % 10;
            coefficient /= 10;
            ++originalExponent;
        }

        if (lastDigit >= 5)
            ++coefficient;

        while (originalExponent < 0 && coefficient && !(coefficient % 10)) {
            coefficient /= 10;
            ++originalExponent;
        }
    }

    const String digits = String::number(coefficient);
    int coefficientLength = static_cast<int>(digits.length());
    const int adjustedExponent = originalExponent + coefficientLength - 1;
    if (originalExponent <= 0 && adjustedExponent >= -6) {
        if (!originalExponent) {
            builder.append(digits);
            return builder.toString();
        }

        if (adjustedExponent >= 0) {
            for (int i = 0; i < coefficientLength; ++i) {
                builder.append(digits[i]);
                if (i == adjustedExponent)
                    builder.append('.');
            }
            return builder.toString();
        }

        builder.append("0."_s);
        for (int i = adjustedExponent + 1; i < 0; ++i)
            builder.append('0');

        builder.append(digits);
    } else {
        builder.append(digits[0]);
        while (coefficientLength >= 2 && digits[coefficientLength - 1] == '0')
            --coefficientLength;
        if (coefficientLength >= 2) {
            builder.append('.');
            for (int i = 1; i < coefficientLength; ++i)
                builder.append(digits[i]);
        }

        if (adjustedExponent)
            builder.append(adjustedExponent < 0 ? "e"_s : "e+"_s, adjustedExponent);
    }
    return builder.toString();
}

} // namespace WebCore
