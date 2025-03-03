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

#include "JSCustomXPathNSResolver.h"
#include "JSXPathNSResolver.h"

namespace WebCore {

template<> struct Converter<IDLInterface<XPathNSResolver>> : DefaultConverter<IDLInterface<XPathNSResolver>> {
    template<typename ExceptionThrower = DefaultExceptionThrower>
    static RefPtr<XPathNSResolver> convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, ExceptionThrower&& exceptionThrower = ExceptionThrower())
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (!value.isObject()) {
            exceptionThrower(lexicalGlobalObject, scope);
            return nullptr;
        }

        auto object = asObject(value);
        if (object->inherits<JSXPathNSResolver>())
            return &JSC::jsCast<JSXPathNSResolver*>(object)->wrapped();

        return JSCustomXPathNSResolver::create(vm, object);
    }
};

} // namespace WebCore
