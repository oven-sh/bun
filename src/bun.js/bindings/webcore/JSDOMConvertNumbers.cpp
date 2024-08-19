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
#include <wtf/text/StringConcatenateNumbers.h>
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

static double enforceRange(JSGlobalObject& lexicalGlobalObject, double x, double minimum, double maximum)
{
    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (std::isnan(x) || std::isinf(x)) {
        throwTypeError(&lexicalGlobalObject, scope, rangeErrorString(x, minimum, maximum));
        return 0;
    }
    x = trunc(x);
    if (x < minimum || x > maximum) {
        throwTypeError(&lexicalGlobalObject, scope, rangeErrorString(x, minimum, maximum));
        return 0;
    }
    return x;
}

namespace {

template<typename T>
struct IntTypeLimits {
};

template<>
struct IntTypeLimits<int8_t> {
    static const int8_t minValue = -128;
    static const int8_t maxValue = 127;
    static const unsigned numberOfValues = 256; // 2^8
};

template<>
struct IntTypeLimits<uint8_t> {
    static const uint8_t maxValue = 255;
    static const unsigned numberOfValues = 256; // 2^8
};

template<>
struct IntTypeLimits<int16_t> {
    static const short minValue = -32768;
    static const short maxValue = 32767;
    static const unsigned numberOfValues = 65536; // 2^16
};

template<>
struct IntTypeLimits<uint16_t> {
    static const unsigned short maxValue = 65535;
    static const unsigned numberOfValues = 65536; // 2^16
};

}

template<typename T, IntegerConversionConfiguration configuration>
static inline T toSmallerInt(JSGlobalObject& lexicalGlobalObject, JSValue value)
{
    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    static_assert(std::is_signed<T>::value && std::is_integral<T>::value, "Should only be used for signed integral types");

    typedef IntTypeLimits<T> LimitsTrait;
    // Fast path if the value is already a 32-bit signed integer in the right range.
    if (value.isInt32()) {
        int32_t d = value.asInt32();
        if (d >= LimitsTrait::minValue && d <= LimitsTrait::maxValue)
            return static_cast<T>(d);
        switch (configuration) {
        case IntegerConversionConfiguration::Normal:
            break;
        case IntegerConversionConfiguration::EnforceRange:
            throwTypeError(&lexicalGlobalObject, scope);
            return 0;
        case IntegerConversionConfiguration::Clamp:
            return d < LimitsTrait::minValue ? LimitsTrait::minValue : LimitsTrait::maxValue;
        }
        d %= LimitsTrait::numberOfValues;
        return static_cast<T>(d > LimitsTrait::maxValue ? d - LimitsTrait::numberOfValues : d);
    }

    double x = value.toNumber(&lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, 0);

    switch (configuration) {
    case IntegerConversionConfiguration::Normal:
        break;
    case IntegerConversionConfiguration::EnforceRange:
        return enforceRange(lexicalGlobalObject, x, LimitsTrait::minValue, LimitsTrait::maxValue);
    case IntegerConversionConfiguration::Clamp:
        return std::isnan(x) ? 0 : clampTo<T>(x);
    }

    if (std::isnan(x) || std::isinf(x) || !x)
        return 0;

    x = x < 0 ? -floor(fabs(x)) : floor(fabs(x));
    x = fmod(x, LimitsTrait::numberOfValues);

    return static_cast<T>(x > LimitsTrait::maxValue ? x - LimitsTrait::numberOfValues : x);
}

template<typename T, IntegerConversionConfiguration configuration>
static inline T toSmallerUInt(JSGlobalObject& lexicalGlobalObject, JSValue value)
{
    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    static_assert(std::is_unsigned<T>::value && std::is_integral<T>::value, "Should only be used for unsigned integral types");

    typedef IntTypeLimits<T> LimitsTrait;
    // Fast path if the value is already a 32-bit unsigned integer in the right range.
    if (value.isUInt32()) {
        uint32_t d = value.asUInt32();
        if (d <= LimitsTrait::maxValue)
            return static_cast<T>(d);
        switch (configuration) {
        case IntegerConversionConfiguration::Normal:
            return static_cast<T>(d);
        case IntegerConversionConfiguration::EnforceRange:
            throwTypeError(&lexicalGlobalObject, scope);
            return 0;
        case IntegerConversionConfiguration::Clamp:
            return LimitsTrait::maxValue;
        }
    }

    double x = value.toNumber(&lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, 0);

    switch (configuration) {
    case IntegerConversionConfiguration::Normal:
        break;
    case IntegerConversionConfiguration::EnforceRange:
        return enforceRange(lexicalGlobalObject, x, 0, LimitsTrait::maxValue);
    case IntegerConversionConfiguration::Clamp:
        return std::isnan(x) ? 0 : clampTo<T>(x);
    }

    if (std::isnan(x) || std::isinf(x) || !x)
        return 0;

    x = x < 0 ? -floor(fabs(x)) : floor(fabs(x));
    x = fmod(x, LimitsTrait::numberOfValues);
    if (x < 0)
        x += LimitsTrait::numberOfValues;
    return static_cast<T>(x);
}

