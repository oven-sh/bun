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

#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/GetVM.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include "IDLTypes.h"
#include "JSDOMConvertBase.h"
#include "JSDOMGlobalObject.h"

namespace WebCore {

template<typename ImplementationClass> struct JSDOMWrapperConverterTraits;

template<typename T, typename Enable = void>
struct JSToWrappedOverloader {
    using ReturnType = typename JSDOMWrapperConverterTraits<T>::ToWrappedReturnType;
    using WrapperType = typename JSDOMWrapperConverterTraits<T>::WrapperClass;

    static ReturnType toWrapped(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return WrapperType::toWrapped(JSC::getVM(&lexicalGlobalObject), value);
    }
};

template<typename T>
    requires JSDOMWrapperConverterTraits<T>::needsState
struct JSToWrappedOverloader<T> {
    using ReturnType = typename JSDOMWrapperConverterTraits<T>::ToWrappedReturnType;
    using WrapperType = typename JSDOMWrapperConverterTraits<T>::WrapperClass;

    static ReturnType toWrapped(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return WrapperType::toWrapped(lexicalGlobalObject, value);
    }
};

template<typename T> struct Converter<IDLInterface<T>> : DefaultConverter<IDLInterface<T>> {
    using Result = ConversionResult<IDLInterface<T>>;

    template<typename ExceptionThrower = DefaultExceptionThrower>
    static Result convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, NOESCAPE ExceptionThrower&& exceptionThrower = ExceptionThrower())
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        RefPtr object = JSToWrappedOverloader<T>::toWrapped(lexicalGlobalObject, value);
        if (!object) [[unlikely]] {
            exceptionThrower(lexicalGlobalObject, scope);
            return Result::exception();
        }

        return Result { object.releaseNonNull() };
    }
};

template<typename T> struct JSConverter<IDLInterface<T>> {
    static constexpr bool needsState = true;
    static constexpr bool needsGlobalObject = true;

    template<std::derived_from<T> U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, U& value)
    {
        return toJS(&lexicalGlobalObject, &globalObject, Ref<T>(value));
    }

    template<std::derived_from<T> U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const U& value)
    {
        return toJS(&lexicalGlobalObject, &globalObject, Ref<T>(const_cast<U&>(value)));
    }

    template<std::derived_from<T> U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, std::reference_wrapper<U> value)
    {
        return toJS(&lexicalGlobalObject, &globalObject, Ref<T>(value.get()));
    }

    template<std::derived_from<T> U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, Ref<U>& value)
    {
        return toJS(&lexicalGlobalObject, &globalObject, value);
    }

    template<std::derived_from<T> U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const Ref<U>& value)
    {
        return toJS(&lexicalGlobalObject, &globalObject, const_cast<Ref<U>&>(value));
    }

    template<std::derived_from<T> U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, Ref<U>&& value)
    {
        return toJS(&lexicalGlobalObject, &globalObject, WTF::move(value));
    }

    // Bun's older bindings pass pointers. Null becomes `null`.
    template<std::derived_from<T> U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, U* value)
    {
        if (!value)
            return JSC::jsNull();
        return toJS(&lexicalGlobalObject, &globalObject, Ref<T>(*value));
    }

    template<std::derived_from<T> U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const RefPtr<U>& value)
    {
        return convert(lexicalGlobalObject, globalObject, value.get());
    }

    template<std::derived_from<T> U>
    static JSC::JSValue convertNewlyCreated(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, U& value)
    {
        return toJSNewlyCreated(&lexicalGlobalObject, &globalObject, Ref<T>(value));
    }

    template<std::derived_from<T> U>
    static JSC::JSValue convertNewlyCreated(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const U& value)
    {
        return toJSNewlyCreated(&lexicalGlobalObject, &globalObject, Ref<T>(const_cast<U&>(value)));
    }

    template<std::derived_from<T> U>
    static JSC::JSValue convertNewlyCreated(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, std::reference_wrapper<U> value)
    {
        return toJSNewlyCreated(&lexicalGlobalObject, &globalObject, Ref<T>(value.get()));
    }

    template<std::derived_from<T> U>
    static JSC::JSValue convertNewlyCreated(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, Ref<U>& value)
    {
        return toJSNewlyCreated(&lexicalGlobalObject, &globalObject, value);
    }

    template<std::derived_from<T> U>
    static JSC::JSValue convertNewlyCreated(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const Ref<U>& value)
    {
        return toJSNewlyCreated(&lexicalGlobalObject, &globalObject, const_cast<Ref<U>&>(value));
    }

    template<std::derived_from<T> U>
    static JSC::JSValue convertNewlyCreated(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, Ref<U>&& value)
    {
        return toJSNewlyCreated(&lexicalGlobalObject, &globalObject, WTF::move(value));
    }
};

template<typename T> struct VariadicConverter<IDLInterface<T>> {
    using Item = std::reference_wrapper<T>;

    static std::optional<Item> convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        auto result = WebCore::convert<IDLInterface<T>>(lexicalGlobalObject, value);
        if (result.hasException(scope)) [[unlikely]]
            return std::nullopt;

        return Item { result.releaseReturnValue() };
    }
};

} // namespace WebCore
