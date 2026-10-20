/*
 * Copyright (C) 2019 Apple Inc. All rights reserved.
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

#include "HTMLElement.h"
#include "ToggleEventTask.h"

namespace WebCore {

enum class ClosedByState : uint8_t {
    Auto,
    None,
    CloseRequest,
    Any,
};

class HTMLDialogElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLDialogElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLDialogElement);
public:
    template<typename... Args> static Ref<HTMLDialogElement> create(Args&&... args) { return adoptRef(*new HTMLDialogElement(std::forward<Args>(args)...)); }

    bool isOpen() const { return m_isOpen; }

    const String& returnValue() const LIFETIME_BOUND { return m_returnValue; }
    void setReturnValue(String&& value) { m_returnValue = WTF::move(value); }

    ClosedByState closedByState() const;
    ClosedByState computedClosedByState() const;
    const AtomString& closedBy() const;

    ExceptionOr<void> show();
    ExceptionOr<void> showModal(Element* = nullptr);
    void close(const String&, Element* = nullptr);
    void requestClose(const String&, Element* = nullptr);

    bool isModal() const { return m_isModal; };

    void runFocusingSteps();

    bool isValidCommandType(const CommandType) final;
    bool handleCommandInternal(HTMLButtonElement& invoker, const CommandType&) final;

    void queueDialogToggleEventTask(ToggleState oldState, ToggleState newState, Element* source);

private:
    HTMLDialogElement(const QualifiedName&, Document&);

    void removingSteps(RemovalType, ContainerNode& oldParentOfRemovedTree) final;
    void setIsModal(bool newValue);
    bool supportsFocus() const final;

    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) final;

    String m_returnValue;
    bool m_isModal { false };
    bool m_isOpen { false };
    bool m_isRequestingToClose { false };
    WeakPtr<Element, WeakPtrImplWithEventTargetData> m_previouslyFocusedElement;

    const RefPtr<ToggleEventTask> m_toggleEventTask;
};

} // namespace WebCore
