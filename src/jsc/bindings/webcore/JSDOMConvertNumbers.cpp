/*
 *  Copyright (C) 1999-2001 Harri Porten (porten@kde.org)
 *  Copyright (C) 2004-2011, 2013, 2016 Apple Inc. All rights reserved.
 *  Copyright (C) 2007 Samuel Weinig <sam@webkit.org>
 *  Copyright (C) 2013 Michael Pruett <michael@68k.org>
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Lesser General Public
 *  License as published by the Free Software Foundation; either
 *  version 2 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Lesser General Public License for more details.
 *
 *  You should have received a copy of the GNU Lesser General Public
 *  License along with this library; if not, write to the Free Software
 *  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 */

#include "config.h"
#include "JSDOMConvertNumbers.h"

#include "JSDOMExceptionHandling.h"
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <wtf/MathExtras.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/WTFString.h>

namespace WebCore {
using namespace JSC;

enum class IntegerConversionConfiguration { Normal,
    EnforceRange,
    Clamp };

static const int32_t kMaxInt32 = 0x7fffffff;
static const int32_t kMinInt32 = -kMaxInt32 - 1;
static const uint32_t kMaxUInt32 = 0xffffffffU;
static const int64_t kJSMaxInteger = 0x20000000000000LL - 1; // 2^53 - 1, largest integer exactly representable in ECMAScript.

static String rangeErrorString(double value, double min, double max)
{
    return makeString("Value "_s, value, " is outside the range ["_s, min, ", "_s, max, ']');
}

template<typename IDL>
static ConversionResult<IDL> enforceRange(JSGlobalObject& lexicalGlobalObject, double x, double minimum, double maximum)
{
    using T = typename IDL::ImplementationType;

    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (std::isnan(x) || std::isinf(x)) {
        throwTypeError(&lexicalGlobalObject, scope, rangeErrorString(x, minimum, maximum));
        return ConversionResult<IDL>::exception();
    }
    x = trunc(x);
    if (x < minimum || x > maximum) {
        throwTypeError(&lexicalGlobalObject, scope, rangeErrorString(x, minimum, maximum));
        return ConversionResult<IDL>::exception();
    }
    return static_cast<T>(x);
}

double enforceRange(JSGlobalObject& lexicalGlobalObject, double x, double minimum, double maximum)
{
    auto scope = DECLARE_THROW_SCOPE(lexicalGlobalObject.vm());
    auto result = enforceRange<IDLUnrestrictedDouble>(lexicalGlobalObject, x, minimum, maximum);
    if (result.hasException(scope)) [[unlikely]]
        return 0;
    return result.releaseReturnValue();
}

template<typename T>
struct IntTypeLimits {};

template<>
struct IntTypeLimits<int8_t> {
    static constexpr int8_t minValue = -128;
    static constexpr int8_t maxValue = 127;
    static constexpr unsigned numberOfValues = 256; // 2^8
};

template<>
struct IntTypeLimits<uint8_t> {
    static constexpr uint8_t maxValue = 255;
    static constexpr unsigned numberOfValues = 256; // 2^8
};

template<>
struct IntTypeLimits<int16_t> {
    static constexpr short minValue = -32768;
    static constexpr short maxValue = 32767;
    static constexpr unsigned numberOfValues = 65536; // 2^16
};

template<>
struct IntTypeLimits<uint16_t> {
    static constexpr unsigned short maxValue = 65535;
    static constexpr unsigned numberOfValues = 65536; // 2^16
};

template<typename IDL, IntegerConversionConfiguration configuration>
static inline ConversionResult<IDL> toSmallerInt(JSGlobalObject& lexicalGlobalObject, JSValue value)
{
    using T = typename IDL::ImplementationType;
    using LimitsTrait = IntTypeLimits<T>;

    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    static_assert(std::is_signed<T>::value && std::is_integral<T>::value, "Should only be used for signed integral types");

    // Fast path if the value is already a 32-bit signed integer in the right range.
    if (value.isInt32()) {
        int32_t d = value.asInt32();
        if (d >= LimitsTrait::minValue && d <= LimitsTrait::maxValue)
            return static_cast<T>(d);

        if constexpr (configuration == IntegerConversionConfiguration::Normal) {
            d %= LimitsTrait::numberOfValues;
            return static_cast<T>(d > LimitsTrait::maxValue ? d - LimitsTrait::numberOfValues : d);
        } else if constexpr (configuration == IntegerConversionConfiguration::EnforceRange) {
            throwTypeError(&lexicalGlobalObject, scope);
            return ConversionResult<IDL>::exception();
        } else if constexpr (configuration == IntegerConversionConfiguration::Clamp)
            return d < LimitsTrait::minValue ? ConversionResult<IDL> { LimitsTrait::minValue } : ConversionResult<IDL> { LimitsTrait::maxValue };
    }

    double x = value.toNumber(&lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, ConversionResult<IDL>::exception());

    if constexpr (configuration == IntegerConversionConfiguration::Normal) {
        if (std::isnan(x) || std::isinf(x) || !x)
            return 0;

        x = x < 0 ? -floor(-x) : floor(x);
        x = fmod(x, LimitsTrait::numberOfValues);

        return static_cast<T>(x > LimitsTrait::maxValue ? x - LimitsTrait::numberOfValues : x);
    } else if constexpr (configuration == IntegerConversionConfiguration::EnforceRange)
        RELEASE_AND_RETURN(scope, enforceRange<IDL>(lexicalGlobalObject, x, LimitsTrait::minValue, LimitsTrait::maxValue));
    else if constexpr (configuration == IntegerConversionConfiguration::Clamp)
        return std::isnan(x) ? ConversionResult<IDL> { 0 } : ConversionResult<IDL> { clampTo<T>(roundeven(x)) };
}

template<typename IDL, IntegerConversionConfiguration configuration>
static inline ConversionResult<IDL> toSmallerUInt(JSGlobalObject& lexicalGlobalObject, JSValue value)
{
    using T = typename IDL::ImplementationType;
    using LimitsTrait = IntTypeLimits<T>;

    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    static_assert(std::is_unsigned<T>::value && std::is_integral<T>::value, "Should only be used for unsigned integral types");

    // Fast path if the value is already a 32-bit unsigned integer in the right range.
    if (value.isUInt32()) {
        uint32_t d = value.asUInt32();
        if (d <= LimitsTrait::maxValue)
            return static_cast<T>(d);
        if constexpr (configuration == IntegerConversionConfiguration::Normal)
            return static_cast<T>(d);
        else if constexpr (configuration == IntegerConversionConfiguration::EnforceRange) {
            throwTypeError(&lexicalGlobalObject, scope);
            return ConversionResult<IDL>::exception();
        } else if constexpr (configuration == IntegerConversionConfiguration::Clamp)
            return LimitsTrait::maxValue;
    }

    double x = value.toNumber(&lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, ConversionResult<IDL>::exception());

    if constexpr (configuration == IntegerConversionConfiguration::Normal) {
        if (std::isnan(x) || std::isinf(x) || !x)
            return 0;

        x = x < 0 ? -floor(-x) : floor(x);
        x = fmod(x, LimitsTrait::numberOfValues);

        return static_cast<T>(x < 0 ? x + LimitsTrait::numberOfValues : x);
    } else if constexpr (configuration == IntegerConversionConfiguration::EnforceRange)
        RELEASE_AND_RETURN(scope, enforceRange<IDL>(lexicalGlobalObject, x, 0, LimitsTrait::maxValue));
    else if constexpr (configuration == IntegerConversionConfiguration::Clamp)
        return std::isnan(x) ? 0 : clampTo<T>(roundeven(x));
}

template<> ConversionResult<IDLByte> convertToIntegerEnforceRange<IDLByte>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerInt<IDLByte, IntegerConversionConfiguration::EnforceRange>(lexicalGlobalObject, value);
}

