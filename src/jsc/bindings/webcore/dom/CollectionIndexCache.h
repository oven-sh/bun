/*
 * Copyright (C) 2013-2017 Apple Inc. All rights reserved.
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

#include <wtf/Vector.h>

namespace WebCore {

class WeakPtrImplWithEventTargetData;

WEBCORE_EXPORT void reportExtraMemoryAllocatedForCollectionIndexCache(size_t);

template <class Collection, class Iterator>
class CollectionIndexCache {
public:
    CollectionIndexCache();

    typedef typename std::iterator_traits<Iterator>::value_type NodeType;

    inline unsigned nodeCount(const Collection&);
    inline NodeType* nodeAt(const Collection&, unsigned index);

    bool hasValidCache() const { return m_current || m_nodeCountValid || m_listValid; }
    inline void invalidate();
    size_t memoryCost() const
    {
        // memoryCost() may be invoked concurrently from a GC thread, and we need to be careful
        // about what data we access here and how. Accessing m_cachedList.capacity() is safe
        // because it doesn't involve any pointer chasing.
        return m_cachedList.capacity() * sizeof(NodeType*);
    }

private:
    inline unsigned computeNodeCountUpdatingListCache(const Collection&);
    inline NodeType* traverseBackwardTo(const Collection&, unsigned);
    inline NodeType* traverseForwardTo(const Collection&, unsigned);

    Iterator m_current { };
    unsigned m_currentIndex { 0 };
    unsigned m_nodeCount { 0 };
    Vector<WeakPtr<NodeType, WeakPtrImplWithEventTargetData>> m_cachedList;
    bool m_nodeCountValid : 1;
    bool m_listValid : 1;
};

template<class Collection, class Iterator> CollectionIndexCache<Collection, Iterator>::CollectionIndexCache()
    : m_nodeCountValid(false)
    , m_listValid(false)
{
}

}
