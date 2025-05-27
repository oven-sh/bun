/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "IDLTypes.h"
#include "JSDOMConvertBase.h"
#include "JSDOMExceptionHandling.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/PureNaN.h>

namespace WebCore {

// The following functions convert values to integers as per the WebIDL specification.
// The conversion fails if the value cannot be converted to a number or, if EnforceRange is specified,
// the value is outside the range of the destination integer type.

template<typename T> T convertToInteger(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT int8_t convertToInteger<int8_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT uint8_t convertToInteger<uint8_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT int16_t convertToInteger<int16_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT uint16_t convertToInteger<uint16_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT int32_t convertToInteger<int32_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT uint32_t convertToInteger<uint32_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT int64_t convertToInteger<int64_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT uint64_t convertToInteger<uint64_t>(JSC::JSGlobalObject&, JSC::JSValue);

template<typename T> T convertToIntegerEnforceRange(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT int8_t convertToIntegerEnforceRange<int8_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT uint8_t convertToIntegerEnforceRange<uint8_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT int16_t convertToIntegerEnforceRange<int16_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT uint16_t convertToIntegerEnforceRange<uint16_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT int32_t convertToIntegerEnforceRange<int32_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT uint32_t convertToIntegerEnforceRange<uint32_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT int64_t convertToIntegerEnforceRange<int64_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT uint64_t convertToIntegerEnforceRange<uint64_t>(JSC::JSGlobalObject&, JSC::JSValue);

template<typename T> T convertToIntegerClamp(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT int8_t convertToIntegerClamp<int8_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT uint8_t convertToIntegerClamp<uint8_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT int16_t convertToIntegerClamp<int16_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT uint16_t convertToIntegerClamp<uint16_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT int32_t convertToIntegerClamp<int32_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT uint32_t convertToIntegerClamp<uint32_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT int64_t convertToIntegerClamp<int64_t>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT uint64_t convertToIntegerClamp<uint64_t>(JSC::JSGlobalObject&, JSC::JSValue);

// MARK: -
// MARK: Integer types

template<> struct Converter<IDLByte> : DefaultConverter<IDLByte> {
    static int8_t convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return convertToInteger<int8_t>(lexicalGlobalObject, value);
    }
};

template<> struct JSConverter<IDLByte> {
    using Type = typename IDLByte::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(Type value)
    {
        return JSC::jsNumber(value);
    }
};

template<> struct Converter<IDLOctet> : DefaultConverter<IDLOctet> {
    static uint8_t convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return convertToInteger<uint8_t>(lexicalGlobalObject, value);
    }
};

template<> struct JSConverter<IDLOctet> {
    using Type = typename IDLOctet::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(Type value)
    {
        return JSC::jsNumber(value);
    }
};

template<> struct Converter<IDLShort> : DefaultConverter<IDLShort> {
    static int16_t convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return convertToInteger<int16_t>(lexicalGlobalObject, value);
    }
};

template<> struct JSConverter<IDLShort> {
    using Type = typename IDLShort::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(Type value)
    {
        return JSC::jsNumber(value);
    }
};

template<> struct Converter<IDLUnsignedShort> : DefaultConverter<IDLUnsignedShort> {
    static uint16_t convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return convertToInteger<uint16_t>(lexicalGlobalObject, value);
    }
};

template<> struct JSConverter<IDLUnsignedShort> {
    using Type = typename IDLUnsignedShort::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(Type value)
    {
        return JSC::jsNumber(value);
    }
};

template<> struct Converter<IDLLong> : DefaultConverter<IDLLong> {
    static inline int32_t convert(JSC::JSGlobalObject&, JSC::ThrowScope&, double number)
    {
        return JSC::toInt32(number);
    }

    static int32_t convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return convertToInteger<int32_t>(lexicalGlobalObject, value);
    }
};

template<> struct JSConverter<IDLLong> {
    using Type = typename IDLLong::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(Type value)
    {
        return JSC::jsNumber(value);
    }
};

template<> struct Converter<IDLUnsignedLong> : DefaultConverter<IDLUnsignedLong> {
    static uint32_t convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return convertToInteger<uint32_t>(lexicalGlobalObject, value);
    }
};

template<> struct JSConverter<IDLUnsignedLong> {
    using Type = typename IDLUnsignedLong::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(Type value)
    {
        return JSC::jsNumber(value);
    }
};

template<> struct Converter<IDLLongLong> : DefaultConverter<IDLLongLong> {
    static int64_t convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return convertToInteger<int64_t>(lexicalGlobalObject, value);
    }
};

template<> struct JSConverter<IDLLongLong> {
    using Type = typename IDLLongLong::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(Type value)
    {
        return JSC::jsNumber(value);
    }
};