template<> ConversionResult<IDLOctet> convertToIntegerEnforceRange<IDLOctet>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerUInt<IDLOctet, IntegerConversionConfiguration::EnforceRange>(lexicalGlobalObject, value);
}

template<> ConversionResult<IDLByte> convertToIntegerClamp<IDLByte>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerInt<IDLByte, IntegerConversionConfiguration::Clamp>(lexicalGlobalObject, value);
}

template<> ConversionResult<IDLOctet> convertToIntegerClamp<IDLOctet>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerUInt<IDLOctet, IntegerConversionConfiguration::Clamp>(lexicalGlobalObject, value);
}

template<> ConversionResult<IDLByte> convertToInteger<IDLByte>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerInt<IDLByte, IntegerConversionConfiguration::Normal>(lexicalGlobalObject, value);
}

template<> ConversionResult<IDLOctet> convertToInteger<IDLOctet>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerUInt<IDLOctet, IntegerConversionConfiguration::Normal>(lexicalGlobalObject, value);
}

template<> ConversionResult<IDLShort> convertToIntegerEnforceRange<IDLShort>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerInt<IDLShort, IntegerConversionConfiguration::EnforceRange>(lexicalGlobalObject, value);
}

template<> ConversionResult<IDLUnsignedShort> convertToIntegerEnforceRange<IDLUnsignedShort>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerUInt<IDLUnsignedShort, IntegerConversionConfiguration::EnforceRange>(lexicalGlobalObject, value);
}

