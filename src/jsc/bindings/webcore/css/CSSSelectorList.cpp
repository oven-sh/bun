/*
 * Copyright (C) 2008, 2012, 2013, 2014 Apple Inc. All rights reserved.
 * Copyright (C) 2009 Google Inc. All rights reserved.
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
#include "CSSSelectorList.h"

#include "CommonAtomStrings.h"
#include "MutableCSSSelector.h"
#include <wtf/TZoneMallocInlines.h>
#include <wtf/ZippedRange.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CSSSelectorList);

CSSSelectorList::CSSSelectorList(const CSSSelectorList& other)
    : m_selectorArray(other.m_selectorArray)
{
}

CSSSelectorList::CSSSelectorList(MutableCSSSelectorList&& selectorVector)
{
    ASSERT_WITH_SECURITY_IMPLICATION(!selectorVector.isEmpty());

    size_t flattenedSize = 0;
    for (size_t i = 0; i < selectorVector.size(); ++i) {
        for (auto* selector = selectorVector[i].get(); selector; selector = selector->precedingInComplexSelector())
            ++flattenedSize;
    }
    ASSERT(flattenedSize);
    m_selectorArray = FixedVector<CSSSelector>(flattenedSize);
    size_t arrayIndex = 0;
    for (size_t i = 0; i < selectorVector.size(); ++i) {
        auto* last = selectorVector[i].get();
        auto* current = last;
        while (current) {
            new (NotNull, &m_selectorArray[arrayIndex]) CSSSelector(current->releaseSelector());
            if (current != last)
                m_selectorArray[arrayIndex].m_isLastInComplexSelector = false;
            current = current->precedingInComplexSelector();
            ASSERT((arrayIndex < (m_selectorArray.size() - 1)) || (flattenedSize == arrayIndex + 1));
            if (current)
                m_selectorArray[arrayIndex].m_isFirstInComplexSelector = false;
            ++arrayIndex;
        }
        ASSERT(!m_selectorArray[arrayIndex - 1].precedingInComplexSelector());
    }
    ASSERT(flattenedSize == arrayIndex);
}

CSSSelectorList::CSSSelectorList(std::span<const CSSSelector* const> selectors)
    : m_selectorArray(FixedVector<CSSSelector>::map(selectors, [](auto* selector) {
        return *selector;
    }))
{
}

CSSSelectorList CSSSelectorList::makeCopyingSimpleSelector(const CSSSelector& simpleSelector)
{
    FixedVector<CSSSelector> selectorArray { simpleSelector };
    auto& firstSelector = selectorArray[0];
    firstSelector.m_isFirstInComplexSelector = true;
    firstSelector.m_isLastInComplexSelector = true;

    return CSSSelectorList { WTF::move(selectorArray) };
}

CSSSelectorList CSSSelectorList::makeCopyingComplexSelector(const CSSSelector& complexSelector)
{
    size_t length = 0;
    for (auto* selector = &complexSelector; selector; selector = selector->precedingInComplexSelector())
        ++length;

    FixedVector<CSSSelector> selectorArray(length);

    size_t i = 0;
    for (auto* selector = &complexSelector; selector; selector = selector->precedingInComplexSelector(), ++i)
        new (NotNull, &selectorArray[i]) CSSSelector(*selector);

    return CSSSelectorList { WTF::move(selectorArray) };
}

CSSSelectorList CSSSelectorList::makeJoining(const CSSSelectorList& a, const CSSSelectorList& b)
{
    if (a.isEmpty())
        return b;
    if (b.isEmpty())
        return a;

    auto aComponentCount = a.componentCount();
    auto bComponentCount = b.componentCount();

    auto selectorArray = FixedVector<CSSSelector>::createWithSizeFromGenerator(aComponentCount + bComponentCount, [&](size_t i) {
        return i < aComponentCount ? a.m_selectorArray[i] : b.m_selectorArray[i - aComponentCount];
    });

    return CSSSelectorList { WTF::move(selectorArray) };
}

CSSSelectorList CSSSelectorList::makeJoining(const Vector<const CSSSelectorList*>& lists)
{
    size_t totalComponentCount = 0;
    for (auto list : lists)
        totalComponentCount += list->componentCount();

    if (!totalComponentCount)
        return { };

    FixedVector<CSSSelector> selectorArray(totalComponentCount);

    size_t componentIndex = 0;
    for (auto list : lists) {
        auto count = list->componentCount();
        for (size_t i = 0; i < count; ++i)
            new (NotNull, &selectorArray[componentIndex++]) CSSSelector(list->m_selectorArray[i]);
    }

    ASSERT(componentIndex == totalComponentCount);

    return CSSSelectorList { WTF::move(selectorArray) };
}

unsigned CSSSelectorList::size() const
{
    return std::ranges::count_if(m_selectorArray, [](auto& selector) {
        return !selector.precedingInComplexSelector();
    });
}

template <typename Functor>
static bool forEachTagSelector(NOESCAPE const Functor& functor, const CSSSelector* selector)
{
    ASSERT(selector);

    do {
        if (functor(selector))
            return true;
        if (const CSSSelectorList* selectorList = selector->selectorList()) {
            for (const auto& subSelector : *selectorList) {
                if (forEachTagSelector(functor, &subSelector))
                    return true;
            }
        }
    } while ((selector = selector->precedingInComplexSelector()));

    return false;
}

template <typename Functor>
static bool forEachSelector(NOESCAPE const Functor& functor, const CSSSelectorList& selectorList)
{
    for (const auto& selector : selectorList) {
        if (forEachTagSelector(functor, &selector))
            return true;
    }

    return false;
}

bool CSSSelectorList::hasExplicitNestingParent() const
{
    auto functor = [](auto* selector) {
        return selector->match() == CSSSelector::Match::NestingParent
            || selector->match() == CSSSelector::Match::ForgivingUnknownNestContaining;
    };

    return forEachSelector(functor, *this);
}

bool CSSSelectorList::hasOnlyNestingSelector() const
{
    if (componentCount() != 1)
        return false;

    auto& singleSelector = first();
    
    // Selector should be a single selector
    if (singleSelector.precedingInComplexSelector())
        return false;

    return singleSelector.match() == CSSSelector::Match::NestingParent;
}

bool CSSSelectorList::operator==(const CSSSelectorList& other) const
{
    if (componentCount() != other.componentCount())
        return false;

    for (auto [a, b] : zippedRange(*this, other)) {
        if (!complexSelectorsEqual(a, b))
            return false;
    }
    return true;
}

void add(Hasher& hasher, const CSSSelectorList& list)
{
    for (auto& selector : list)
        addComplexSelector(hasher, selector);
}


} // namespace WebCore
