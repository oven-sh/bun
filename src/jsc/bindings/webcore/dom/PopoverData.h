/*
 * Copyright (C) 2023-2026 Apple Inc. All rights reserved.
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

#include "Element.h"
#include "HTMLElement.h"
#include "ToggleEventTask.h"

namespace WebCore {

enum class PopoverVisibilityState : bool {
    Hidden,
    Showing,
};

class PopoverData {
    WTF_MAKE_TZONE_ALLOCATED(PopoverData);
public:
    PopoverData() = default;

    PopoverState popoverState() const { return m_popoverState; }
    void setPopoverState(PopoverState state) { m_popoverState = state; }

    PopoverVisibilityState visibilityState() const { return m_visibilityState; }
    void setVisibilityState(PopoverVisibilityState visibilityState) { m_visibilityState = visibilityState; };

    Element* previouslyFocusedElement() const { return m_previouslyFocusedElement.get(); }
    void setPreviouslyFocusedElement(Element* element) { m_previouslyFocusedElement = element; }

    Ref<ToggleEventTask> ensureToggleEventTask(Element&);

    HTMLElement* invoker() const { return m_invoker.get(); }
    void setInvoker(const HTMLElement* element) { m_invoker = element; }

    bool showingAsHint() const { return m_showingAsHint; }
    void setShowingAsHint(bool showingAsHint) { m_showingAsHint = showingAsHint; }

    HTMLElement* hintStackParent() const { return m_hintStackParent.get(); }
    void setHintStackParent(HTMLElement* element) { m_hintStackParent = element; }

    class ScopedStartShowingOrHiding {
    public:
    explicit ScopedStartShowingOrHiding(Element& popover)
        : m_popover(popover)
        , m_wasSet(popover.popoverData()->m_isHidingOrShowingPopover)
    {
        m_popover->popoverData()->m_isHidingOrShowingPopover = true;
    }
    ~ScopedStartShowingOrHiding()
    {
        if (!m_wasSet && m_popover->popoverData())
            m_popover->popoverData()->m_isHidingOrShowingPopover = false;
    }
    bool wasShowingOrHiding() const { return m_wasSet; }

    private:
        const Ref<Element> m_popover;
        bool m_wasSet;
    };

private:
    PopoverState m_popoverState { PopoverState::None };
    PopoverVisibilityState m_visibilityState { PopoverVisibilityState::Hidden };
    WeakPtr<Element, WeakPtrImplWithEventTargetData> m_previouslyFocusedElement;
    const RefPtr<ToggleEventTask> m_toggleEventTask;
    WeakPtr<HTMLElement, WeakPtrImplWithEventTargetData> m_invoker;
    WeakPtr<HTMLElement, WeakPtrImplWithEventTargetData> m_hintStackParent;
    bool m_isHidingOrShowingPopover = false;
    bool m_showingAsHint = false;
};

}
