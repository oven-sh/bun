/*
 * Copyright (C) 2025-2026 Apple Inc. All rights reserved.
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

namespace WebCore {

class HTMLSelectElement;

class HTMLSelectedContentElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLSelectedContentElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLSelectedContentElement);
public:
    static Ref<HTMLSelectedContentElement> create(const QualifiedName&, Document&);

    bool isDisabled() const { return m_isDisabled; }

private:
    HTMLSelectedContentElement(const QualifiedName&, Document&);

    NeedsPostConnectionSteps insertionSteps(InsertionType, ContainerNode&) final;
    void postConnectionSteps() final;
    void removingSteps(RemovalType, ContainerNode&) final;
    void movingSteps(MovingType, ContainerNode&) final;

    RefPtr<HTMLSelectElement> recalculateDisabledness();

    bool m_isDisabled { false };
    WeakPtr<HTMLSelectElement, WeakPtrImplWithEventTargetData> m_owningSelect;
};

} // namespace WebCore
