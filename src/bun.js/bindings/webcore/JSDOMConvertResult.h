/*
 * Copyright (C) 2024 Apple Inc. All rights reserved.
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

#include <JavaScriptCore/ExceptionScope.h>
#include <functional>
#include <type_traits>
#include <utility>
#include <wtf/Expected.h>

namespace WebCore {

template<typename T> struct Converter;

template<typename IDL> class ConversionResult;

struct ConversionResultException {};

namespace Detail {

template<typename T>
struct ConversionResultStorage {
    using ReturnType = T;
    using Type = T;

    ConversionResultStorage(ConversionResultException token)
        : value(makeUnexpected(token))
    {
    }
    ConversionResultStorage(const Type& value)
        : value(value)
    {
    }
    ConversionResultStorage(Type&& value)
        : value(WTF::move(value))
    {
    }

    template<typename U>
    ConversionResultStorage(ConversionResultStorage<U>&& other)
        : value([&]() -> Expected<Type, ConversionResultException> {
            if (other.hasException())
                return makeUnexpected(ConversionResultException());
            return ReturnType { other.releaseReturnValue() };
        }())
    {
    }

    template<typename U>
        requires(std::is_pointer_v<Type> && std::is_lvalue_reference_v<U>)
    ConversionResultStorage(ConversionResultStorage<U>&& other)
        : value([&]() -> Expected<Type, ConversionResultException> {
            if (other.hasException())
                return makeUnexpected(ConversionResultException());
            return ReturnType { &other.releaseReturnValue() };
        }())
    {
    }

    bool hasException() const
    {
        return !value.has_value();
    }

    ReturnType& returnValue()
    {
        ASSERT(!wasReleased);
        return value.value();
    }

    const ReturnType& returnValue() const
    {
        ASSERT(!wasReleased);
        return value.value();
    }

    ReturnType releaseReturnValue()
    {
        ASSERT(!std::exchange(wasReleased, true));
        return WTF::move(value.value());
    }

    Expected<Type, ConversionResultException> value;
#if ASSERT_ENABLED
    bool wasReleased { false };
#endif
};

template<typename T>
struct ConversionResultStorage<T&> {
    using ReturnType = T&;
    using Type = T;

    ConversionResultStorage(ConversionResultException token)
        : value(makeUnexpected(token))
    {
    }
    ConversionResultStorage(Type& value)
        : value(std::reference_wrapper<Type> { value })
    {
    }

    template<typename U>
    ConversionResultStorage(ConversionResultStorage<U>&& other)
        : value([&]() -> Expected<std::reference_wrapper<Type>, ConversionResultException> {
            if (other.hasException())
                return makeUnexpected(ConversionResultException());
            return static_cast<ReturnType>(other.releaseReturnValue());
        }())
    {
    }

    bool hasException() const
    {
        return !value.has_value();
    }

    Type& returnValue()
    {
        ASSERT(!wasReleased);
        return value.value().get();
    }

    const Type& returnValue() const
    {
        ASSERT(!wasReleased);
        return value.value().get();
    }

    Type& releaseReturnValue()
    {
        ASSERT(!std::exchange(wasReleased, true));
        return WTF::move(value.value()).get();
    }

    Expected<std::reference_wrapper<Type>, ConversionResultException> value;
#if ASSERT_ENABLED
    bool wasReleased { false };
#endif
};

} // namespace Detail

template<typename T>
class ConversionResult {
public:
    using IDL = T;
    using ReturnType = typename Converter<IDL>::ReturnType;

    static ConversionResult exception() { return ConversionResult(ConversionResultException()); }

    ConversionResult(ConversionResultException token)
        : m_storage { token }
    {
    }

    ConversionResult(const ReturnType& returnValue)
        : m_storage { returnValue }
    {
    }

    ConversionResult(ReturnType&& returnValue)
        requires(!std::is_lvalue_reference_v<ReturnType>)
        : m_storage { WTF::move(returnValue) }
    {
    }

    ConversionResult(std::nullptr_t)
        requires std::is_same_v<decltype(IDL::nullValue()), std::nullptr_t>
        : m_storage { nullptr }
    {
    }

    ConversionResult(std::nullopt_t)
        requires std::is_same_v<decltype(IDL::nullValue()), std::nullopt_t>
        : m_storage { std::nullopt }
    {
    }

    template<typename OtherIDL>
    ConversionResult(ConversionResult<OtherIDL>&& other)
        : m_storage { WTF::move(other.m_storage) }
    {
    }

    bool hasException(JSC::ExceptionScope& scope) const
    {
        EXCEPTION_ASSERT(!!scope.exception() == scope.vm().traps().needHandling(JSC::VMTraps::NeedExceptionHandling));

#if ENABLE(EXCEPTION_SCOPE_VERIFICATION)
        if (m_storage.hasException()) {
            EXCEPTION_ASSERT(scope.vm().traps().maybeNeedHandling() && scope.vm().hasExceptionsAfterHandlingTraps());
            return true;
        }
        return false;
#else
        UNUSED_PARAM(scope);
        return m_storage.hasException();
#endif
    }

    decltype(auto) returnValue()
    {
        ASSERT(!m_storage.hasException());
        return m_storage.returnValue();
    }
    decltype(auto) returnValue() const
    {
        ASSERT(!m_storage.hasException());
        return m_storage.returnValue();
    }
    decltype(auto) releaseReturnValue()
    {
        ASSERT(!m_storage.hasException());
        return m_storage.releaseReturnValue();
    }

    // Transitional shim — lets existing call sites that do `auto x = convert<>(); RETURN_IF_EXCEPTION(scope, {}); use(WTF::move(x))`
    // compile unchanged. The exception check via RETURN_IF_EXCEPTION inspects the scope directly, so by the
    // time this fires the result is known-valid. Remove once call sites migrate to hasException()/releaseReturnValue().
    operator ReturnType() &&
        requires(!std::is_lvalue_reference_v<ReturnType>)
    {
        return releaseReturnValue();
    }

    operator ReturnType() &
        requires(!std::is_lvalue_reference_v<ReturnType>)
    {
        return m_storage.returnValue();
    }

    operator ReturnType()
        requires std::is_lvalue_reference_v<ReturnType>
    {
        return m_storage.returnValue();
    }

private:
    template<typename> friend class ConversionResult;

    Detail::ConversionResultStorage<ReturnType> m_storage;
};

} // namespace WebCore
