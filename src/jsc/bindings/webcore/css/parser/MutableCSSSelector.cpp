/*
 * Copyright (C) 2003 Lars Knoll (knoll@kde.org)
 * Copyright (C) 2004, 2005, 2006, 2008, 2014 Apple Inc. All rights reserved.
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
 */

#include "config.h"
#include "MutableCSSSelector.h"

#include "CSSSelector.h"
#include "CSSSelectorList.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(MutableCSSSelector);

MutableCSSSelector::MutableCSSSelector() = default;

MutableCSSSelector::MutableCSSSelector(const QualifiedName& tagQName)
    : m_selector(tagQName)
{
}

MutableCSSSelector::MutableCSSSelector(const CSSSelector& selector)
    : m_selector(selector, CSSSelector::MutableSelectorCopy)
{
    if (auto preceding = selector.precedingInComplexSelector())
        m_precedingInComplexSelector = makeUnique<MutableCSSSelector>(*preceding);
}

MutableCSSSelector::MutableCSSSelector(const CSSSelector& selector, SimpleSelectorTag)
    : m_selector(selector, CSSSelector::MutableSelectorCopy)
{
}


MutableCSSSelector::~MutableCSSSelector()
{
    if (!m_precedingInComplexSelector)
        return;
    Vector<std::unique_ptr<MutableCSSSelector>, 16> toDelete;
    std::unique_ptr<MutableCSSSelector> selector = WTF::move(m_precedingInComplexSelector);
    while (true) {
        std::unique_ptr<MutableCSSSelector> next = WTF::move(selector->m_precedingInComplexSelector);
        toDelete.append(WTF::move(selector));
        if (!next)
            break;
        selector = WTF::move(next);
    }
}

void MutableCSSSelector::adoptSelectorVector(MutableCSSSelectorList&& selectorVector)
{
    m_selector.setSelectorList(makeUnique<CSSSelectorList>(WTF::move(selectorVector)));
}

void MutableCSSSelector::setIntegerList(FixedVector<int> list)
{
    ASSERT(!list.isEmpty());
    m_selector.setIntegerList(WTF::move(list));
}

void MutableCSSSelector::setStringList(FixedVector<AtomString> list)
{
    ASSERT(!list.isEmpty());
    m_selector.setStringList(WTF::move(list));
}

void MutableCSSSelector::setLangList(FixedVector<PossiblyQuotedIdentifier> list)
{
    ASSERT(!list.isEmpty());
    m_selector.setLangList(WTF::move(list));
}

void MutableCSSSelector::setSelectorList(std::unique_ptr<CSSSelectorList> selectorList)
{
    m_selector.setSelectorList(WTF::move(selectorList));
}

const MutableCSSSelector* MutableCSSSelector::leftmostSimpleSelector() const
{
    auto selector = this;
    while (auto next = selector->precedingInComplexSelector())
        selector = next;
    return selector;
}

MutableCSSSelector* MutableCSSSelector::leftmostSimpleSelector()
{
    auto selector = this;
    while (auto next = selector->precedingInComplexSelector())
        selector = next;
    return selector;
}

bool MutableCSSSelector::hasExplicitNestingParent() const
{
    auto selector = this;
    while (selector) {
        if (selector->selector().hasExplicitNestingParent())
            return true;

        selector = selector->precedingInComplexSelector();
    }
    return false;
}

bool MutableCSSSelector::hasExplicitPseudoClassScope() const
{
    auto selector = this;
    while (selector) {
        if (selector->selector().hasExplicitPseudoClassScope())
            return true;

        selector = selector->precedingInComplexSelector();
    }
    return false;
}

static bool LEGACY_NODELETE selectorListMatchesPseudoElement(const CSSSelectorList* selectorList)
{
    if (!selectorList)
        return false;

    for (auto& subSelector : *selectorList) {
        for (const CSSSelector* selector = &subSelector; selector; selector = selector->precedingInComplexSelector()) {
            if (selector->matchesPseudoElement())
                return true;
            if (const CSSSelectorList* subselectorList = selector->selectorList()) {
                if (selectorListMatchesPseudoElement(subselectorList))
                    return true;
            }
        }
    }
    return false;
}

bool MutableCSSSelector::matchesPseudoElement() const
{
    return m_selector.matchesPseudoElement() || selectorListMatchesPseudoElement(m_selector.selectorList());
}

void MutableCSSSelector::prependInComplexSelector(CSSSelector::Relation relation, std::unique_ptr<MutableCSSSelector> selector)
{
    auto* first = this;
    while (first->precedingInComplexSelector())
        first = first->precedingInComplexSelector();

    first->setRelation(relation);
    first->setPrecedingInComplexSelector(WTF::move(selector));
}

void MutableCSSSelector::prependInComplexSelectorAsRelative(std::unique_ptr<MutableCSSSelector> selector)
{
    auto& firstSelector = leftmostSimpleSelector()->selector();

    // Relation is Descendant by default.
    auto relation = firstSelector.relation();
    if (relation == CSSSelector::Relation::Subselector)
        relation = CSSSelector::Relation::DescendantSpace;

    prependInComplexSelector(relation, WTF::move(selector));
}

void MutableCSSSelector::appendTagInComplexSelector(const QualifiedName& tagQName, bool tagIsForNamespaceRule)
{
    // Make the current last selector the second to last.
    auto currentLast = makeUnique<MutableCSSSelector>();
    currentLast->m_selector = WTF::move(m_selector);
    currentLast->m_precedingInComplexSelector = WTF::move(m_precedingInComplexSelector);
    m_precedingInComplexSelector = WTF::move(currentLast);

    // Change the last selector to be the tag selector.
    m_selector = CSSSelector(tagQName, tagIsForNamespaceRule);
    m_selector.setRelation(CSSSelector::Relation::Subselector);
}

std::unique_ptr<MutableCSSSelector> MutableCSSSelector::releaseFromComplexSelector()
{
    setRelation(CSSSelector::Relation::Subselector);
    return WTF::move(m_precedingInComplexSelector);
}

bool MutableCSSSelector::startsWithExplicitCombinator() const
{
    auto relation = leftmostSimpleSelector()->selector().relation();
    return relation != CSSSelector::Relation::Subselector && relation != CSSSelector::Relation::DescendantSpace;
}

}
