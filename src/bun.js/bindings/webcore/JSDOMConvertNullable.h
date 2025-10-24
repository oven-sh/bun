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
#include "JSDOMConvertAny.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertNumbers.h"
#include "JSDOMConvertStrings.h"
#include "BunIDLConvertBase.h"

namespace WebCore {

namespace Detail {

template<typename IDLType>
struct NullableConversionType;

template<typename IDLType>
struct NullableConversionType {
    using Type = typename IDLNullable<IDLType>::ImplementationType;
};

template<typename T>
struct NullableConversionType<IDLInterface<T>> {
    using Type = typename Converter<IDLInterface<T>>::ReturnType;
};

template<>
struct NullableConversionType<IDLAny> {
    using Type = typename Converter<IDLAny>::ReturnType;
};

}

template<typename T> struct Converter<IDLNullable<T>> : DefaultConverter<IDLNullable<T>> {
    using ReturnType = typename Detail::NullableConversionType<T>::Type;

    static constexpr bool conversionHasSideEffects = WebCore::Converter<T>::conversionHasSideEffects;

    static constexpr bool takesContext = true;

    // 1. If Type(V) is not Object, and the conversion to an IDL value is being performed
    // due to V being assigned to an attribute whose type is a nullable callback function
    // that is annotated with [LegacyTreatNonObjectAsNull], then return the IDL nullable
    // type T? value null.
    //
    // NOTE: Handled elsewhere.
    //
    // 2. Otherwise, if V is null or undefined, then return the IDL nullable type T? value null.
    // 3. Otherwise, return the result of converting V using the rules for the inner IDL type T.

    template<Bun::IDLConversionContext Ctx>
    static std::optional<ReturnType> tryConvert(
        JSC::JSGlobalObject& lexicalGlobalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        if (value.isUndefinedOrNull())
            return T::nullValue();
        return Bun::tryConvertIDL<T>(lexicalGlobalObject, value, ctx);
    }

    template<Bun::IDLConversionContext Ctx>
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, Ctx& ctx)
    {
        if (value.isUndefinedOrNull())
            return T::nullValue();
        return Bun::convertIDL<T>(lexicalGlobalObject, value, ctx);
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        if (value.isUndefinedOrNull())
            return T::nullValue();
        return Converter<T>::convert(lexicalGlobalObject, value);
    }
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSC::JSObject& thisObject)
    {
        if (value.isUndefinedOrNull())
            return T::nullValue();
        return Converter<T>::convert(lexicalGlobalObject, value, thisObject);
    }
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSDOMGlobalObject& globalObject)
    {
        if (value.isUndefinedOrNull())
            return T::nullValue();
        return Converter<T>::convert(lexicalGlobalObject, value, globalObject);
    }
    template<typename ExceptionThrower = DefaultExceptionThrower>
        requires(!Bun::IDLConversionContext<std::decay_t<ExceptionThrower>>)
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, ExceptionThrower&& exceptionThrower)
    {
        if (value.isUndefinedOrNull())
            return T::nullValue();
        return Converter<T>::convert(lexicalGlobalObject, value, std::forward<ExceptionThrower>(exceptionThrower));
    }
    template<typename ExceptionThrower = DefaultExceptionThrower>
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSC::JSObject& thisObject, ExceptionThrower&& exceptionThrower)
    {
        if (value.isUndefinedOrNull())
            return T::nullValue();
        return Converter<T>::convert(lexicalGlobalObject, value, thisObject, std::forward<ExceptionThrower>(exceptionThrower));
    }
    template<typename ExceptionThrower = DefaultExceptionThrower>
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSDOMGlobalObject& globalObject, ExceptionThrower&& exceptionThrower)
    {
        if (value.isUndefinedOrNull())
            return T::nullValue();
        return Converter<T>::convert(lexicalGlobalObject, value, globalObject, std::forward<ExceptionThrower>(exceptionThrower));
    }
};

template<typename T> struct JSConverter<IDLNullable<T>> {
    using ImplementationType = typename IDLNullable<T>::ImplementationType;

    static constexpr bool needsState = JSConverter<T>::needsState;
    static constexpr bool needsGlobalObject = JSConverter<T>::needsGlobalObject;

    template<typename U>
    static JSC::JSValue convert(U&& value)
    {
        if (T::isNullValue(value))
            return JSC::jsNull();
        return JSConverter<T>::convert(T::extractValueFromNullable(value));
    }
    template<typename U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, U&& value)
    {
        if (T::isNullValue(value))
            return JSC::jsNull();
        return JSConverter<T>::convert(lexicalGlobalObject, T::extractValueFromNullable(value));
    }
    template<typename U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, U&& value)
    {
        if (T::isNullValue(value))
            return JSC::jsNull();
        return JSConverter<T>::convert(lexicalGlobalObject, globalObject, T::extractValueFromNullable(value));
    }

    template<typename U>
    static JSC::JSValue convertNewlyCreated(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, U&& value)
    {
        if (T::isNullValue(value))
            return JSC::jsNull();
        return JSConverter<T>::convert(lexicalGlobalObject, globalObject, T::extractValueFromNullable(value));
    }
};

} // namespace WebCore
