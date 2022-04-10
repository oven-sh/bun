/*
 * Copyright (C) 2021-2022 Apple Inc. All Rights Reserved.
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

#include "FetchRequestCredentials.h"
#include "WorkerType.h"

namespace WebCore {

struct WorkerOptions {
    WorkerType type { WorkerType::Classic };
    FetchRequestCredentials credentials { FetchRequestCredentials::SameOrigin };
    String name;

    template<class Encoder> void encode(Encoder&) const;
    template<class Decoder> static std::optional<WorkerOptions> decode(Decoder&);
};

template<class Encoder>
void WorkerOptions::encode(Encoder& encoder) const
{
    encoder << type << credentials << name;
}

template<class Decoder>
std::optional<WorkerOptions> WorkerOptions::decode(Decoder& decoder)
{
    std::optional<WorkerType> workerType;
    decoder >> workerType;
    if (!workerType)
        return std::nullopt;

    std::optional<FetchRequestCredentials> credentials;
    decoder >> credentials;
    if (!credentials)
        return std::nullopt;

    std::optional<String> name;
    decoder >> name;
    if (!name)
        return std::nullopt;

    return { { *workerType, *credentials, WTFMove(*name) } };
}

} // namespace WebCore
