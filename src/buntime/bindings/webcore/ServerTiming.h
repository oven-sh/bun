/*
 * Copyright (C) 2018 Akamai Technologies Inc. All rights reserved.
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

#include <wtf/text/WTFString.h>

namespace WebCore {

struct ServerTiming {
    String name;
    double duration = 0;
    String description;

    bool durationSet = false;
    bool descriptionSet = false;

    ServerTiming(String&& name);
    ServerTiming(String&& name, double duration, String&& description);
    ServerTiming(String&& name, double duration, String&& description, bool durationSet, bool descriptionSet);

    void setParameter(const String&, const String&);
    ServerTiming isolatedCopy() const&;
    ServerTiming isolatedCopy() &&;
};

inline ServerTiming::ServerTiming(String&& name)
    : name(WTF::move(name))
{
}

inline ServerTiming::ServerTiming(String&& name, double duration, String&& description)
    : name(WTF::move(name))
    , duration(duration)
    , description(WTF::move(description))
{
}

inline ServerTiming::ServerTiming(String&& name, double duration, String&& description, bool durationSet, bool descriptionSet)
    : name(WTF::move(name))
    , duration(duration)
    , description(WTF::move(description))
    , durationSet(durationSet)
    , descriptionSet(descriptionSet)
{
}

} // namespace WebCore
