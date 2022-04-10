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

#include <optional>

#if HAVE(TASK_IDENTITY_TOKEN)
#include <wtf/MachSendRight.h>
#else
#include <variant>
#endif

namespace WebCore {

// Object to access proof of process identity.
// ProcessIdentifier identifies a process.
// ProcessIdentity grants access to the identity.
// Empty ProcessIdentity does not do anything.
class ProcessIdentity {
public:
    // Creates an process identity for current process or empty on error.
    enum CurrentProcessTag { CurrentProcess };
    WEBCORE_EXPORT explicit ProcessIdentity(CurrentProcessTag);

    // Creates an empty process identity that does not grant any access.
    ProcessIdentity() = default;

    // Returns true for a process identity or false on empty identity.
    WEBCORE_EXPORT operator bool() const;

#if HAVE(TASK_IDENTITY_TOKEN)
    task_id_token_t taskIdToken() const { return m_taskIdToken.sendRight(); }
#endif

    template<typename Encoder> void encode(Encoder&) const;
    template<typename Decoder> static std::optional<ProcessIdentity> decode(Decoder&);

private:
#if HAVE(TASK_IDENTITY_TOKEN)
    WEBCORE_EXPORT ProcessIdentity(MachSendRight&& taskIdToken);
    MachSendRight m_taskIdToken;
#endif
};

template<typename Encoder> void ProcessIdentity::encode(Encoder& encoder) const
{
#if HAVE(TASK_IDENTITY_TOKEN)
    encoder << m_taskIdToken;
#else
    UNUSED_PARAM(encoder);
#endif
}

template<typename Decoder> std::optional<ProcessIdentity> ProcessIdentity::decode(Decoder& decoder)
{
#if HAVE(TASK_IDENTITY_TOKEN)
    std::optional<MachSendRight> identitySendRight;
    decoder >> identitySendRight;
    if (identitySendRight)
        return ProcessIdentity { WTFMove(*identitySendRight) };
    return std::nullopt;
#else
    UNUSED_PARAM(decoder);
    return ProcessIdentity { };
#endif
}

}
