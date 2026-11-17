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

namespace WebCore {

// Specialized by generated code for IDL dictionary conversion.
template<typename T> T convertDictionary(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value);

// nullptr for undefined and null, and after throwing for any other primitive.
ALWAYS_INLINE JSC::JSObject* dictionaryObject(JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& throwScope, JSC::JSValue value)
{
    auto* object = value.getObject();
    if (!object && !value.isUndefinedOrNull()) [[unlikely]]
        JSC::throwTypeError(&lexicalGlobalObject, throwScope);
    return object;
}

// Leaves `member` at its default if `object[name]` is undefined.
template<typename IDL, typename T>
ALWAYS_INLINE void convertDictionaryMember(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSObject& object, JSC::PropertyName name, T& member)
{
    auto throwScope = DECLARE_THROW_SCOPE(JSC::getVM(&lexicalGlobalObject));
    JSC::JSValue value = object.get(&lexicalGlobalObject, name);
    RETURN_IF_EXCEPTION(throwScope, );
    if (value.isUndefined())
        return;
    throwScope.release();
    member = convert<IDL>(lexicalGlobalObject, value);
}

template<typename T> struct Converter<IDLDictionary<T>> : DefaultConverter<IDLDictionary<T>> {
    using ReturnType = T;

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return convertDictionary<T>(lexicalGlobalObject, value);
    }
};

template<typename T> struct JSConverter<IDLDictionary<T>> {
    static constexpr bool needsState = true;
    static constexpr bool needsGlobalObject = true;

    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const T& dictionary)
    {
        return convertDictionaryToJS(lexicalGlobalObject, globalObject, dictionary);
    }
};

} // namespace WebCore