template<> struct Converter<IDLUnsignedLongLong> : DefaultConverter<IDLUnsignedLongLong> {
    static uint64_t convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return convertToInteger<uint64_t>(lexicalGlobalObject, value);
    }
};

template<> struct JSConverter<IDLUnsignedLongLong> {
    using Type = typename IDLUnsignedLongLong::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(Type value)
    {
        return JSC::jsNumber(value);
    }
};

// MARK: -
// MARK: Annotated Integer types

template<typename T> struct Converter<IDLClampAdaptor<T>> : DefaultConverter<IDLClampAdaptor<T>> {
    using ReturnType = typename IDLClampAdaptor<T>::ImplementationType;

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return convertToIntegerClamp<ReturnType>(lexicalGlobalObject, value);
    }
};

template<typename T> struct JSConverter<IDLClampAdaptor<T>> {
    using Type = typename IDLClampAdaptor<T>::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(Type value)
    {
        return JSConverter<T>::convert(value);
    }
};

template<typename T> struct Converter<IDLEnforceRangeAdaptor<T>> : DefaultConverter<IDLEnforceRangeAdaptor<T>> {
    using ReturnType = typename IDLEnforceRangeAdaptor<T>::ImplementationType;

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return convertToIntegerEnforceRange<ReturnType>(lexicalGlobalObject, value);
    }
};

template<typename T> struct JSConverter<IDLEnforceRangeAdaptor<T>> {
    using Type = typename IDLEnforceRangeAdaptor<T>::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(Type value)
    {
        return JSConverter<T>::convert(value);
    }
};

// MARK: -
// MARK: Floating point types

template<> struct Converter<IDLFloat> : DefaultConverter<IDLFloat> {

    static inline float convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& scope, double number)
    {
        if (!std::isfinite(number)) [[unlikely]]
            throwNonFiniteTypeError(lexicalGlobalObject, scope);
        return static_cast<float>(number);
    }

    static float convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        double number = value.toNumber(&lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, 0.0);
        if (number < std::numeric_limits<float>::lowest() || number > std::numeric_limits<float>::max()) [[unlikely]]
            throwTypeError(&lexicalGlobalObject, scope, "The provided value is outside the range of a float"_s);
        if (!std::isfinite(number)) [[unlikely]]
            throwNonFiniteTypeError(lexicalGlobalObject, scope);
        return static_cast<float>(number);
    }
};

template<> struct JSConverter<IDLFloat> {
    using Type = typename IDLFloat::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(Type value)
    {
        return JSC::jsNumber(value);
    }
};

template<> struct Converter<IDLUnrestrictedFloat> : DefaultConverter<IDLUnrestrictedFloat> {
    static inline float convert(JSC::JSGlobalObject&, JSC::ThrowScope&, double number)
    {
        return static_cast<float>(number);
    }

    static float convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        double number = value.toNumber(&lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, 0.0);

        if (number < std::numeric_limits<float>::lowest()) [[unlikely]]
            return -std::numeric_limits<float>::infinity();
        if (number > std::numeric_limits<float>::max()) [[unlikely]]
            return std::numeric_limits<float>::infinity();
        return static_cast<float>(number);
    }
};

template<> struct JSConverter<IDLUnrestrictedFloat> {
    using Type = typename IDLUnrestrictedFloat::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(Type value)
    {
        return JSC::jsNumber(value);
    }
};

template<> struct Converter<IDLDouble> : DefaultConverter<IDLDouble> {
    static inline double convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& scope, double number)
    {
        if (!std::isfinite(number)) [[unlikely]]
            throwNonFiniteTypeError(lexicalGlobalObject, scope);
        return number;
    }

    static double convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        double number = value.toNumber(&lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, 0.0);
        if (!std::isfinite(number)) [[unlikely]]
            throwNonFiniteTypeError(lexicalGlobalObject, scope);
        return number;
    }
};

template<> struct JSConverter<IDLDouble> {
    using Type = typename IDLDouble::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(Type value)
    {
        ASSERT(!std::isnan(value));
        return JSC::jsNumber(value);
    }
};

template<> struct Converter<IDLUnrestrictedDouble> : DefaultConverter<IDLUnrestrictedDouble> {
    static inline double convert(JSC::JSGlobalObject&, JSC::ThrowScope&, double number)
    {
        return number;
    }

    static double convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return value.toNumber(&lexicalGlobalObject);
    }
};

template<> struct JSConverter<IDLUnrestrictedDouble> {
    using Type = typename IDLUnrestrictedDouble::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(Type value)
    {
        return JSC::jsNumber(JSC::purifyNaN(value));
    }

    // Add overload for MediaTime.
    static JSC::JSValue convert(const MediaTime& value)
    {
        return JSC::jsNumber(JSC::purifyNaN(value.toDouble()));
    }
};

} // namespace WebCore
