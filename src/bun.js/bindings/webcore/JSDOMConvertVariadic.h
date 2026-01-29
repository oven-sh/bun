/*
 * Copyright (C) 2016-2021 Apple Inc. All rights reserved.
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
#include <wtf/FixedVector.h>

namespace WebCore {

template<typename IDLType>
struct VariadicConverter {
    using Item = typename IDLType::ImplementationType;

    static std::optional<Item> convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        auto result = Converter<IDLType>::convert(lexicalGlobalObject, value);
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        return result;
    }
};

template<typename IDLType> FixedVector<typename VariadicConverter<IDLType>::Item> convertVariadicArguments(JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame& callFrame, size_t startIndex)
{
    auto& vm = JSC::getVM(&lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    size_t length = callFrame.argumentCount();
    if (startIndex >= length)
        return {};

    FixedVector<typename VariadicConverter<IDLType>::Item> result(length - startIndex);

    size_t resultIndex = 0;
    for (size_t i = startIndex; i < length; ++i) {
        auto value = VariadicConverter<IDLType>::convert(lexicalGlobalObject, callFrame.uncheckedArgument(i));
        ASSERT_UNUSED(scope, !!scope.exception() == !value);
        if (!value)
            return {};
        result[resultIndex] = WTF::move(*value);
        resultIndex++;
    }

    return result;
}

} // namespace WebCore
