/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
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

#include "CommonAtomStrings.h"
#include <optional>
#include <wtf/text/ASCIILiteral.h>
#include <wtf/text/AtomString.h>
#include <wtf/text/StringView.h>

namespace WebCore {

enum class ShadowRootMode : uint8_t {
    UserAgent,
    Closed,
    Open
};

static constexpr auto shadowRootModeOpenLiteral = "open"_s;
static constexpr auto shadowRootModeClosedLiteral = "closed"_s;

inline std::optional<ShadowRootMode> parseShadowRootMode(StringView value)
{
    if (equalLettersIgnoringASCIICase(value, shadowRootModeOpenLiteral))
        return ShadowRootMode::Open;
    if (equalLettersIgnoringASCIICase(value, shadowRootModeClosedLiteral))
        return ShadowRootMode::Closed;
    return { };
}

inline const AtomString& serializeShadowRootMode(ShadowRootMode mode)
{
    switch (mode) {
    case ShadowRootMode::Open:
        return openAtom();
    case ShadowRootMode::Closed:
        return closedAtom();
    case ShadowRootMode::UserAgent:
        break;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

}
