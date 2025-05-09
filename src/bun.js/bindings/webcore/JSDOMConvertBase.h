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

#include "root.h"
#include "ZigGlobalObject.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMExceptionHandling.h"
#include <JavaScriptCore/Error.h>

namespace WebCore {

// Conversion from JSValue -> Implementation
template<typename T> struct Converter;

namespace Detail {

template<typename T> inline T* getPtrOrRef(const T* p) { return const_cast<T*>(p); }
template<typename T> inline T& getPtrOrRef(const T& p) { return const_cast<T&>(p); }
template<typename T> inline T* getPtrOrRef(const RefPtr<T>& p) { return p.get(); }
template<typename T> inline T& getPtrOrRef(const Ref<T>& p) { return p.get(); }

}

struct DefaultExceptionThrower {
    void operator()(JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& scope)
    {
        // If the converter already threw a more specific exception, don't override it
        if (!scope.exception()) {
            throwTypeError(&lexicalGlobalObject, scope);
        }
    }
};

template<typename T> typename Converter<T>::ReturnType convert(JSC::JSGlobalObject&, JSC::JSValue);
template<typename T> typename Converter<T>::ReturnType convert(JSC::JSGlobalObject&, JSC::JSValue, JSC::JSObject&);
template<typename T> typename Converter<T>::ReturnType convert(JSC::JSGlobalObject&, JSC::JSValue, JSDOMGlobalObject&);
template<typename T> typename Converter<T>::ReturnType convert(JSC::JSGlobalObject&, JSC::JSValue, ASCIILiteral functionName, ASCIILiteral argumentName);
template<typename T, typename ExceptionThrower> typename Converter<T>::ReturnType convert(JSC::JSGlobalObject&, JSC::JSValue, ExceptionThrower&&);
template<typename T, typename ExceptionThrower> typename Converter<T>::ReturnType convert(JSC::JSGlobalObject&, JSC::JSValue, JSC::JSObject&, ExceptionThrower&&);
template<typename T, typename ExceptionThrower> typename Converter<T>::ReturnType convert(JSC::JSGlobalObject&, JSC::JSValue, JSDOMGlobalObject&, ExceptionThrower&&);

template<typename T> inline typename Converter<T>::ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    return Converter<T>::convert(lexicalGlobalObject, value);
}

template<typename T> inline typename Converter<T>::ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSC::JSObject& thisObject)
{
    return Converter<T>::convert(lexicalGlobalObject, value, thisObject);
}

template<typename T> inline typename Converter<T>::ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSDOMGlobalObject& globalObject)
{
    return Converter<T>::convert(lexicalGlobalObject, value, globalObject);
}

template<typename T> inline typename Converter<T>::ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, ASCIILiteral functionName, ASCIILiteral argumentName)
{
    return Converter<T>::convert(lexicalGlobalObject, value, functionName, argumentName);
}

template<typename T, typename ExceptionThrower> inline typename Converter<T>::ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, ExceptionThrower&& exceptionThrower)
{
    return Converter<T>::convert(lexicalGlobalObject, value, std::forward<ExceptionThrower>(exceptionThrower));
}

template<typename T, typename ExceptionThrower> inline typename Converter<T>::ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSC::JSObject& thisObject, ExceptionThrower&& exceptionThrower)
{
    return Converter<T>::convert(lexicalGlobalObject, value, thisObject, std::forward<ExceptionThrower>(exceptionThrower));
}

template<typename T, typename ExceptionThrower> inline typename Converter<T>::ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSDOMGlobalObject& globalObject, ExceptionThrower&& exceptionThrower)
{
    return Converter<T>::convert(lexicalGlobalObject, value, globalObject, std::forward<ExceptionThrower>(exceptionThrower));
}

// Conversion from Implementation -> JSValue
template<typename T> struct JSConverter;

template<typename T, typename U> inline JSC::JSValue toJS(U&&);
template<typename T, typename U> inline JSC::JSValue toJS(JSC::JSGlobalObject&, U&&);
template<typename T, typename U> inline JSC::JSValue toJS(JSC::JSGlobalObject&, JSDOMGlobalObject&, U&&);
template<typename T, typename U> inline JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject&, JSDOMGlobalObject&, U&&);

template<typename T, typename U> inline JSC::JSValue toJS(JSC::JSGlobalObject&, JSC::ThrowScope&, U&& valueOrFunctor);
template<typename T, typename U> inline JSC::JSValue toJS(JSC::JSGlobalObject&, JSDOMGlobalObject&, JSC::ThrowScope&, U&& valueOrFunctor);
template<typename T, typename U> inline JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject&, JSDOMGlobalObject&, JSC::ThrowScope&, U&& valueOrFunctor);

template<typename T, bool needsState = JSConverter<T>::needsState, bool needsGlobalObject = JSConverter<T>::needsGlobalObject>
struct JSConverterOverloader;

template<typename T>
struct JSConverterOverloader<T, true, true> {
    template<typename U> static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, U&& value)
    {
        return JSConverter<T>::convert(lexicalGlobalObject, globalObject, std::forward<U>(value));
    }
};

template<typename T>
struct JSConverterOverloader<T, true, false> {
    template<typename U> static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, U&& value)
    {
        return JSConverter<T>::convert(lexicalGlobalObject, std::forward<U>(value));
    }

    template<typename U> static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject&, U&& value)
    {
        return JSConverter<T>::convert(lexicalGlobalObject, std::forward<U>(value));
    }
};

template<typename T>
struct JSConverterOverloader<T, false, false> {
    template<typename U> static JSC::JSValue convert(JSC::JSGlobalObject&, U&& value)
    {
        return JSConverter<T>::convert(std::forward<U>(value));
    }