template<> int8_t convertToIntegerEnforceRange<int8_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerInt<int8_t, IntegerConversionConfiguration::EnforceRange>(lexicalGlobalObject, value);
}

template<> uint8_t convertToIntegerEnforceRange<uint8_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerUInt<uint8_t, IntegerConversionConfiguration::EnforceRange>(lexicalGlobalObject, value);
}

template<> int8_t convertToIntegerClamp<int8_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerInt<int8_t, IntegerConversionConfiguration::Clamp>(lexicalGlobalObject, value);
}

template<> uint8_t convertToIntegerClamp<uint8_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerUInt<uint8_t, IntegerConversionConfiguration::Clamp>(lexicalGlobalObject, value);
}

template<> int8_t convertToInteger<int8_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerInt<int8_t, IntegerConversionConfiguration::Normal>(lexicalGlobalObject, value);
}

template<> uint8_t convertToInteger<uint8_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerUInt<uint8_t, IntegerConversionConfiguration::Normal>(lexicalGlobalObject, value);
}

template<> int16_t convertToIntegerEnforceRange<int16_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerInt<int16_t, IntegerConversionConfiguration::EnforceRange>(lexicalGlobalObject, value);
}

template<> uint16_t convertToIntegerEnforceRange<uint16_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerUInt<uint16_t, IntegerConversionConfiguration::EnforceRange>(lexicalGlobalObject, value);
}

template<> int16_t convertToIntegerClamp<int16_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerInt<int16_t, IntegerConversionConfiguration::Clamp>(lexicalGlobalObject, value);
}

template<> uint16_t convertToIntegerClamp<uint16_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerUInt<uint16_t, IntegerConversionConfiguration::Clamp>(lexicalGlobalObject, value);
}

template<> int16_t convertToInteger<int16_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerInt<int16_t, IntegerConversionConfiguration::Normal>(lexicalGlobalObject, value);
}

template<> uint16_t convertToInteger<uint16_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return toSmallerUInt<uint16_t, IntegerConversionConfiguration::Normal>(lexicalGlobalObject, value);
}

template<> int32_t convertToIntegerEnforceRange<int32_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isInt32())
        return value.asInt32();

    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    double x = value.toNumber(&lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, 0);
    return enforceRange(lexicalGlobalObject, x, kMinInt32, kMaxInt32);
}

template<> uint32_t convertToIntegerEnforceRange<uint32_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isUInt32())
        return value.asUInt32();

    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    double x = value.toNumber(&lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, 0);
    return enforceRange(lexicalGlobalObject, x, 0, kMaxUInt32);
}

template<> int32_t convertToIntegerClamp<int32_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isInt32())
        return value.asInt32();

    double x = value.toNumber(&lexicalGlobalObject);
    return std::isnan(x) ? 0 : clampTo<int32_t>(x);
}

template<> uint32_t convertToIntegerClamp<uint32_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isUInt32())
        return value.asUInt32();

    double x = value.toNumber(&lexicalGlobalObject);
    return std::isnan(x) ? 0 : clampTo<uint32_t>(x);
}

template<> int32_t convertToInteger<int32_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return value.toInt32(&lexicalGlobalObject);
}

template<> uint32_t convertToInteger<uint32_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return value.toUInt32(&lexicalGlobalObject);
}

template<> int64_t convertToIntegerEnforceRange<int64_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isInt32())
        return value.asInt32();

    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    double x = value.toNumber(&lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, 0);
    return enforceRange(lexicalGlobalObject, x, -kJSMaxInteger, kJSMaxInteger);
}

template<> uint64_t convertToIntegerEnforceRange<uint64_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isUInt32())
        return value.asUInt32();

    VM& vm = lexicalGlobalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    double x = value.toNumber(&lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, 0);
    return enforceRange(lexicalGlobalObject, x, 0, kJSMaxInteger);
}

template<> int64_t convertToIntegerClamp<int64_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isInt32())
        return value.asInt32();

    double x = value.toNumber(&lexicalGlobalObject);
    return std::isnan(x) ? 0 : static_cast<int64_t>(std::min<double>(std::max<double>(x, -kJSMaxInteger), kJSMaxInteger));
}

template<> uint64_t convertToIntegerClamp<uint64_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isUInt32())
        return value.asUInt32();

    double x = value.toNumber(&lexicalGlobalObject);
    return std::isnan(x) ? 0 : static_cast<uint64_t>(std::min<double>(std::max<double>(x, 0), kJSMaxInteger));
}

template<> int64_t convertToInteger<int64_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isInt32())
        return value.asInt32();

    double x = value.toNumber(&lexicalGlobalObject);

    // Map NaNs and +/-Infinity to 0; convert finite values modulo 2^64.
    unsigned long long n;
    doubleToInteger(x, n);
    return n;
}

template<> uint64_t convertToInteger<uint64_t>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    if (value.isUInt32())
        return value.asUInt32();

    double x = value.toNumber(&lexicalGlobalObject);

    // Map NaNs and +/-Infinity to 0; convert finite values modulo 2^64.
    unsigned long long n;
    doubleToInteger(x, n);
    return n;
}

} // namespace WebCore
