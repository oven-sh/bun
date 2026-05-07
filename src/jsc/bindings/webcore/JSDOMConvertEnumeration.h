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
#include "JSDOMGlobalObject.h"
#include "BunIDLConvertBase.h"

namespace WebCore {

// Specialized by generated code for IDL enumeration conversion.
template<typename T> std::optional<T> parseEnumeration(JSC::JSGlobalObject&, JSC::JSValue);
template<typename T> std::optional<T> parseEnumerationFromView(const StringView&);
template<typename T> std::optional<T> parseEnumerationFromString(const String&);
template<typename T> ASCIILiteral expectedEnumerationValues();

// Specialized by generated code for IDL enumeration conversion.
template<typename T> JSC::JSString* convertEnumerationToJS(JSC::JSGlobalObject&, T);

template<typename T> struct Converter<IDLEnumeration<T>> : DefaultConverter<IDLEnumeration<T>> {
    static constexpr bool takesContext = true;

    // `tryConvert` for enumerations is strict: it returns null if the value is not a string.
    template<Bun::IDLConversionContext Ctx>
    static std::optional<T> tryConvert(
        JSC::JSGlobalObject& lexicalGlobalObject,
        JSC::JSValue value,
        Ctx& ctx)
    {
        if (value.isString()) {
            return parseEnumeration<T>(lexicalGlobalObject, value);
        }
        return std::nullopt;
    }

    // When converting with Context, the conversion is stricter: non-strings are disallowed.
    template<Bun::IDLConversionContext Ctx>
    static T convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, Ctx& ctx)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        if (!value.isString()) {
            ctx.throwNotString(lexicalGlobalObject, throwScope);
            return {};
        }
        auto result = parseEnumeration<T>(lexicalGlobalObject, value);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (result.has_value()) {
            return std::move(*result);
        }
        ctx.template throwBadEnumValue<IDLEnumeration<T>>(lexicalGlobalObject, throwScope);
        return {};
    }

    template<typename ExceptionThrower = DefaultExceptionThrower>
        requires(!Bun::IDLConversionContext<std::decay_t<ExceptionThrower>>)
    static T convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, ExceptionThrower&& exceptionThrower = ExceptionThrower())
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto throwScope = DECLARE_THROW_SCOPE(vm);

        auto result = parseEnumeration<T>(lexicalGlobalObject, value);
        RETURN_IF_EXCEPTION(throwScope, {});

        if (!result) [[unlikely]] {
            exceptionThrower(lexicalGlobalObject, throwScope);
            return {};
        }
        return result.value();
    }
};

template<typename T> struct JSConverter<IDLEnumeration<T>> {
    static constexpr bool needsState = true;
    static constexpr bool needsGlobalObject = false;

    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, T value)
    {
        return convertEnumerationToJS(lexicalGlobalObject, value);
    }
};

} // namespace WebCore
