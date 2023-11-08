/*
 * Copyright (C) 2019 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include <wtf/text/WTFString.h>

namespace WebCore {

struct ExceptionDetails {
    enum class Type : uint8_t {
        Script,
        InvalidTargetFrame,
        AppBoundDomain,
    };

    String message;
    int lineNumber { 0 };
    int columnNumber { 0 };
    Type type { Type::Script };

    // This bizarre explicit initialization of String is because older compilers (like on High Sierra)
    // don't properly handle partial initialization lists unless every struct member has an explicit default value.
    // Once we stop building on those platforms we can remove this.
    String sourceURL {};
};

} // namespace WebCore

namespace WTF {
template<> struct EnumTraits<WebCore::ExceptionDetails::Type> {
    using values = EnumValues<
        WebCore::ExceptionDetails::Type,
        WebCore::ExceptionDetails::Type::Script,
        WebCore::ExceptionDetails::Type::InvalidTargetFrame,
        WebCore::ExceptionDetails::Type::AppBoundDomain>;
};
}
