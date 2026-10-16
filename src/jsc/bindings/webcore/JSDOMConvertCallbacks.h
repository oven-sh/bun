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

namespace WebCore {

template<typename ImplementationClass> struct JSDOMCallbackConverterTraits;

// An example of an implementation of the traits.
//
// template<> struct JSDOMCallbackConverterTraits<JSNodeFilter> {
//     using Base = NodeFilter;
// };
//
// These will be produced by the code generator.

template<typename T> struct Converter<IDLCallbackFunction<T>> : DefaultConverter<IDLCallbackFunction<T>> {
    static constexpr bool conversionHasSideEffects = false;

    using Result = ConversionResult<IDLCallbackFunction<T>>;

    template<typename ExceptionThrower = DefaultExceptionThrower>
    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSDOMGlobalObject& globalObject, NOESCAPE ExceptionThrower&& exceptionThrower = ExceptionThrower())
    {
        JSC::VM& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        if (!value.isCallable()) {
            exceptionThrower(lexicalGlobalObject, scope);
            return Result::exception();
        }

        return Result { T::create(JSC::asObject(value), &globalObject) };
    }
};

template<typename T> struct JSConverter<IDLCallbackFunction<T>> {
    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    using Base = typename JSDOMCallbackConverterTraits<T>::Base;

    static JSC::JSValue convert(const Base& value)
    {
        return toJS(Detail::getPtrOrRef(value));
    }

    static JSC::JSValue convert(const Ref<Base>& value)
    {
        return toJS(Detail::getPtrOrRef(value));
    }

    static JSC::JSValue convertNewlyCreated(Ref<Base>&& value)
    {
        return toJSNewlyCreated(std::forward<Base>(value));
    }
};

// Specialization of nullable callback function to account for unconventional base type input.
template<typename T> struct JSConverter<IDLNullable<IDLCallbackFunction<T>>> {
    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    using Base = typename JSDOMCallbackConverterTraits<T>::Base;

    static JSC::JSValue convert(const Base* value)
    {
        if (!value)
            return JSC::jsNull();
        return toJS<IDLCallbackFunction<T>>(*value);
    }

    static JSC::JSValue convert(const RefPtr<Base>& value)
    {
        if (!value)
            return JSC::jsNull();
        return toJS<IDLCallbackFunction<T>>(*value);
    }

    static JSC::JSValue convertNewlyCreated(RefPtr<Base>&& value)
    {
        if (!value)
            return JSC::jsNull();
        return toJSNewlyCreated<IDLCallbackFunction<T>>(value.releaseNonNull());
    }
};

template<typename T> struct Converter<IDLCallbackInterface<T>> : DefaultConverter<IDLCallbackInterface<T>> {
    using Result = ConversionResult<IDLCallbackInterface<T>>;

    template<typename ExceptionThrower = DefaultExceptionThrower>
    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSDOMGlobalObject& globalObject, NOESCAPE ExceptionThrower&& exceptionThrower = ExceptionThrower())
    {
        JSC::VM& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        if (!value.isObject()) {
            exceptionThrower(lexicalGlobalObject, scope);
            return Result::exception();
        }

        return Result { T::create(JSC::asObject(value), &globalObject) };
    }
};

template<typename T> struct JSConverter<IDLCallbackInterface<T>> {
    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    using Base = typename JSDOMCallbackConverterTraits<T>::Base;

    static JSC::JSValue convert(const Base& value)
    {
        return toJS(Detail::getPtrOrRef(value));
    }

    static JSC::JSValue convert(const Ref<Base>& value)
    {
        return toJS(Detail::getPtrOrRef(value));
    }

    static JSC::JSValue convertNewlyCreated(Ref<Base>&& value)
    {
        return toJSNewlyCreated(std::forward<Base>(value));
    }
};

// Specialization of nullable callback interface to account for unconventional base type input.
template<typename T> struct JSConverter<IDLNullable<IDLCallbackInterface<T>>> {
    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    using Base = typename JSDOMCallbackConverterTraits<T>::Base;

    static JSC::JSValue convert(const Base* value)
    {
        if (!value)
            return JSC::jsNull();
        return toJS<IDLCallbackInterface<T>>(*value);
    }

    static JSC::JSValue convert(const RefPtr<Base>& value)
    {
        if (!value)
            return JSC::jsNull();
        return toJS<IDLCallbackInterface<T>>(*value);
    }

    static JSC::JSValue convertNewlyCreated(RefPtr<Base>&& value)
    {
        if (!value)
            return JSC::jsNull();
        return toJSNewlyCreated<IDLCallbackInterface<T>>(value.releaseNonNull());
    }
};

} // namespace WebCore
