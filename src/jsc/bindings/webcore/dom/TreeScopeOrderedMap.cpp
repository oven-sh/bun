/*
 * Copyright (C) 2004, 2005, 2006, 2007, 2008, 2009 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "TreeScopeOrderedMap.h"

#include "ContainerNodeAlgorithms.h"
#include "ContainerNodeInlines.h"
#include "ElementInlines.h"
#include "HTMLNameCollection.h"
#include "TreeScopeInlines.h"
#include "TypedElementDescendantIteratorInlines.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(TreeScopeOrderedMap);

using namespace HTMLNames;

void TreeScopeOrderedMap::clear()
{
    m_map.clear();
}

void TreeScopeOrderedMap::add(const AtomString& key, Element& element, const TreeScope& treeScope)
{
    ASSERT_WITH_SECURITY_IMPLICATION(!key.isNull());
    RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(&element.treeScope() == &treeScope);
    ASSERT_WITH_SECURITY_IMPLICATION(treeScope.rootNode().isShadowIncludingInclusiveAncestorOf(&element));

    if (!element.isInTreeScope())
        return;
    Map::AddResult addResult = m_map.ensure(key, [&element] {
        return MapEntry(&element);
    });
    MapEntry& entry = addResult.iterator->value;

#if ASSERT_ENABLED || ENABLE(SECURITY_ASSERTIONS)
    ASSERT_WITH_SECURITY_IMPLICATION(!entry.registeredElements.contains(&element));
    entry.registeredElements.add(element);
#endif

    if (addResult.isNewEntry)
        return;

    RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(entry.count);
    entry.element = nullptr;
    entry.count++;
    entry.orderedList.clear();
}

void TreeScopeOrderedMap::remove(const AtomString& key, Element& element)
{
    ASSERT_WITH_SECURITY_IMPLICATION(!key.isNull());
    m_map.checkConsistency();
    auto it = m_map.find(key);

    RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(it != m_map.end());

    MapEntry& entry = it->value;
    ASSERT_WITH_SECURITY_IMPLICATION(entry.registeredElements.remove(element));
    RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(entry.count);
    if (entry.count == 1) {
        RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(!entry.element || entry.element == &element);
        m_map.remove(it);
    } else {
        if (entry.element == &element)
            entry.element = nullptr;
        entry.count--;
        entry.orderedList.clear(); // FIXME: Remove the element instead if there are only few items left.
    }
}

template <typename KeyMatchingFunction>
inline RefPtr<Element> TreeScopeOrderedMap::get(const AtomString& key, const TreeScope& scope, NOESCAPE const KeyMatchingFunction& keyMatches) const
{
    ASSERT_WITH_SECURITY_IMPLICATION(!key.isNull());
    m_map.checkConsistency();

    auto it = m_map.find(key);
    if (it == m_map.end())
        return nullptr;

    MapEntry& entry = it->value;
    ASSERT(entry.count);
    if (entry.element) {
        Ref element = *entry.element;
        RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(&element->treeScope() == &scope);
        ASSERT_WITH_SECURITY_IMPLICATION(entry.registeredElements.contains(element.ptr()));
        return element;
    }

    // We know there's at least one node that matches; iterate to find the first one.
    Ref rootNode = scope.rootNode();
    for (Ref<Element> element : descendantsOfType<Element>(rootNode.get())) {
        if (!element->isInTreeScope())
            continue;
        if (!keyMatches(key, element))
            continue;
        entry.element = element.ptr();
        RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(&element->treeScope() == &scope);
        ASSERT_WITH_SECURITY_IMPLICATION(entry.registeredElements.contains(entry.element.get()));
        return element;
    }

#if ASSERT_ENABLED
    // FormListedElement may call getElementById to find its owner form in the middle of a tree removal.
    if (auto* currentScope = ContainerChildRemovalScope::currentScope()) {
        ASSERT(&scope.rootNode() == &currentScope->parentOfRemovedTree().rootNode());
        Ref removedTree = currentScope->removedChild();
        for (Ref element : descendantsOfType<Element>(downcast<ContainerNode>(removedTree.get()))) {
            if (!keyMatches(key, element))
                continue;
            return nullptr;
        }
    }
    ASSERT_NOT_REACHED();
#endif // ASSERT_ENABLED

    return nullptr;
}

template <typename KeyMatchingFunction>
inline Vector<WeakRef<Element, WeakPtrImplWithEventTargetData>>* TreeScopeOrderedMap::getAll(const AtomString& key, const TreeScope& scope, NOESCAPE const KeyMatchingFunction& keyMatches) const
{
    ASSERT_WITH_SECURITY_IMPLICATION(!key.isNull());
    m_map.checkConsistency();

    auto mapIterator = m_map.find(key);
    if (mapIterator == m_map.end())
        return nullptr;

    auto& entry = mapIterator->value;
    RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(entry.count);

    if (entry.orderedList.isEmpty()) {
        entry.orderedList.reserveCapacity(entry.count);
        auto elementDescendants = descendantsOfType<Element>(scope.rootNode());
        for (auto it = entry.element ? elementDescendants.beginAt(*entry.element) : elementDescendants.begin(); it; ++it) {
            Ref element = *it;
            if (keyMatches(key, element))
                entry.orderedList.append(element.get());
        }
        RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(entry.orderedList.size() == entry.count);
    }

    return &entry.orderedList;
}

RefPtr<Element> TreeScopeOrderedMap::getElementById(const AtomString& key, const TreeScope& scope) const
{
    return get(key, scope, [] (const AtomString& key, const Element& element) {
        return element.getIdAttribute() == key;
    });
}

RefPtr<Element> TreeScopeOrderedMap::getElementByName(const AtomString& key, const TreeScope& scope) const
{
    return get(key, scope, [] (const AtomString& key, const Element& element) {
        return element.getNameAttribute() == key;
    });
}

RefPtr<Element> TreeScopeOrderedMap::getElementByWindowNamedItem(const AtomString& key, const TreeScope& scope) const
{
    return get(key, scope, [] (const AtomString& key, const Element& element) {
        return WindowNameCollection::elementMatches(element, key);
    });
}

RefPtr<Element> TreeScopeOrderedMap::getElementByDocumentNamedItem(const AtomString& key, const TreeScope& scope) const
{
    return get(key, scope, [] (const AtomString& key, const Element& element) {
        return DocumentNameCollection::elementMatches(element, key);
    });
}

const Vector<WeakRef<Element, WeakPtrImplWithEventTargetData>>* TreeScopeOrderedMap::getAllElementsById(const AtomString& key, const TreeScope& scope) const
{
    return getAll(key, scope, [] (const AtomString& key, const Element& element) {
        return element.getIdAttribute() == key;
    });
}

const Vector<AtomString> TreeScopeOrderedMap::keys() const
{
    return WTF::map(m_map, [](auto& entry) -> AtomString {
        return entry.key;
    });
}

} // namespace WebCore
