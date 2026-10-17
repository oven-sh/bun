/*
 * Copyright (C) 2020 Igalia S.L. All rights reserved.
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

#include "FocusDirection.h"
#include "SelectionRestorationMode.h"
#include <optional>

namespace WebCore {

enum class FocusRemovalEventsMode : bool { Dispatch, DoNotDispatch };

enum class FocusTrigger : uint8_t { Other, Click, Bindings };

enum class FocusVisibility : uint8_t { Invisible, Visible, ForceInvisible };

struct FocusOptions {
    bool preventScroll { false };
    std::optional<bool> focusVisible { std::nullopt };

    // Non-IDL members.
    SelectionRestorationMode selectionRestorationMode { SelectionRestorationMode::RestoreOrSelectAll };
    FocusDirection direction { FocusDirection::None };
    FocusRemovalEventsMode removalEventsMode { FocusRemovalEventsMode::Dispatch };
    FocusTrigger trigger { FocusTrigger::Other };
    FocusVisibility visibility { FocusVisibility::Invisible };
    // Set when focus is moving because an assistive technology moved its cursor, rather than
    // because the user activated the element. iOS must not present the focused element's input
    // view in that case, as it would open a picker, or raise the keyboard, for a control the user
    // only moved their cursor to.
    bool preventInputViewPresentation { false };
};

} // namespace WebCore