template<> ConversionResult<IDLShort> convertToIntegerClamp<IDLShort>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerInt<IDLShort, IntegerConversionConfiguration::Clamp>(lexicalGlobalObject, value);
}

template<> ConversionResult<IDLUnsignedShort> convertToIntegerClamp<IDLUnsignedShort>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerUInt<IDLUnsignedShort, IntegerConversionConfiguration::Clamp>(lexicalGlobalObject, value);
}

template<> ConversionResult<IDLShort> convertToInteger<IDLShort>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerInt<IDLShort, IntegerConversionConfiguration::Normal>(lexicalGlobalObject, value);
}

template<> ConversionResult<IDLUnsignedShort> convertToInteger<IDLUnsignedShort>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerUInt<IDLUnsignedShort, IntegerConversionConfiguration::Normal>(lexicalGlobalObject, value);
}

template<> ConversionResult<IDLLong> convertToIntegerEnforceRange<IDLLong>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isInt32())
        return value.asInt32();

    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    double x = value.toNumber(&lexicalGlobalObject);

    RETURN_IF_EXCEPTION(scope, ConversionResult<IDLLong>::exception());

    RELEASE_AND_RETURN(scope, enforceRange<IDLLong>(lexicalGlobalObject, x, kMinInt32, kMaxInt32));
}

template<> ConversionResult<IDLUnsignedLong> convertToIntegerEnforceRange<IDLUnsignedLong>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isUInt32())
        return value.asUInt32();

    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    double x = value.toNumber(&lexicalGlobalObject);

    RETURN_IF_EXCEPTION(scope, ConversionResult<IDLUnsignedLong>::exception());

    RELEASE_AND_RETURN(scope, enforceRange<IDLUnsignedLong>(lexicalGlobalObject, x, 0, kMaxUInt32));
}

template<> ConversionResult<IDLLong> convertToIntegerClamp<IDLLong>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isInt32())
        return value.asInt32();

    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    double x = value.toNumber(&lexicalGlobalObject);

    RETURN_IF_EXCEPTION(scope, ConversionResult<IDLLong>::exception());

    return std::isnan(x) ? 0 : clampTo<int32_t>(roundeven(x));
}

template<> ConversionResult<IDLUnsignedLong> convertToIntegerClamp<IDLUnsignedLong>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isUInt32())
        return value.asUInt32();

    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    double x = value.toNumber(&lexicalGlobalObject);

    RETURN_IF_EXCEPTION(scope, ConversionResult<IDLUnsignedLong>::exception());

    return std::isnan(x) ? 0 : clampTo<uint32_t>(roundeven(x));
}

