/*
 * Copyright (C) 2004-2020 Apple Inc. All rights reserved.
 * Copyright (C) 2006 Alexey Proskuryakov <ap@nypop.com>
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

#include "UnencodableHandling.h"
#include <array>
#include <memory>
#include <span>
#include <unicode/umachine.h>
#include <wtf/Forward.h>
#include <wtf/Noncopyable.h>
#include <wtf/TZoneMalloc.h>

namespace PAL {

class TextEncoding;

using UnencodableReplacementArray = std::array<char, 32>;

class TextCodec {
    WTF_MAKE_TZONE_ALLOCATED(TextCodec);
    WTF_MAKE_NONCOPYABLE(TextCodec);

public:
    TextCodec() = default;
    virtual ~TextCodec() = default;

    virtual void stripByteOrderMark() {}
    virtual String decode(std::span<const uint8_t> data, bool flush, bool stopOnError, bool& sawError) = 0;

    virtual Vector<uint8_t> encode(StringView, UnencodableHandling) const = 0;

    // Fills a null-terminated string representation of the given
    // unencodable character into the given replacement buffer.
    // The length of the string (not including the null) will be returned.
    static std::span<char> getUnencodableReplacement(char32_t, UnencodableHandling, UnencodableReplacementArray& replacement LIFETIME_BOUND);
};

Function<void(char32_t, Vector<uint8_t>&)> unencodableHandler(UnencodableHandling);

using EncodingNameRegistrar = void (*)(ASCIILiteral alias, ASCIILiteral name);

using NewTextCodecFunction = Function<std::unique_ptr<TextCodec>()>;
using TextCodecRegistrar = void (*)(ASCIILiteral name, NewTextCodecFunction&&);

} // namespace PAL
