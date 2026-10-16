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

#include "BunIDLConvertBase.h"
#include "IDLTypes.h"
#include "JSDOMConvertAny.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertNumbers.h"
#include "JSDOMConvertStrings.h"

namespace WebCore {

template<typename IDL> struct Converter<IDLNullable<IDL>> : DefaultConverter<IDLNullable<IDL>> {
    using Result = ConversionResult<IDLNullable<IDL>>;
    using ReturnType = typename DefaultConverter<IDLNullable<IDL>>::ReturnType;

    static constexpr bool conversionHasSideEffects = Converter<IDL>::conversionHasSideEffects;
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
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, Ctx& ctx)
    {
        if (value.isUndefinedOrNull())
            return IDL::nullValue();
        return Bun::convertIDL<IDL>(lexicalGlobalObject, value, ctx);
    }

    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        if (value.isUndefinedOrNull())
            return { IDL::nullValue() };
        return WebCore::convert<IDL>(lexicalGlobalObject, value);
    }
    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSC::JSObject& thisObject)
    {
        if (value.isUndefinedOrNull())
            return { IDL::nullValue() };
        return WebCore::convert<IDL>(lexicalGlobalObject, value, thisObject);
    }
    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSDOMGlobalObject& globalObject)
    {
        if (value.isUndefinedOrNull())
            return { IDL::nullValue() };
        return WebCore::convert<IDL>(lexicalGlobalObject, value, globalObject);
    }
    template<typename ExceptionThrower = DefaultExceptionThrower>
        requires(!Bun::IDLConversionContext<std::decay_t<ExceptionThrower>>)
    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, NOESCAPE ExceptionThrower&& exceptionThrower)
    {
        if (value.isUndefinedOrNull())
            return { IDL::nullValue() };
        return WebCore::convert<IDL>(lexicalGlobalObject, value, std::forward<ExceptionThrower>(exceptionThrower));
    }
    template<typename ExceptionThrower = DefaultExceptionThrower>
    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSC::JSObject& thisObject, NOESCAPE ExceptionThrower&& exceptionThrower)
    {
        if (value.isUndefinedOrNull())
            return { IDL::nullValue() };
        return WebCore::convert<IDL>(lexicalGlobalObject, value, thisObject, std::forward<ExceptionThrower>(exceptionThrower));
    }
    template<typename ExceptionThrower = DefaultExceptionThrower>
    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSDOMGlobalObject& globalObject, NOESCAPE ExceptionThrower&& exceptionThrower)
    {
        if (value.isUndefinedOrNull())
            return { IDL::nullValue() };
        return WebCore::convert<IDL>(lexicalGlobalObject, value, globalObject, std::forward<ExceptionThrower>(exceptionThrower));
    }
};

template<typename IDL> struct JSConverter<IDLNullable<IDL>> {
    static constexpr bool needsState = JSConverter<IDL>::needsState;
    static constexpr bool needsGlobalObject = JSConverter<IDL>::needsGlobalObject;

    template<typename U>
    static JSC::JSValue convert(U&& value)
    {
        if (IDL::isNullValue(value))
            return JSC::jsNull();
        return toJS<IDL>(IDL::extractValueFromNullable(std::forward<U>(value)));
    }

    template<typename U>
    static JSC::JSValue convert(const U& value)
    {
        if (IDL::isNullValue(value))
            return JSC::jsNull();
        return toJS<IDL>(IDL::extractValueFromNullable(value));
    }

    template<typename U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, U&& value)
    {
        if (IDL::isNullValue(value))
            return JSC::jsNull();
        return toJS<IDL>(lexicalGlobalObject, IDL::extractValueFromNullable(std::forward<U>(value)));
    }

    template<typename U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, const U& value)
    {
        if (IDL::isNullValue(value))
            return JSC::jsNull();
        return toJS<IDL>(lexicalGlobalObject, IDL::extractValueFromNullable(value));
    }

    template<typename U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, U&& value)
    {
        if (IDL::isNullValue(value))
            return JSC::jsNull();
        return toJS<IDL>(lexicalGlobalObject, globalObject, IDL::extractValueFromNullable(std::forward<U>(value)));
    }

    template<typename U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const U& value)
    {
        if (IDL::isNullValue(value))
            return JSC::jsNull();
        return toJS<IDL>(lexicalGlobalObject, globalObject, IDL::extractValueFromNullable(value));
    }

    template<typename U>
    static JSC::JSValue convertNewlyCreated(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, U&& value)
    {
        if (IDL::isNullValue(value))
            return JSC::jsNull();
        return toJSNewlyCreated<IDL>(lexicalGlobalObject, globalObject, IDL::extractValueFromNullable(std::forward<U>(value)));
    }
};

} // namespace WebCore