template<> ConversionResult<IDLLong> convertToInteger<IDLLong>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto x = value.toInt32(&lexicalGlobalObject);

    RETURN_IF_EXCEPTION(scope, ConversionResult<IDLLong>::exception());

    return x;
}

template<> ConversionResult<IDLUnsignedLong> convertToInteger<IDLUnsignedLong>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto x = value.toUInt32(&lexicalGlobalObject);

    RETURN_IF_EXCEPTION(scope, ConversionResult<IDLUnsignedLong>::exception());

    return x;
}

template<> ConversionResult<IDLLongLong> convertToIntegerEnforceRange<IDLLongLong>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isInt32())
        return value.asInt32();

    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    double x = value.toNumber(&lexicalGlobalObject);

    RETURN_IF_EXCEPTION(scope, ConversionResult<IDLLongLong>::exception());

    RELEASE_AND_RETURN(scope, enforceRange<IDLLongLong>(lexicalGlobalObject, x, -kJSMaxInteger, kJSMaxInteger));
}

template<> ConversionResult<IDLUnsignedLongLong> convertToIntegerEnforceRange<IDLUnsignedLongLong>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isUInt32())
        return value.asUInt32();

    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    double x = value.toNumber(&lexicalGlobalObject);

    RETURN_IF_EXCEPTION(scope, ConversionResult<IDLUnsignedLongLong>::exception());

    RELEASE_AND_RETURN(scope, enforceRange<IDLUnsignedLongLong>(lexicalGlobalObject, x, 0, kJSMaxInteger));
}

template<> ConversionResult<IDLLongLong> convertToIntegerClamp<IDLLongLong>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isInt32())
        return value.asInt32();

    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    double x = value.toNumber(&lexicalGlobalObject);

    RETURN_IF_EXCEPTION(scope, ConversionResult<IDLLongLong>::exception());

    return std::isnan(x) ? 0 : static_cast<int64_t>(roundeven(std::min<double>(std::max<double>(x, -kJSMaxInteger), kJSMaxInteger)));
}

template<> ConversionResult<IDLUnsignedLongLong> convertToIntegerClamp<IDLUnsignedLongLong>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isUInt32())
        return value.asUInt32();

    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    double x = value.toNumber(&lexicalGlobalObject);

    RETURN_IF_EXCEPTION(scope, ConversionResult<IDLUnsignedLongLong>::exception());

    return std::isnan(x) ? 0 : static_cast<uint64_t>(roundeven(std::min<double>(std::max<double>(x, 0), kJSMaxInteger)));
}

template<> ConversionResult<IDLLongLong> convertToInteger<IDLLongLong>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isInt32())
        return value.asInt32();

    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    double x = value.toNumber(&lexicalGlobalObject);

    RETURN_IF_EXCEPTION(scope, ConversionResult<IDLLongLong>::exception());

    // Map NaNs and +/-Infinity to 0; convert finite values modulo 2^64.
    unsigned long long n;
    doubleToInteger(x, n);
    return n;
}

template<> ConversionResult<IDLUnsignedLongLong> convertToInteger<IDLUnsignedLongLong>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isUInt32())
        return value.asUInt32();

    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    double x = value.toNumber(&lexicalGlobalObject);

    RETURN_IF_EXCEPTION(scope, ConversionResult<IDLUnsignedLongLong>::exception());

    // Map NaNs and +/-Infinity to 0; convert finite values modulo 2^64.
    unsigned long long n;
    doubleToInteger(x, n);
    return n;
}

JSC::JSValue JSConverter<IDLDouble>::convert(Type value)
{
    ASSERT(!std::isnan(value));
    return JSC::jsNumber(value);
}

JSC::JSValue JSConverter<IDLUnrestrictedDouble>::convert(Type value)
{
    return JSC::jsNumber(JSC::purifyNaN(value));
}

JSC::JSValue JSConverter<IDLUnrestrictedDouble>::convert(const MediaTime& value)
{
    return JSC::jsNumber(JSC::purifyNaN(value.toDouble()));
}

} // namespace WebCore
