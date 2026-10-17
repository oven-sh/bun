/*
 * Copyright (C) 2023 Apple Inc. All rights reserved.
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

#include "CachedHTMLCollection.h"
#include "CollectionIndexCacheInlines.h"
#include "CollectionTraversalInlines.h"
#include "HTMLCollectionInlines.h"
#include "TreeScopeInlines.h"

namespace WebCore {

template <typename HTMLCollectionClass>
CachedHTMLCollection<HTMLCollectionClass>::~CachedHTMLCollection()
{
    if (m_indexCache.hasValidCache())
        protect(document())->unregisterCollection(*this);
}

template <typename HTMLCollectionClass>
unsigned CachedHTMLCollection<HTMLCollectionClass>::length() const
{
    // CRTP: HTMLCollectionClass always derives from CachedHTMLCollection<HTMLCollectionClass>.
    return m_indexCache.nodeCount(uncheckedDowncast<HTMLCollectionClass>(*this));
}

template <typename HTMLCollectionClass>
Element* CachedHTMLCollection<HTMLCollectionClass>::item(unsigned offset) const
{
    // CRTP: HTMLCollectionClass always derives from CachedHTMLCollection<HTMLCollectionClass>.
    return m_indexCache.nodeAt(uncheckedDowncast<HTMLCollectionClass>(*this), offset);
}

template <typename HTMLCollectionClass>
size_t CachedHTMLCollection<HTMLCollectionClass>::memoryCost() const
{
    // memoryCost() may be invoked concurrently from a GC thread, and we need to be careful about what data we access here and how.
    // Accessing m_indexCache.memoryCost() is safe because because it doesn't involve any pointer chasing.
    // HTMLCollection::memoryCost() ensures its own thread safety.
    return m_indexCache.memoryCost() + HTMLCollection::memoryCost();
}

template <typename HTMLCollectionClass>
void CachedHTMLCollection<HTMLCollectionClass>::invalidateCacheForDocument(Document& document)
{
    HTMLCollection::invalidateCacheForDocument(document);
    if (m_indexCache.hasValidCache()) {
        document.unregisterCollection(*this);
        m_indexCache.invalidate();
    }
}

static inline bool nameShouldBeVisibleInDocumentAll(HTMLElement& element)
{
    // https://html.spec.whatwg.org/multipage/infrastructure.html#all-named-elements
    return element.hasTagName(HTMLNames::aTag)
        || element.hasTagName(HTMLNames::buttonTag)
        || element.hasTagName(HTMLNames::embedTag)
        || element.hasTagName(HTMLNames::formTag)
        || element.hasTagName(HTMLNames::frameTag)
        || element.hasTagName(HTMLNames::framesetTag)
        || element.hasTagName(HTMLNames::iframeTag)
        || element.hasTagName(HTMLNames::imgTag)
        || element.hasTagName(HTMLNames::inputTag)
        || element.hasTagName(HTMLNames::mapTag)
        || element.hasTagName(HTMLNames::metaTag)
        || element.hasTagName(HTMLNames::objectTag)
        || element.hasTagName(HTMLNames::selectTag)
        || element.hasTagName(HTMLNames::textareaTag);
}

static inline bool nameShouldBeVisibleInDocumentAll(Element& element)
{
    auto* htmlElement = dynamicDowncast<HTMLElement>(element);
    return htmlElement && nameShouldBeVisibleInDocumentAll(*htmlElement);
}

template <typename HTMLCollectionClass>
Element* CachedHTMLCollection<HTMLCollectionClass>::namedItem(const AtomString& name) const
{
    return namedItemMatching(name, traversalType, [](const HTMLCollection& collection, Element& candidate) {
        return static_cast<const HTMLCollectionClass&>(collection).elementMatches(candidate);
    });
}

template <typename HTMLCollectionClass>
auto CachedHTMLCollection<HTMLCollectionClass>::collectionBegin() const -> Iterator
{
    // CRTP: HTMLCollectionClass always derives from CachedHTMLCollection<HTMLCollectionClass>.
    return Traversal::begin(uncheckedDowncast<HTMLCollectionClass>(*this), protect(rootNode()));
}

template <typename HTMLCollectionClass>
auto CachedHTMLCollection<HTMLCollectionClass>::collectionLast() const -> Iterator
{
    // CRTP: HTMLCollectionClass always derives from CachedHTMLCollection<HTMLCollectionClass>.
    return Traversal::last(uncheckedDowncast<HTMLCollectionClass>(*this), protect(rootNode()));
}

template <typename HTMLCollectionClass>
void CachedHTMLCollection<HTMLCollectionClass>::collectionTraverseForward(Iterator& current, unsigned count, unsigned& traversedCount) const
{
    // CRTP: HTMLCollectionClass always derives from CachedHTMLCollection<HTMLCollectionClass>.
    Traversal::traverseForward(uncheckedDowncast<HTMLCollectionClass>(*this), current, count, traversedCount);
}

template <typename HTMLCollectionClass>
void CachedHTMLCollection<HTMLCollectionClass>::collectionTraverseBackward(Iterator& current, unsigned count) const
{
    // CRTP: HTMLCollectionClass always derives from CachedHTMLCollection<HTMLCollectionClass>.
    Traversal::traverseBackward(uncheckedDowncast<HTMLCollectionClass>(*this), current, count);
}

template <typename HTMLCollectionClass>
bool CachedHTMLCollection<HTMLCollectionClass>::collectionCanTraverseBackward() const
{
    return traversalType != CollectionTraversalType::CustomForwardOnly;
}

}
