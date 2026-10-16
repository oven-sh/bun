/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003-2025 Apple Inc. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 *
 */

#include "config.h"
#include "HTMLFormControlsCollection.h"

#include "CachedHTMLCollectionInlines.h"
#include "FormListedElement.h"
#include "HTMLFormElement.h"
#include "HTMLImageElement.h"
#include "HTMLNames.h"
#include "ScriptDisallowedScope.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

using namespace HTMLNames;

// Since the collections are to be "live", we have to do the
// calculation every time if anything has changed.

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLFormControlsCollection);

HTMLFormControlsCollection::HTMLFormControlsCollection(ContainerNode& ownerNode)
    : CachedHTMLCollection(ownerNode, CollectionType::FormControls)
{
    ASSERT(is<HTMLFormElement>(ownerNode));
}

Ref<HTMLFormControlsCollection> HTMLFormControlsCollection::create(ContainerNode& ownerNode, CollectionType)
{
    return adoptRef(*new HTMLFormControlsCollection(ownerNode));
}

HTMLFormControlsCollection::~HTMLFormControlsCollection() = default;

std::optional<Variant<Ref<RadioNodeList>, Ref<Element>>> HTMLFormControlsCollection::namedItemOrItems(const AtomString& name) const
{
    auto namedItems = this->namedItems(name);

    if (namedItems.isEmpty())
        return std::nullopt;
    if (namedItems.size() == 1)
        return Variant<Ref<RadioNodeList>, Ref<Element>> { WTF::move(namedItems[0]) };

    return Variant<Ref<RadioNodeList>, Ref<Element>> { protect(ownerNode())->radioNodeList(name) };
}

static unsigned LEGACY_NODELETE findFormListedElement(const Vector<WeakPtr<HTMLElement, WeakPtrImplWithEventTargetData>>& elements, const Element& element)
{
    for (unsigned i = 0; i < elements.size(); ++i) {
        auto* currentElement = elements[i].get();
        ASSERT(currentElement);
        auto* listedElement = currentElement->asFormListedElement();
        ASSERT(listedElement);
        if (listedElement->isEnumeratable() && currentElement == &element)
            return i;
    }
    return elements.size();
}

HTMLElement* HTMLFormControlsCollection::customElementAfter(Element* current) const
{
    ScriptDisallowedScope::InMainThread scriptDisallowedScope;
    auto& elements = ownerNode().unsafeListedElements();
    unsigned start;
    if (!current)
        start = 0;
    else if (m_cachedElement == current)
        start = m_cachedElementOffsetInArray + 1;
    else
        start = findFormListedElement(elements, *current) + 1;

    for (unsigned i = start; i < elements.size(); ++i) {
        auto* element = elements[i].get();
        ASSERT(element);
        ASSERT(element->asFormListedElement());
        if (element->asFormListedElement()->isEnumeratable()) {
            m_cachedElement = element;
            m_cachedElementOffsetInArray = i;
            ASSERT(element == elements[i].get());
            return elements[i].get();
        }
    }
    return nullptr;
}

HTMLFormElement& HTMLFormControlsCollection::ownerNode() const
{
    return downcast<HTMLFormElement>(CachedHTMLCollection::ownerNode());
}

void HTMLFormControlsCollection::updateNamedElementCache() const
{
    if (hasNamedElementCache())
        return;

    auto cache = makeUnique<CollectionNamedElementCache>();

    HashSet<AtomString> foundInputElements;

    ScriptDisallowedScope::InMainThread scriptDisallowedScope;
    for (auto& weakElement : ownerNode().unsafeListedElements()) {
        RefPtr element = weakElement.get();
        ASSERT(element);
        RefPtr associatedElement = element->asFormListedElement();
        ASSERT(associatedElement);
        if (associatedElement->isEnumeratable()) {
            auto& id = element->getIdAttribute();
            if (!id.isEmpty()) {
                cache->appendToIdCache(id, *element);
                foundInputElements.add(id);
            }
            auto& name = element->getNameAttribute();
            if (!name.isEmpty() && id != name) {
                cache->appendToNameCache(name, *element);
                foundInputElements.add(name);
            }
        }
    }

    for (auto& weakElement : ownerNode().imageElements()) {
        RefPtr element = weakElement.get();
        if (!element)
            continue;
        auto& id = element->getIdAttribute();
        if (!id.isEmpty() && !foundInputElements.contains(id))
            cache->appendToIdCache(id, *element);
        auto& name = element->getNameAttribute();
        if (!name.isEmpty() && id != name && !foundInputElements.contains(name))
            cache->appendToNameCache(name, *element);
    }

    setNamedItemCache(WTF::move(cache));
}

void HTMLFormControlsCollection::invalidateCacheForDocument(Document& document)
{
    CachedHTMLCollection::invalidateCacheForDocument(document);
    m_cachedElement = nullptr;
    m_cachedElementOffsetInArray = 0;
}

HTMLElement* HTMLFormControlsCollection::item(unsigned offset) const
{
    return downcast<HTMLElement>(CachedHTMLCollection::item(offset));
}

}
