/*
 * Copyright (C) 2015-2019 Apple Inc. All rights reserved.
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

#include "CollectionTraversal.h"
#include "CollectionType.h"
#include "Document.h"
#include "HTMLCollection.h"
#include "HTMLElement.h"
#include <wtf/TZoneMalloc.h>

namespace WebCore {

template <typename HTMLCollectionClass>
class CachedHTMLCollection : public HTMLCollection {
    WTF_MAKE_TZONE_NON_HEAP_ALLOCATABLE(CachedHTMLCollection);
public:
    static constexpr auto traversalType = CollectionTypeTraits<CollectionClassTraits<HTMLCollectionClass>::collectionType>::traversalType;

    CachedHTMLCollection(ContainerNode& base, CollectionType);
    
    virtual ~CachedHTMLCollection();
    
    unsigned length() const override;
    Element* item(unsigned offset) const override;
    Element* namedItem(const AtomString&) const override;
    size_t memoryCost() const final;

    // For CollectionIndexCache; do not use elsewhere.
    using Traversal = CollectionTraversal<traversalType>;
    using Iterator = typename Traversal::Iterator;
    inline Iterator collectionBegin() const;
    inline Iterator collectionLast() const;
    inline void collectionTraverseForward(Iterator& current, unsigned count, unsigned& traversedCount) const;
    inline void collectionTraverseBackward(Iterator& current, unsigned count) const;
    inline bool collectionCanTraverseBackward() const;
    void willValidateIndexCache() const { protect(document())->registerCollection(const_cast<CachedHTMLCollection&>(*this)); }

    void invalidateCacheForDocument(Document&) override;
    
    inline bool elementMatches(Element&) const;
    
private:
    mutable CollectionIndexCache<HTMLCollectionClass, Iterator> m_indexCache;
};

template <typename HTMLCollectionClass>
CachedHTMLCollection<HTMLCollectionClass>::CachedHTMLCollection(ContainerNode& base, CollectionType collectionType)
    : HTMLCollection(base, collectionType)
{
}

template <typename HTMLCollectionClass>
bool CachedHTMLCollection<HTMLCollectionClass>::elementMatches(Element&) const
{
    // We call the elementMatches() method directly on the subclass instead for performance.
    ASSERT_NOT_REACHED();
    return false;
}

} // namespace WebCore
