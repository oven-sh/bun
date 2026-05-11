/*
 * Copyright (C) 2016 Igalia S.L.
 * Copyright (C) 2021 Apple Inc. All rights reserved.
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

#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/ArrayBufferView.h>
#include <wtf/RefPtr.h>
#include <variant>

namespace WebCore {

class BufferSource {
public:
    using VariantType = std::variant<RefPtr<JSC::ArrayBufferView>, RefPtr<JSC::ArrayBuffer>>;

    BufferSource() {}
    BufferSource(VariantType&& variant)
        : m_variant(WTF::move(variant))
    {
    }

    const VariantType& variant() const { return m_variant; }

    const uint8_t* data() const
    {
        return std::visit([](auto& buffer) -> const uint8_t* {
            return buffer ? static_cast<const uint8_t*>(buffer->data()) : nullptr;
        },
            m_variant);
    }

    void* mutableData() const
    {
        return std::visit([](auto& buffer) -> void* {
            return buffer->data();
        },
            m_variant);
    }

    size_t length() const
    {
        return std::visit([](auto& buffer) -> size_t {
            return buffer ? buffer->byteLength() : 0;
        },
            m_variant);
    }

    template<class Encoder> void encode(Encoder&) const;
    template<class Decoder> static std::optional<BufferSource> decode(Decoder&);

private:
    VariantType m_variant;
};

template<class Encoder>
void BufferSource::encode(Encoder& encoder) const
{
    encoder << static_cast<uint64_t>(length());
    if (!length())
        return;

    encoder.encodeFixedLengthData(data(), length() * sizeof(uint8_t), alignof(uint8_t));
}

template<class Decoder>
std::optional<BufferSource> BufferSource::decode(Decoder& decoder)
{
    std::optional<uint64_t> size;
    decoder >> size;
    if (!size)
        return std::nullopt;
    if (!*size)
        return BufferSource();

    auto dataSize = CheckedSize { *size };
    if (dataSize.hasOverflowed()) [[unlikely]]
        return std::nullopt;

    const uint8_t* data = decoder.decodeFixedLengthReference(dataSize, alignof(uint8_t));
    if (!data)
        return std::nullopt;
    return BufferSource(JSC::ArrayBuffer::tryCreate({ static_cast<const uint8_t*>(data), dataSize.value() }));
}

inline BufferSource toBufferSource(const uint8_t* data, size_t length)
{
    return BufferSource(JSC::ArrayBuffer::tryCreate({ data, length }));
}

} // namespace WebCore
