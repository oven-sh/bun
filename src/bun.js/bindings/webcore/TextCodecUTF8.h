/*
 * Copyright (C) 2011-2020 Apple Inc. All rights reserved.
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

#include "TextCodec.h"
#include <unicode/utf8.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/text/LChar.h>

namespace PAL {

class TextCodecUTF8 final : public TextCodec {
    WTF_MAKE_TZONE_ALLOCATED(TextCodecUTF8);
public:
    static void registerEncodingNames(EncodingNameRegistrar);
    static void registerCodecs(TextCodecRegistrar);

    static Vector<uint8_t> encodeUTF8(StringView);
    static std::unique_ptr<TextCodecUTF8> codec();

private:
    void stripByteOrderMark() final { m_shouldStripByteOrderMark = true; }
    String decode(std::span<const uint8_t>, bool flush, bool stopOnError, bool& sawError) final;
    Vector<uint8_t> encode(StringView, UnencodableHandling) const final;

    bool handlePartialSequence(std::span<LChar>& destination, std::span<const uint8_t>& source, bool flush);
    void handlePartialSequence(std::span<UChar>& destination, std::span<const uint8_t>& source, bool flush, bool stopOnError, bool& sawError);
    void consumePartialSequenceByte();

    int m_partialSequenceSize { 0 };
    std::array<uint8_t, U8_MAX_LENGTH> m_partialSequence;
    bool m_shouldStripByteOrderMark { false };
};

} // namespace PAL
