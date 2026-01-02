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

#include <wtf/text/StringView.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

template<typename> class ExceptionOr;

enum class BaseURLStringType : bool;
enum class EncodingCallbackType : uint8_t { Protocol,
    Username,
    Password,
    Host,
    IPv6Host,
    Port,
    Path,
    OpaquePath,
    Search,
    Hash };

bool isAbsolutePathname(StringView input, BaseURLStringType inputType);
ExceptionOr<String> canonicalizeProtocol(StringView, BaseURLStringType valueType);
String canonicalizeUsername(StringView value, BaseURLStringType valueType);
String canonicalizePassword(StringView value, BaseURLStringType valueType);
ExceptionOr<String> canonicalizeHostname(StringView value, BaseURLStringType valueType);
ExceptionOr<String> canonicalizeIPv6Hostname(StringView value, BaseURLStringType valueType);
ExceptionOr<String> canonicalizePort(StringView portValue, StringView protocolValue, BaseURLStringType portValueType);
ExceptionOr<String> processPathname(StringView pathnameValue, const StringView protocolValue, BaseURLStringType pathnameValueType);
ExceptionOr<String> canonicalizePathname(StringView pathnameValue);
ExceptionOr<String> canonicalizeOpaquePathname(StringView value);
ExceptionOr<String> canonicalizeSearch(StringView value, BaseURLStringType valueType);
ExceptionOr<String> canonicalizeHash(StringView value, BaseURLStringType valueType);
ExceptionOr<String> callEncodingCallback(EncodingCallbackType, StringView input);
}
