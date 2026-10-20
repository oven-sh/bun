/*
 * Copyright (C) 2025 Apple Inc. All rights reserved.
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

#include <algorithm>
#include <array>
#include <wtf/EnumTraits.h>

namespace WebCore {

static constexpr double ForceAtClick = 1;
static constexpr double ForceAtForceClick = 2;

enum class SyntheticClickType : uint8_t { NoTap, OneFingerTap, TwoFingerTap };

enum class MouseEventInputSource : uint8_t { UserDriven, Automation };

enum class MouseEventCanInitiateDrag : bool { No, Yes };

// These button numbers match the ones used in the DOM API, 0 through 2, except for None and Other which aren't specified.
// We reserve -2 for the former and -1 to represent pointer events that indicate that the pressed mouse button hasn't
// changed since the last event, as specified in the DOM API for Pointer Events.
// https://w3c.github.io/uievents/#dom-mouseevent-button
// https://w3c.github.io/pointerevents/#the-button-property
enum class MouseButton : int8_t { None = -2, PointerHasNotChanged, Left, Middle, Right, Back, Forward, Other };

inline MouseButton buttonFromShort(int16_t buttonValue)
{
    static constexpr std::array knownMouseButtonCases { MouseButton::None, MouseButton::PointerHasNotChanged, MouseButton::Left, MouseButton::Middle, MouseButton::Right, MouseButton::Back, MouseButton::Forward };
    bool isKnownButton = std::ranges::any_of(knownMouseButtonCases, [buttonValue](MouseButton button) {
        return buttonValue == std::to_underlying(button);
    });
    return isKnownButton ? static_cast<MouseButton>(buttonValue) : MouseButton::Other;
}

inline unsigned nsEventButtonNumberFromWebCoreMouseButton(MouseButton button)
{
    switch (button) {
    case MouseButton::Right:
        return 1;
    case MouseButton::Middle:
        return 2;
    case MouseButton::Back:
        return 3;
    case MouseButton::Forward:
        return 4;
    default:
        return 0;
    }
}

} // namespace WebCore
