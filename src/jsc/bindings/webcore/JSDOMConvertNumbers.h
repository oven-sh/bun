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

#include <JavaScriptCore/GetVM.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/PureNaN.h>
#include "IDLTypes.h"
#include "JSDOMConvertBase.h"
#include "JSDOMExceptionHandling.h"

namespace WebCore {

// The following functions convert values to integers as per the WebIDL specification.
// The conversion fails if the value cannot be converted to a number or, if EnforceRange is specified,
// the value is outside the range of the destination integer type.

template<typename IDL> ConversionResult<IDL> convertToInteger(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLByte> convertToInteger<IDLByte>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLOctet> convertToInteger<IDLOctet>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLShort> convertToInteger<IDLShort>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLUnsignedShort> convertToInteger<IDLUnsignedShort>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLLong> convertToInteger<IDLLong>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLUnsignedLong> convertToInteger<IDLUnsignedLong>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLLongLong> convertToInteger<IDLLongLong>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLUnsignedLongLong> convertToInteger<IDLUnsignedLongLong>(JSC::JSGlobalObject&, JSC::JSValue);

// `x` truncated, or a TypeError if that is not in the range.
double enforceRange(JSC::JSGlobalObject&, double x, double minimum, double maximum);

template<typename IDL> ConversionResult<IDL> convertToIntegerEnforceRange(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLByte> convertToIntegerEnforceRange<IDLByte>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLOctet> convertToIntegerEnforceRange<IDLOctet>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLShort> convertToIntegerEnforceRange<IDLShort>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLUnsignedShort> convertToIntegerEnforceRange<IDLUnsignedShort>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLLong> convertToIntegerEnforceRange<IDLLong>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLUnsignedLong> convertToIntegerEnforceRange<IDLUnsignedLong>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLLongLong> convertToIntegerEnforceRange<IDLLongLong>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLUnsignedLongLong> convertToIntegerEnforceRange<IDLUnsignedLongLong>(JSC::JSGlobalObject&, JSC::JSValue);

template<typename IDL> ConversionResult<IDL> convertToIntegerClamp(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLByte> convertToIntegerClamp<IDLByte>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLOctet> convertToIntegerClamp<IDLOctet>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLShort> convertToIntegerClamp<IDLShort>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLUnsignedShort> convertToIntegerClamp<IDLUnsignedShort>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLLong> convertToIntegerClamp<IDLLong>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLUnsignedLong> convertToIntegerClamp<IDLUnsignedLong>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLLongLong> convertToIntegerClamp<IDLLongLong>(JSC::JSGlobalObject&, JSC::JSValue);
template<> WEBCORE_EXPORT ConversionResult<IDLUnsignedLongLong> convertToIntegerClamp<IDLUnsignedLongLong>(JSC::JSGlobalObject&, JSC::JSValue);

namespace Detail {

template<typename IDL> struct IntegerConverter : DefaultConverter<IDL> {
    using Result = ConversionResult<IDL>;

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return convertToInteger<IDL>(lexicalGlobalObject, value);
    }

    static inline Result convert(JSC::JSGlobalObject&, JSC::ThrowScope&, double number)
        requires std::same_as<IDL, IDLLong>
    {
        return JSC::toInt32(number);
    }
};

template<typename IDL> struct JSNumberConverter : DefaultConverter<IDL> {
    using Type = typename IDL::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(Type value)
    {
        return JSC::jsNumber(value);
    }
};

}

// MARK: -
// MARK: Integer types

template<> struct Converter<IDLByte> : Detail::IntegerConverter<IDLByte> {};
template<> struct Converter<IDLOctet> : Detail::IntegerConverter<IDLOctet> {};
template<> struct Converter<IDLShort> : Detail::IntegerConverter<IDLShort> {};
template<> struct Converter<IDLUnsignedShort> : Detail::IntegerConverter<IDLUnsignedShort> {};
template<> struct Converter<IDLLong> : Detail::IntegerConverter<IDLLong> {};
template<> struct Converter<IDLUnsignedLong> : Detail::IntegerConverter<IDLUnsignedLong> {};
template<> struct Converter<IDLLongLong> : Detail::IntegerConverter<IDLLongLong> {};
template<> struct Converter<IDLUnsignedLongLong> : Detail::IntegerConverter<IDLUnsignedLongLong> {};

template<> struct JSConverter<IDLByte> : Detail::JSNumberConverter<IDLByte> {};
template<> struct JSConverter<IDLOctet> : Detail::JSNumberConverter<IDLOctet> {};
template<> struct JSConverter<IDLShort> : Detail::JSNumberConverter<IDLShort> {};
template<> struct JSConverter<IDLUnsignedShort> : Detail::JSNumberConverter<IDLUnsignedShort> {};
template<> struct JSConverter<IDLLong> : Detail::JSNumberConverter<IDLLong> {};
template<> struct JSConverter<IDLUnsignedLong> : Detail::JSNumberConverter<IDLUnsignedLong> {};
template<> struct JSConverter<IDLLongLong> : Detail::JSNumberConverter<IDLLongLong> {};
template<> struct JSConverter<IDLUnsignedLongLong> : Detail::JSNumberConverter<IDLUnsignedLongLong> {};

// MARK: -
// MARK: Annotated Integer types

template<typename IDL> struct Converter<IDLClampAdaptor<IDL>> : DefaultConverter<IDLClampAdaptor<IDL>> {
    using ReturnType = typename IDLClampAdaptor<IDL>::ImplementationType;
    using Result = ConversionResult<IDLClampAdaptor<IDL>>;

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return convertToIntegerClamp<IDL>(lexicalGlobalObject, value);
    }
};

template<typename IDL> struct JSConverter<IDLClampAdaptor<IDL>> {
    using Type = typename IDLClampAdaptor<IDL>::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(Type value)
    {
        return toJS<IDL>(value);
    }
};

template<typename IDL> struct Converter<IDLEnforceRangeAdaptor<IDL>> : DefaultConverter<IDLEnforceRangeAdaptor<IDL>> {
    using ReturnType = typename IDLEnforceRangeAdaptor<IDL>::ImplementationType;
    using Result = ConversionResult<IDLEnforceRangeAdaptor<IDL>>;

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return convertToIntegerEnforceRange<IDL>(lexicalGlobalObject, value);
    }
};

template<typename IDL> struct JSConverter<IDLEnforceRangeAdaptor<IDL>> {
    using Type = typename IDLEnforceRangeAdaptor<IDL>::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(Type value)
    {
        return toJS<IDL>(value);
    }
};

// MARK: -
// MARK: Floating point types

template<> struct JSConverter<IDLFloat> : Detail::JSNumberConverter<IDLFloat> {};
template<> struct JSConverter<IDLUnrestrictedFloat> : Detail::JSNumberConverter<IDLUnrestrictedFloat> {};

template<> struct Converter<IDLFloat> : DefaultConverter<IDLFloat> {
    using Result = ConversionResult<IDLFloat>;

    static inline Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& scope, double number)
    {
        if (!std::isfinite(number)) [[unlikely]] {
            throwNonFiniteTypeError(lexicalGlobalObject, scope);
            return Result::exception();
        }
        return static_cast<float>(number);
    }

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        JSC::VM& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        double number = value.toNumber(&lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, Result::exception());
        if (!std::isfinite(number)) [[unlikely]] {
            throwNonFiniteTypeError(lexicalGlobalObject, scope);
            return Result::exception();
        }
        if (number < std::numeric_limits<float>::lowest() || number > std::numeric_limits<float>::max()) [[unlikely]] {
            throwTypeError(&lexicalGlobalObject, scope, "The provided value is outside the range of a float"_s);
            return Result::exception();
        }
        return static_cast<float>(number);
    }
};

