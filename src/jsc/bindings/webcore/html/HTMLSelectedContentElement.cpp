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

#include "config.h"
#include "HTMLSelectedContentElement.h"

#include "Document.h"
#include "ElementAncestorIteratorInlines.h"
#include "HTMLElement.h"
#include "HTMLNames.h"
#include "HTMLOptionElement.h"
#include "HTMLSelectElement.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLSelectedContentElement);

using namespace HTMLNames;

HTMLSelectedContentElement::HTMLSelectedContentElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document, { })
{
    ASSERT(hasTagName(selectedcontentTag));
}

Ref<HTMLSelectedContentElement> HTMLSelectedContentElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLSelectedContentElement(tagName, document));
}

auto HTMLSelectedContentElement::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree) -> NeedsPostConnectionSteps
{
    HTMLElement::insertionSteps(insertionType, parentOfInsertedTree);

    recalculateDisabledness();

    if (insertionType.connectedToDocument)
        return NeedsPostConnectionSteps::Yes;
    return NeedsPostConnectionSteps::No;
}

void HTMLSelectedContentElement::postConnectionSteps()
{
    RefPtr select = recalculateDisabledness();
    if (m_isDisabled || !select || !select->updatesSelectedContent())
        return;

    select->updateSelectedContent(*this);
}

void HTMLSelectedContentElement::removingSteps(RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
{
    HTMLElement::removingSteps(removalType, oldParentOfRemovedTree);

    if (RefPtr select = m_owningSelect; select && !isInclusiveDescendantOf(*select)) {
        select->unregisterSelectedContentElement();
        m_owningSelect = nullptr;
    }
}

void HTMLSelectedContentElement::movingSteps(MovingType movingType, ContainerNode& oldParent)
{
    HTMLElement::movingSteps(movingType, oldParent);

    RefPtr select = recalculateDisabledness();
    if (m_isDisabled || !select || !select->updatesSelectedContent())
        return;

    protect(document())->queueMicrotask([weakThis = WeakPtr<HTMLSelectedContentElement, WeakPtrImplWithEventTargetData> { *this }, weakSelect = WeakPtr<HTMLSelectElement, WeakPtrImplWithEventTargetData> { *select }] {
        RefPtr selectedContent = weakThis;
        RefPtr select = weakSelect;
        if (selectedContent && select)
            select->updateSelectedContent(*selectedContent);
    });
}

// https://html.spec.whatwg.org/#recalculate-a-selectedcontent-element's-disabledness
RefPtr<HTMLSelectElement> HTMLSelectedContentElement::recalculateDisabledness()
{
    RefPtr<HTMLSelectElement> nearestAncestorSelect;
    m_isDisabled = false;
    for (Ref ancestor : ancestorsOfType<HTMLElement>(*this)) {
        if (RefPtr select = dynamicDowncast<HTMLSelectElement>(ancestor)) {
            if (!nearestAncestorSelect) {
                nearestAncestorSelect = WTF::move(select);
                continue;
            }
            m_isDisabled = true;
            break;
        }
        if (isAnyOf<HTMLOptionElement, HTMLSelectedContentElement>(ancestor)) {
            m_isDisabled = true;
            break;
        }
    }

    if (m_owningSelect != nearestAncestorSelect) {
        if (auto* oldSelect = m_owningSelect.get())
            oldSelect->unregisterSelectedContentElement();
        m_owningSelect = nearestAncestorSelect;
        if (nearestAncestorSelect)
            nearestAncestorSelect->registerSelectedContentElement();
    }

    return nearestAncestorSelect;
}

} // namespace WebCore