    template<typename U> static JSC::JSValue convert(JSC::JSGlobalObject&, JSDOMGlobalObject&, U&& value)
    {
        return JSConverter<T>::convert(std::forward<U>(value));
    }
};

template<typename T, typename U> inline JSC::JSValue toJS(U&& value)
{
    return JSConverter<T>::convert(std::forward<U>(value));
}

template<typename T, typename U> inline JSC::JSValue toJS(JSC::JSGlobalObject& lexicalGlobalObject, U&& value)
{
    return JSConverterOverloader<T>::convert(lexicalGlobalObject, std::forward<U>(value));
}

template<typename T, typename U> inline JSC::JSValue toJS(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, U&& value)
{
    return JSConverterOverloader<T>::convert(lexicalGlobalObject, globalObject, std::forward<U>(value));
}

template<typename T, typename U> inline JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, U&& value)
{
    return JSConverter<T>::convertNewlyCreated(lexicalGlobalObject, globalObject, std::forward<U>(value));
}

template<typename T, typename U> inline JSC::JSValue toJS(JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& throwScope, U&& valueOrFunctor)
{
    if constexpr (std::is_invocable_v<U>) {
        using FunctorReturnType = std::invoke_result_t<U>;

        if constexpr (std::is_same_v<void, FunctorReturnType>) {
            valueOrFunctor();
            return JSC::jsUndefined();
        } else if constexpr (std::is_same_v<ExceptionOr<void>, FunctorReturnType>) {
            auto result = valueOrFunctor();
            if (UNLIKELY(result.hasException())) {
                propagateException(lexicalGlobalObject, throwScope, result.releaseException());
                return {};
            }
            return JSC::jsUndefined();
        } else
            return toJS<T>(lexicalGlobalObject, throwScope, valueOrFunctor());
    } else {
        if constexpr (IsExceptionOr<U>) {
            if (UNLIKELY(valueOrFunctor.hasException())) {
                propagateException(lexicalGlobalObject, throwScope, valueOrFunctor.releaseException());
                return {};
            }

            return toJS<T>(lexicalGlobalObject, valueOrFunctor.releaseReturnValue());
        } else
            return toJS<T>(lexicalGlobalObject, std::forward<U>(valueOrFunctor));
    }
}

template<typename T, typename U> inline JSC::JSValue toJS(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, JSC::ThrowScope& throwScope, U&& valueOrFunctor)
{
    if constexpr (std::is_invocable_v<U>) {
        using FunctorReturnType = std::invoke_result_t<U>;

        if constexpr (std::is_same_v<void, FunctorReturnType>) {
            valueOrFunctor();
            return JSC::jsUndefined();
        } else if constexpr (std::is_same_v<ExceptionOr<void>, FunctorReturnType>) {
            auto result = valueOrFunctor();
            if (UNLIKELY(result.hasException())) {
                propagateException(lexicalGlobalObject, throwScope, result.releaseException());
                return {};
            }
            return JSC::jsUndefined();
        } else
            return toJS<T>(lexicalGlobalObject, globalObject, throwScope, valueOrFunctor());
    } else {
        if constexpr (IsExceptionOr<U>) {
            if (UNLIKELY(valueOrFunctor.hasException())) {
                propagateException(lexicalGlobalObject, throwScope, valueOrFunctor.releaseException());
                return {};
            }

            return toJS<T>(lexicalGlobalObject, globalObject, valueOrFunctor.releaseReturnValue());
        } else
            return toJS<T>(lexicalGlobalObject, globalObject, std::forward<U>(valueOrFunctor));
    }
}

template<typename T, typename U> inline JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject& lexicalGlobalObject, WebCore::JSDOMGlobalObject& globalObject, JSC::ThrowScope& throwScope, U&& valueOrFunctor)
{
    if constexpr (std::is_invocable_v<U>) {
        using FunctorReturnType = std::invoke_result_t<U>;

        if constexpr (std::is_same_v<void, FunctorReturnType>) {
            valueOrFunctor();
            return JSC::jsUndefined();
        } else if constexpr (std::is_same_v<ExceptionOr<void>, FunctorReturnType>) {
            auto result = valueOrFunctor();
            if (UNLIKELY(result.hasException())) {
                propagateException(lexicalGlobalObject, throwScope, result.releaseException());
                return {};
            }
            return JSC::jsUndefined();
        } else
            return toJSNewlyCreated<T>(lexicalGlobalObject, globalObject, throwScope, valueOrFunctor());

    } else {
        if constexpr (IsExceptionOr<U>) {
            if (UNLIKELY(valueOrFunctor.hasException())) {
                propagateException(lexicalGlobalObject, throwScope, valueOrFunctor.releaseException());
                return {};
            }

            return toJSNewlyCreated<T>(lexicalGlobalObject, globalObject, valueOrFunctor.releaseReturnValue());
        } else
            return toJSNewlyCreated<T>(lexicalGlobalObject, globalObject, std::forward<U>(valueOrFunctor));
    }
}

template<typename T> struct DefaultConverter {
    using ReturnType = typename T::ImplementationType;

    // We assume the worst, subtypes can override to be less pessimistic.
    // An example of something that can have side effects
    // is having a converter that does JSC::JSValue::toNumber.
    // toNumber() in JavaScript can call arbitrary JS functions.
    //
    // An example of something that does not have side effects
    // is something having a converter that does JSC::JSValue::toBoolean.
    // toBoolean() in JS can't call arbitrary functions.
    static constexpr bool conversionHasSideEffects = true;
};

// Conversion from JSValue -> Implementation for variadic arguments
template<typename IDLType> struct VariadicConverter;

} // namespace WebCore
