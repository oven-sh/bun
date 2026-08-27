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

#include "BufferSource.h"
#include "IDLTypes.h"
#include "JSDOMConvertBase.h"
#include "JSDOMWrapperCache.h"
#include <JavaScriptCore/JSTypedArrays.h>

namespace WebCore {

struct IDLUint8Array : IDLTypedArray<JSC::Uint8Array> {
};

inline JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, JSC::ArrayBuffer& buffer)
{
    if (auto result = getCachedWrapper(globalObject->world(), buffer))
        return result;

    // The JSArrayBuffer::create function will register the wrapper in finishCreation.
    return JSC::JSArrayBuffer::create(JSC::getVM(lexicalGlobalObject), lexicalGlobalObject->arrayBufferStructure(buffer.sharingMode()), &buffer);
}

inline JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSGlobalObject* globalObject, JSC::ArrayBufferView& view)
{
    return view.wrap(lexicalGlobalObject, globalObject);
}

inline JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, JSC::ArrayBuffer* buffer)
{
    if (!buffer)
        return JSC::jsNull();
    return toJS(lexicalGlobalObject, globalObject, *buffer);
}

inline JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSGlobalObject* globalObject, JSC::ArrayBufferView* view)
{
    if (!view)
        return JSC::jsNull();
    return toJS(lexicalGlobalObject, globalObject, *view);
}

inline RefPtr<JSC::ArrayBufferView> toPossiblySharedArrayBufferView(JSC::VM&, JSC::JSValue value)
{
    auto* wrapper = dynamicDowncast<JSC::JSArrayBufferView>(value);
    if (!wrapper)
        return nullptr;
    return wrapper->possiblySharedImpl();
}

namespace Detail {

template<typename BufferSourceType>
struct BufferSourceConverter {
    using WrapperType = typename Converter<BufferSourceType>::WrapperType;
    using ReturnType = typename Converter<BufferSourceType>::ReturnType;

    template<typename ExceptionThrower = DefaultExceptionThrower>
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, ExceptionThrower&& exceptionThrower = ExceptionThrower())
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        ReturnType object = WrapperType::toWrapped(vm, value);
        if (!object) [[unlikely]]
            exceptionThrower(lexicalGlobalObject, scope);
        return object;
    }
};

}

template<> struct Converter<IDLArrayBuffer> : DefaultConverter<IDLArrayBuffer> {
    using WrapperType = JSC::JSArrayBuffer;
    using ReturnType = JSC::ArrayBuffer*;

    template<typename ExceptionThrower = DefaultExceptionThrower>
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, ExceptionThrower&& exceptionThrower = ExceptionThrower())
    {
        return Detail::BufferSourceConverter<IDLArrayBuffer>::convert(lexicalGlobalObject, value, std::forward<ExceptionThrower>(exceptionThrower));
    }
};

template<> struct JSConverter<IDLArrayBuffer> {
    static constexpr bool needsState = true;
    static constexpr bool needsGlobalObject = true;

    template<typename U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const U& value)
    {
        return toJS(&lexicalGlobalObject, &globalObject, Detail::getPtrOrRef(value));
    }
};

template<> struct Converter<IDLUint8Array> : DefaultConverter<IDLUint8Array> {
    using WrapperType = JSC::JSUint8Array;
    using ReturnType = RefPtr<JSC::Uint8Array>;

    template<typename ExceptionThrower = DefaultExceptionThrower>
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, ExceptionThrower&& exceptionThrower = ExceptionThrower())
    {
        return Detail::BufferSourceConverter<IDLUint8Array>::convert(lexicalGlobalObject, value, std::forward<ExceptionThrower>(exceptionThrower));
    }
};

template<> struct JSConverter<IDLUint8Array> {
    static constexpr bool needsState = true;
    static constexpr bool needsGlobalObject = true;

    template<typename U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const U& value)
    {
        return toJS(&lexicalGlobalObject, &globalObject, Detail::getPtrOrRef(value));
    }

    template<typename U>
    static JSC::JSValue convertNewlyCreated(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, U&& value)
    {
        return convert(lexicalGlobalObject, globalObject, std::forward<U>(value));
    }
};

template<> struct Converter<IDLArrayBufferView> : DefaultConverter<IDLArrayBufferView> {
    using WrapperType = JSC::JSArrayBufferView;
    using ReturnType = RefPtr<JSC::ArrayBufferView>;

    template<typename ExceptionThrower = DefaultExceptionThrower>
    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, ExceptionThrower&& exceptionThrower = ExceptionThrower())
    {
        return Detail::BufferSourceConverter<IDLArrayBufferView>::convert(lexicalGlobalObject, value, std::forward<ExceptionThrower>(exceptionThrower));
    }
};

template<> struct JSConverter<IDLArrayBufferView> {
    static constexpr bool needsState = true;
    static constexpr bool needsGlobalObject = true;

    template<typename U>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const U& value)
    {
        return toJS(&lexicalGlobalObject, &globalObject, Detail::getPtrOrRef(value));
    }
};

} // namespace WebCore