template<> struct Converter<IDLUnrestrictedFloat> : DefaultConverter<IDLUnrestrictedFloat> {
    using Result = ConversionResult<IDLUnrestrictedFloat>;

    static inline Result convert(JSC::JSGlobalObject&, JSC::ThrowScope&, double number)
    {
        return static_cast<float>(number);
    }

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        JSC::VM& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        double number = value.toNumber(&lexicalGlobalObject);

        RETURN_IF_EXCEPTION(scope, Result::exception());

        if (number < std::numeric_limits<float>::lowest()) [[unlikely]]
            return -std::numeric_limits<float>::infinity();
        if (number > std::numeric_limits<float>::max()) [[unlikely]]
            return std::numeric_limits<float>::infinity();
        return static_cast<float>(number);
    }
};

template<> struct Converter<IDLDouble> : DefaultConverter<IDLDouble> {
    using Result = ConversionResult<IDLDouble>;

    static inline Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& scope, double number)
    {
        if (!std::isfinite(number)) [[unlikely]] {
            throwNonFiniteTypeError(lexicalGlobalObject, scope);
            return Result::exception();
        }
        return number;
    }

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        JSC::VM& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        double number = value.toNumber(&lexicalGlobalObject);

        RETURN_IF_EXCEPTION(scope, Result::exception());

        if (!std::isfinite(number)) [[unlikely]] {
            throwNonFiniteTypeError(lexicalGlobalObject, scope);
            return Result::exception();
        }
        return number;
    }
};

template<> struct JSConverter<IDLDouble> {
    using Type = typename IDLDouble::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    WEBCORE_EXPORT static JSC::JSValue convert(Type);
};

template<> struct Converter<IDLUnrestrictedDouble> : DefaultConverter<IDLUnrestrictedDouble> {
    using Result = ConversionResult<IDLUnrestrictedDouble>;

    static inline Result convert(JSC::JSGlobalObject&, JSC::ThrowScope&, double number)
    {
        return number;
    }

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        JSC::VM& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        double number = value.toNumber(&lexicalGlobalObject);

        RETURN_IF_EXCEPTION(scope, Result::exception());

        return number;
    }
};

template<> struct JSConverter<IDLUnrestrictedDouble> {
    using Type = typename IDLUnrestrictedDouble::ImplementationType;

    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    WEBCORE_EXPORT static JSC::JSValue convert(Type);

    // Add overload for MediaTime.
    WEBCORE_EXPORT static JSC::JSValue convert(const MediaTime&);
};

} // namespace WebCore
