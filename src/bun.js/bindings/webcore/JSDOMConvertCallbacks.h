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

template<typename T> struct Converter<IDLCallbackFunction<T>> : DefaultConverter<IDLCallbackFunction<T>> {

    static constexpr bool conversionHasSideEffects = false;

    template<typename ExceptionThrower = DefaultExceptionThrower>
    static RefPtr<T> convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSDOMGlobalObject& globalObject, ExceptionThrower&& exceptionThrower = ExceptionThrower())
    {
        JSC::VM& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        if (!value.isCallable()) {
            exceptionThrower(lexicalGlobalObject, scope);
            return nullptr;
        }

        return T::create(JSC::asObject(value), &globalObject);
    }

    template<typename ExceptionThrower = DefaultExceptionThrower>
    static RefPtr<T> convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, ExceptionThrower&& exceptionThrower = ExceptionThrower())
    {
        JSC::VM& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        if (!value.isCallable()) {
            exceptionThrower(lexicalGlobalObject, scope);
            return nullptr;
        }

        return T::create(vm, JSC::asObject(value));
    }
};

template<typename T> struct JSConverter<IDLCallbackFunction<T>> {
    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    template<typename U>
    static JSC::JSValue convert(const U& value)
    {
        return toJS(Detail::getPtrOrRef(value));
    }

    template<typename U>
    static JSC::JSValue convertNewlyCreated(U&& value)
    {
        return toJSNewlyCreated(std::forward<U>(value));
    }
};

template<typename T> struct Converter<IDLCallbackInterface<T>> : DefaultConverter<IDLCallbackInterface<T>> {
    template<typename ExceptionThrower = DefaultExceptionThrower>
    static RefPtr<T> convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSDOMGlobalObject& globalObject, ExceptionThrower&& exceptionThrower = ExceptionThrower())
    {
        JSC::VM& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        if (!value.isObject()) {
            exceptionThrower(lexicalGlobalObject, scope);
            return nullptr;
        }

        return T::create(JSC::asObject(value), &globalObject);
    }
};

template<typename T> struct JSConverter<IDLCallbackInterface<T>> {
    static constexpr bool needsState = false;
    static constexpr bool needsGlobalObject = false;

    template<typename U>
    static JSC::JSValue convert(const U& value)
    {
        return toJS(Detail::getPtrOrRef(value));
    }

    template<typename U>
    static JSC::JSValue convertNewlyCreated(U&& value)
    {
        return toJSNewlyCreated(std::forward<U>(value));
    }
};

} // namespace WebCore
