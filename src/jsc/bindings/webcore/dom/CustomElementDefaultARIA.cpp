/*
 * Copyright (C) 2022 Apple Inc. All rights reserved.
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

#include "config.h"
#include "CustomElementDefaultARIA.h"

#include "ContainerNodeInlines.h"
#include "Element.h"
#include "ElementInlines.h"
#include "HTMLNames.h"
#include "SpaceSplitString.h"
#include <wtf/StdLibExtras.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CustomElementDefaultARIA);

CustomElementDefaultARIA::CustomElementDefaultARIA() = default;
CustomElementDefaultARIA::~CustomElementDefaultARIA() = default;

void CustomElementDefaultARIA::setValueForAttribute(const QualifiedName& name, const AtomString& value)
{
    m_map.set(name, value);
}

static bool LEGACY_NODELETE isElementVisible(const Element& element, const Element& thisElement)
{
    return !element.isConnected() || element.isInDocumentTree() || thisElement.isShadowIncludingDescendantOf(element.rootNode());
}

const AtomString& CustomElementDefaultARIA::valueForAttribute(const Element& thisElement, const QualifiedName& name) const
{
    auto it = m_map.find(name);
    if (it == m_map.end())
        return nullAtom();

    return WTF::switchOn(it->value, [&](const AtomString& stringValue) -> const AtomString& {
        return stringValue;
    }, [&](const WeakPtr<Element, WeakPtrImplWithEventTargetData>& weakElementValue) -> const AtomString& {
        auto* elementValue = weakElementValue.get();
        if (elementValue && isElementVisible(*elementValue, thisElement))
            return elementValue->attributeWithoutSynchronization(HTMLNames::idAttr);
        return nullAtom();
    }, [&](const Vector<WeakPtr<Element, WeakPtrImplWithEventTargetData>>& elements) -> const AtomString& {
        StringBuilder idList;
        for (auto& weakElement : elements) {
            RefPtr element = weakElement.get();
            if (element && isElementVisible(*element, thisElement)) {
                if (idList.length())
                    idList.append(' ');
                idList.append(element->attributeWithoutSynchronization(HTMLNames::idAttr));
            }
        }
        // FIXME: This should probably be using the idList we just built.
        return nullAtom();
    });
}

bool CustomElementDefaultARIA::hasAttribute(const QualifiedName& name) const
{
    return m_map.find(name) != m_map.end();
}

RefPtr<Element> CustomElementDefaultARIA::elementForAttribute(const Element& thisElement, const QualifiedName& name) const
{
    auto it = m_map.find(name);
    if (it == m_map.end())
        return nullptr;

    RefPtr<Element> result;
    WTF::switchOn(it->value, [&](const AtomString& stringValue) {
        if (thisElement.isInTreeScope())
            result = protect(thisElement.treeScope())->elementByIdResolvingReferenceTarget(stringValue);
    }, [&](const WeakPtr<Element, WeakPtrImplWithEventTargetData>& weakElementValue) {
        RefPtr elementValue = weakElementValue.get();
        if (elementValue && isElementVisible(*elementValue, thisElement))
            result = WTF::move(elementValue);
    }, [&](const Vector<WeakPtr<Element, WeakPtrImplWithEventTargetData>>&) {
        RELEASE_ASSERT_NOT_REACHED();
    });
    return result;
}

void CustomElementDefaultARIA::setElementForAttribute(const QualifiedName& name, Element* element)
{
    m_map.set(name, WeakPtr<Element, WeakPtrImplWithEventTargetData> { element });
}

std::optional<Vector<Ref<Element>>> CustomElementDefaultARIA::elementsForAttribute(const Element& thisElement, const QualifiedName& name) const
{
    auto it = m_map.find(name);
    if (it == m_map.end())
        return std::nullopt;
    Vector<Ref<Element>> result;
    WTF::switchOn(it->value, [&](const AtomString& stringValue) {
        if (thisElement.isInTreeScope()) {
            SpaceSplitString idList { stringValue, SpaceSplitString::ShouldFoldCase::No };
            result = WTF::compactMap(idList, [&](auto& id) {
                RefPtr elementForId = thisElement.treeScope().getElementById(id);
                return elementForId ? elementForId->resolveReferenceTarget() : nullptr;
            });
        }
    }, [&](const WeakPtr<Element, WeakPtrImplWithEventTargetData>& weakElementValue) {
        RefPtr element = weakElementValue.get();
        if (element && isElementVisible(*element, thisElement))
            result.append(element.releaseNonNull());
    }, [&](const Vector<WeakPtr<Element, WeakPtrImplWithEventTargetData>>& elements) {
        result.reserveInitialCapacity(elements.size());
        for (auto& weakElement : elements) {
            if (RefPtr element = weakElement.get(); element && isElementVisible(*element, thisElement))
                result.append(element.releaseNonNull());
        }
    });
    return result;
}

void CustomElementDefaultARIA::setElementsForAttribute(const QualifiedName& name, std::optional<Vector<Ref<Element>>>&& values)
{
    if (!values) {
        m_map.remove(name);
        return;
    }
    Vector<WeakPtr<Element, WeakPtrImplWithEventTargetData>> elements;
    for (auto& element : *values)
        elements.append(element);
    m_map.set(name, WTF::move(elements));
}

} // namespace WebCore
