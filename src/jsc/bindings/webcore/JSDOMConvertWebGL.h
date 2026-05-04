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

#if ENABLE(WEBGL)

#include "IDLTypes.h"
#include "JSDOMConvertBase.h"

namespace WebCore {

JSC::JSValue convertToJSValue(JSC::JSGlobalObject&, JSDOMGlobalObject&, const WebGLAny&);
JSC::JSValue convertToJSValue(JSC::JSGlobalObject&, JSDOMGlobalObject&, WebGLExtension&);

inline JSC::JSValue convertToJSValue(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, WebGLExtension* extension)
{
    if (!extension)
        return JSC::jsNull();
    return convertToJSValue(lexicalGlobalObject, globalObject, *extension);
}

template<> struct JSConverter<IDLWebGLAny> {
    static constexpr bool needsState = true;
    static constexpr bool needsGlobalObject = true;

    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const WebGLAny& value)
    {
        return convertToJSValue(lexicalGlobalObject, globalObject, value);
    }
};

template<> struct JSConverter<IDLWebGLExtension> {
    static constexpr bool needsState = true;
    static constexpr bool needsGlobalObject = true;

    template<typename T>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const T& value)
    {
        return convertToJSValue(lexicalGlobalObject, globalObject, Detail::getPtrOrRef(value));
    }
};

} // namespace WebCore

#endif
