/*
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

#include "ProcessQualified.h"
#include <wtf/Forward.h>
#include <wtf/UUID.h>

namespace WebCore {

template <>
class ProcessQualified<WTF::UUID> {
public:
    static ProcessQualified generate() { return { WTF::UUID::createVersion4Weak(), Process::identifier() }; }

    ProcessQualified(WTF::UUID object, ProcessIdentifier processIdentifier)
        : m_object(WTF::move(object))
        , m_processIdentifier(processIdentifier)
    {
    }

    ProcessQualified(WTF::HashTableDeletedValueType)
        : m_object(WTF::HashTableDeletedValue)
        , m_processIdentifier(WTF::HashTableDeletedValue)
    {
    }

    explicit operator bool() const { return !!m_object; }

    const WTF::UUID& object() const LIFETIME_BOUND { return m_object; }
    ProcessIdentifier processIdentifier() const { return m_processIdentifier; }

    bool isHashTableDeletedValue() const { return m_processIdentifier.isHashTableDeletedValue(); }

    friend bool operator==(const ProcessQualified&, const ProcessQualified&) = default;

    String toString() const { return m_object.toString(); }

    template<typename Encoder> void encode(Encoder& encoder) const { encoder << m_object << m_processIdentifier; }
    template<typename Decoder> static std::optional<ProcessQualified> decode(Decoder&);

private:
    WTF::UUID m_object;
    ProcessIdentifier m_processIdentifier;
};

inline void add(Hasher& hasher, const ProcessQualified<WTF::UUID>& uuid)
{
    // Since UUIDs are unique on their own, optimize by not hashing the process identifier.
    add(hasher, uuid.object());
}

template<typename Decoder> std::optional<ProcessQualified<WTF::UUID>> ProcessQualified<WTF::UUID>::decode(Decoder& decoder)
{
    std::optional<WTF::UUID> object;
    decoder >> object;
    if (!object)
        return std::nullopt;
    std::optional<ProcessIdentifier> processIdentifier;
    decoder >> processIdentifier;
    if (!processIdentifier)
        return std::nullopt;
    return { { *object, *processIdentifier } };
}

template <>
inline TextStream& operator<<(TextStream& ts, const ProcessQualified<WTF::UUID>& processQualified)
{
    ts << "ProcessQualified("_s << processQualified.processIdentifier().toUInt64() << '-' << processQualified.object().toString() << ')';
    return ts;
}

using ScriptExecutionContextIdentifier = ProcessQualified<WTF::UUID>;

} // namespace WebCore

namespace WTF {


template<>
struct MarkableTraits<WebCore::ProcessQualified<UUID>> {
    static bool isEmptyValue(const WebCore::ProcessQualified<UUID>& identifier) { return MarkableTraits<UUID>::isEmptyValue(identifier.object()); }
    static WebCore::ProcessQualified<UUID> emptyValue() { return { MarkableTraits<UUID>::emptyValue(), MarkableTraits<WebCore::ProcessIdentifier>::emptyValue() }; }
};

} // namespace WTF
