/*
 * Copyright (C) 2008, 2014 Apple Inc. All rights reserved.
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

#include "CSSSelector.h"
#include <iterator>
#include <memory>
#include <wtf/FixedVector.h>
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore {

class MutableCSSSelector;
using MutableCSSSelectorList = Vector<std::unique_ptr<MutableCSSSelector>>;

class CSSSelectorList {
    WTF_MAKE_TZONE_ALLOCATED(CSSSelectorList);
public:
    CSSSelectorList() = default;
    CSSSelectorList(const CSSSelectorList&);
    CSSSelectorList(CSSSelectorList&&) = default;
    explicit CSSSelectorList(MutableCSSSelectorList&&);
    explicit CSSSelectorList(std::span<const CSSSelector* const>);

    static CSSSelectorList makeCopyingSimpleSelector(const CSSSelector&);
    static CSSSelectorList makeCopyingComplexSelector(const CSSSelector&);
    static CSSSelectorList makeJoining(const CSSSelectorList&, const CSSSelectorList&);
    static CSSSelectorList makeJoining(const Vector<const CSSSelectorList*>&);

    bool isEmpty() const { return m_selectorArray.isEmpty(); }
    const CSSSelector& first() const LIFETIME_BOUND { return m_selectorArray[0]; }
    const CSSSelector& selectorAt(size_t index) const LIFETIME_BOUND { return m_selectorArray[index]; }
    size_t indexOfSelector(const CSSSelector& selector) const { return m_selectorArray.offsetFromStart(&selector); }

    struct const_iterator {
        friend class CSSSelectorList;
        using value_type = CSSSelector;
        using difference_type = std::ptrdiff_t;
        using pointer = const CSSSelector*;
        using reference = const CSSSelector&;
        using iterator_category = std::forward_iterator_tag;
        reference operator*() const { return *m_ptr; }
        pointer operator->() const { return m_ptr; }
        bool operator==(const const_iterator&) const = default;
        const_iterator() = default;
        const_iterator(pointer ptr)
            : m_ptr(ptr)
        { }

WTF_ALLOW_UNSAFE_BUFFER_USAGE_BEGIN
        const_iterator& operator++()
        {
            // Skip subparts of compound selectors.
            while (m_ptr->precedingInComplexSelector())
                ++m_ptr;
            ++m_ptr;
            return *this;
        }
WTF_ALLOW_UNSAFE_BUFFER_USAGE_END

        const_iterator operator++(int)
        {
            const_iterator temp = *this;
            ++*this;
            return temp;
        }

    private:
        pointer m_ptr = nullptr;
    };
    const_iterator begin() const LIFETIME_BOUND { return { m_selectorArray.begin() }; };
    const_iterator end() const LIFETIME_BOUND { return { m_selectorArray.end() }; }

    bool hasExplicitNestingParent() const;
    bool LEGACY_NODELETE hasOnlyNestingSelector() const;

    unsigned componentCount() const { return m_selectorArray.size(); }
    unsigned size() const;

    CSSSelectorList& operator=(CSSSelectorList&&) = default;

    bool operator==(const CSSSelectorList&) const;

private:
    explicit CSSSelectorList(FixedVector<CSSSelector>&& array)
        : m_selectorArray(WTF::move(array))
    { }

    // End of a multipart selector is indicated by m_isLastInComplexSelector bit in the last item.
    FixedVector<CSSSelector> m_selectorArray;
};

void LEGACY_NODELETE add(Hasher&, const CSSSelectorList&);

class RefCountedCSSSelectorList : public RefCounted<RefCountedCSSSelectorList> {
public:
    static Ref<RefCountedCSSSelectorList> create(CSSSelectorList&& selectorList) { return adoptRef(*new RefCountedCSSSelectorList(WTF::move(selectorList))); }

    const CSSSelectorList& selectorList() const LIFETIME_BOUND { return m_selectorList; }

private:
    explicit RefCountedCSSSelectorList(CSSSelectorList&& selectorList)
        : m_selectorList(WTF::move(selectorList))
    { }

    CSSSelectorList m_selectorList;
};

} // namespace WebCore
