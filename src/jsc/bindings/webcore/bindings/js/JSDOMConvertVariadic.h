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
#include <JavaScriptCore/CallFrame.h>
#include <wtf/FixedVector.h>

namespace WebCore {

template<typename IDL>
struct VariadicConverter {
    using Item = typename IDL::ImplementationType;

    static std::optional<Item> convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        auto result = WebCore::convert<IDL>(lexicalGlobalObject, value);
        if (result.hasException(scope)) [[unlikely]]
            return std::nullopt;

        return result.releaseReturnValue();
    }
};

template<typename IDL> using VariadicItem = typename VariadicConverter<IDL>::Item;
template<typename IDL> using VariadicArguments = FixedVector<VariadicItem<IDL>>;

template<typename IDL>
VariadicArguments<IDL> convertVariadicArguments(JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame& callFrame, size_t startIndex)
{
    auto& vm = JSC::getVM(&lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    size_t length = callFrame.argumentCount();
    if (startIndex >= length)
        return { };

    auto result = VariadicArguments<IDL>::createWithSizeFromFailableGenerator(length - startIndex, [&](size_t i) -> std::optional<VariadicItem<IDL>> {
        auto result = VariadicConverter<IDL>::convert(lexicalGlobalObject, callFrame.uncheckedArgument(i + startIndex));
        RETURN_IF_EXCEPTION(scope, std::nullopt);

        return result;
    });

    RETURN_IF_EXCEPTION(scope, VariadicArguments<IDL> { });
    return result;
}

} // namespace WebCore
