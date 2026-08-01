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
#include "JSDOMConvertNullable.h"

namespace WebCore {

template<typename T> struct Converter<IDLOptional<T>> : DefaultConverter<IDLOptional<T>> {
    using ReturnType = typename Converter<IDLNullable<T>>::ReturnType;

    static constexpr bool conversionHasSideEffects = WebCore::Converter<T>::conversionHasSideEffects;

    static constexpr bool takesContext = true;

    template<Bun::IDLConversionContext Ctx>
    static std::optional<ReturnType> tryConvert(
        JSC::JSGlobalObject& lexicalGlobalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        if (value.isUndefined())
            return T::nullValue();
        auto result = Bun::tryConvertIDL<T>(lexicalGlobalObject, value, ctx);
        if (result.has_value()) {
            return std::move(*result);
        }
        return std::nullopt;
    }

    template<Bun::IDLConversionContext Ctx>
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, Ctx& ctx)
    {
        if (value.isUndefined())
            return T::nullValue();
        return Bun::convertIDL<T>(lexicalGlobalObject, value, ctx);
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        if (value.isUndefined())
            return T::nullValue();
        return Converter<T>::convert(lexicalGlobalObject, value);
    }
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSC::JSObject& thisObject)
    {
        if (value.isUndefined())
            return T::nullValue();
        return Converter<T>::convert(lexicalGlobalObject, value, thisObject);
    }
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSDOMGlobalObject& globalObject)
    {
        if (value.isUndefined())
            return T::nullValue();
        return Converter<T>::convert(lexicalGlobalObject, value, globalObject);
    }
    template<typename ExceptionThrower = DefaultExceptionThrower>
        requires(!Bun::IDLConversionContext<std::decay_t<ExceptionThrower>>)
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, ExceptionThrower&& exceptionThrower)
    {
        if (value.isUndefined())
            return T::nullValue();
        return Converter<T>::convert(lexicalGlobalObject, value, std::forward<ExceptionThrower>(exceptionThrower));
    }
    template<typename ExceptionThrower = DefaultExceptionThrower>
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSC::JSObject& thisObject, ExceptionThrower&& exceptionThrower)
    {
        if (value.isUndefined())
            return T::nullValue();
        return Converter<T>::convert(lexicalGlobalObject, value, thisObject, std::forward<ExceptionThrower>(exceptionThrower));
    }
    template<typename ExceptionThrower = DefaultExceptionThrower>
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSDOMGlobalObject& globalObject, ExceptionThrower&& exceptionThrower)
    {
        if (value.isUndefined())
            return T::nullValue();
        return Converter<T>::convert(lexicalGlobalObject, value, globalObject, std::forward<ExceptionThrower>(exceptionThrower));
    }
};

} // namespace WebCore
