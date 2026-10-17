/*
 * Copyright (C) 1999-2003 Lars Knoll (knoll@kde.org)
 *               1999 Waldo Bastian (bastian@kde.org)
 *               2001 Andreas Schlapbach (schlpbch@iam.unibe.ch)
 *               2001-2003 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2002-2026 Apple Inc. All rights reserved.
 * Copyright (C) 2008 David Smith (catfish.man@gmail.com)
 * Copyright (C) 2010 Google Inc. All rights reserved.
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
#include "CSSSelector.h"

#include "CSSSelectorList.h"
#include "CommonAtomStrings.h"
#include "HTMLNames.h"
#include "MutableCSSSelector.h"
#include <memory>
#include <wtf/Assertions.h>
#include <wtf/Deque.h>
#include <wtf/Hasher.h>
#include <wtf/SmallMap.h>
#include <wtf/StdLibExtras.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/Vector.h>
#include <wtf/text/AtomStringHash.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/TextStream.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CSSSelector);
WTF_MAKE_TZONE_ALLOCATED_IMPL(CSSSelector::RareData);

using namespace HTMLNames;

struct SameSizeAsCSSSelector {
    unsigned flags;
    void* unionPointer;
};

static_assert(CSSSelector::Relation::Subselector == static_cast<CSSSelector::Relation>(0u), "Subselector must be 0 for consumeCombinator.");
static_assert(sizeof(CSSSelector) == sizeof(SameSizeAsCSSSelector), "CSSSelector should remain small.");

DEFINE_ALLOCATOR_WITH_HEAP_IDENTIFIER(CSSSelectorRareData);

CSSSelector::CSSSelector(const QualifiedName& tagQName, bool tagIsForNamespaceRule)
    : m_relation(std::to_underlying(Relation::DescendantSpace))
    , m_match(std::to_underlying(Match::Tag))
    , m_tagIsForNamespaceRule(tagIsForNamespaceRule)
{
    m_data.tagQName = tagQName.impl();
    m_data.tagQName->ref();
}

void CSSSelector::createRareData()
{
    ASSERT(match() != Match::Tag);
    if (m_hasRareData)
        return;
    // Move the value to the rare data stucture.
    m_data.rareData = &RareData::create(adoptRef(m_data.value)).leakRef();
    m_hasRareData = true;
}

struct SelectorSpecificity {
    unsigned specificity { 0 };

    SelectorSpecificity() = default;
    SelectorSpecificity(unsigned);
    SelectorSpecificity(SelectorSpecificityIncrement);
    SelectorSpecificity& operator+=(SelectorSpecificity);

    std::array<uint8_t, 3> LEGACY_NODELETE specificityTuple() const
    {
        uint8_t a = specificity >> 16;
        uint8_t b = specificity >> 8;
        uint8_t c = specificity;
        return { a, b, c };
    }

    String debugDescription() const
    {
        StringBuilder builder;
        auto tuple = specificityTuple();
        builder.append('{', tuple[0], ' ', tuple[1], ' ', tuple[2], '}');
        return builder.toString();
    }
};

UNUSED_FUNCTION static TextStream& operator<<(TextStream& ts, const SelectorSpecificity& selectorSpecificity)
{
    ts << selectorSpecificity.debugDescription();
    return ts;
}

SelectorSpecificity::SelectorSpecificity(unsigned specificity)
    : specificity(specificity)
{
}

SelectorSpecificity::SelectorSpecificity(SelectorSpecificityIncrement specificity)
    : specificity(std::to_underlying(specificity))
{
}

SelectorSpecificity& SelectorSpecificity::operator+=(SelectorSpecificity other)
{
    auto addSaturating = [&](unsigned mask) {
        unsigned otherValue = (other.specificity & mask);
        if (((specificity & mask) + otherValue) & ~mask)
            specificity |= mask;
        else
            specificity += otherValue;
    };
    addSaturating(0xFF0000);
    addSaturating(0xFF00);
    addSaturating(0xFF);
    return *this;
}

static SelectorSpecificity operator+(SelectorSpecificity a, SelectorSpecificity b)
{
    return a += b;
}

enum class IgnorePseudoElement : bool { No, Yes };

static SelectorSpecificity simpleSelectorSpecificity(const CSSSelector&, IgnorePseudoElement = IgnorePseudoElement::No);

static SelectorSpecificity selectorSpecificity(const CSSSelector& firstSimpleSelector, IgnorePseudoElement ignorePseudoElement = IgnorePseudoElement::No)
{
    SelectorSpecificity total;
    for (const auto* selector = &firstSimpleSelector; selector; selector = selector->precedingInComplexSelector())
        total += simpleSelectorSpecificity(*selector, ignorePseudoElement);
    return total;
}

static SelectorSpecificity maxSpecificity(const CSSSelectorList* selectorList, IgnorePseudoElement ignorePseudoElement = IgnorePseudoElement::No)
{
    unsigned max = 0;
    if (selectorList) {
        for (const auto& selector : *selectorList)
            max = std::max(max, selectorSpecificity(selector, ignorePseudoElement).specificity);
    }
    return max;
}

SelectorSpecificity simpleSelectorSpecificity(const CSSSelector& simpleSelector, IgnorePseudoElement ignorePseudoElement)
{
    ASSERT_WITH_MESSAGE(!simpleSelector.isForPage(), "At the time of this writing, page selectors are not treated as real selectors that are matched. The value computed here only account for real selectors.");

    if (simpleSelector.isImplicit()) [[unlikely]]
        return 0;

    switch (simpleSelector.match()) {
    case CSSSelector::Match::Id:
        return SelectorSpecificityIncrement::ClassA;
    case CSSSelector::Match::NestingParent:
    case CSSSelector::Match::PagePseudoClass:
        break;
    case CSSSelector::Match::PseudoClass:
        switch (simpleSelector.pseudoClass()) {
        case CSSSelector::PseudoClass::Is:
            return maxSpecificity(simpleSelector.selectorList(), IgnorePseudoElement::Yes);
        case CSSSelector::PseudoClass::Not:
        case CSSSelector::PseudoClass::Has:
            return maxSpecificity(simpleSelector.selectorList());
        case CSSSelector::PseudoClass::Where:
            return 0;
        case CSSSelector::PseudoClass::NthChild:
        case CSSSelector::PseudoClass::NthLastChild:
        case CSSSelector::PseudoClass::Host:
            return SelectorSpecificityIncrement::ClassB + maxSpecificity(simpleSelector.selectorList());
        default:
            return SelectorSpecificityIncrement::ClassB;
        }
    case CSSSelector::Match::Exact:
    case CSSSelector::Match::Class:
    case CSSSelector::Match::ClassPrefix:
    case CSSSelector::Match::Set:
    case CSSSelector::Match::List:
    case CSSSelector::Match::Hyphen:
    case CSSSelector::Match::Contain:
    case CSSSelector::Match::Begin:
    case CSSSelector::Match::End:
        return SelectorSpecificityIncrement::ClassB;
    case CSSSelector::Match::Tag:
        if (simpleSelector.tagQName().localName() == starAtom())
            return 0;
        return SelectorSpecificityIncrement::ClassC;
    case CSSSelector::Match::PseudoElement:
        if (ignorePseudoElement == IgnorePseudoElement::Yes)
            return 0;
        switch (simpleSelector.pseudoElement()) {
        // Slotted only competes with other slotted selectors for specificity,
        // so whether we add the ClassC specificity shouldn't be observable.
        case CSSSelector::PseudoElement::Slotted:
            return maxSpecificity(simpleSelector.selectorList());
        case CSSSelector::PseudoElement::Highlight:
        case CSSSelector::PseudoElement::ViewTransitionGroup:
        case CSSSelector::PseudoElement::ViewTransitionImagePair:
        case CSSSelector::PseudoElement::ViewTransitionNew:
        case CSSSelector::PseudoElement::ViewTransitionOld:
            ASSERT(simpleSelector.stringList() && simpleSelector.stringList()->size());
            // Standalone universal selector gets 0 specificity.
            if (simpleSelector.stringList()->first() == universalPseudoElementNameAtom() && simpleSelector.stringList()->size() == 1)
                return 0;
            break;
        default:
            break;
        }
        return SelectorSpecificityIncrement::ClassC;
    case CSSSelector::Match::HasScope:
    case CSSSelector::Match::Unknown:
    case CSSSelector::Match::ForgivingUnknown:
    case CSSSelector::Match::ForgivingUnknownNestContaining:
        return 0;
    }
    ASSERT_NOT_REACHED();
    return 0;
}

unsigned CSSSelector::computeSpecificity() const
{
    return selectorSpecificity(*this).specificity;
}

std::array<uint8_t, 3> CSSSelector::computeSpecificityTuple() const
{
    return selectorSpecificity(*this).specificityTuple();
}

unsigned CSSSelector::specificityForPage() const
{
    ASSERT(isForPage());

    // See http://dev.w3.org/csswg/css3-page/#cascading-and-page-context
    unsigned s = 0;

    for (const CSSSelector* component = this; component; component = component->precedingInComplexSelector()) {
        switch (component->match()) {
        case Match::Tag:
            s += tagQName().localName() == starAtom() ? 0 : 4;
            break;
        case Match::PagePseudoClass:
            switch (component->pagePseudoClass()) {
            case PagePseudoClass::First:
                s += 2;
                break;
            case PagePseudoClass::Left:
            case PagePseudoClass::Right:
                s += 1;
                break;
            }
            break;
        default:
            break;
        }
    }
    return s;
}

WTF_ALLOW_UNSAFE_BUFFER_USAGE_BEGIN
const CSSSelector* CSSSelector::rightmostInCompound() const
{
    auto* selector = this;
    while (auto* preceding = selector->precedingInComplexSelector()) {
        if (selector->relation() != Relation::Subselector)
            break;
        selector = preceding;
    }
    return selector;
}

const CSSSelector* CSSSelector::leftmostInCompound() const
{
    auto* selector = this;
    while (!selector->m_isLastInComplexSelector) {
        auto* next = selector - 1;
        if (next->relation() != Relation::Subselector)
            break;
        selector = next;
    }
    return selector;
}
WTF_ALLOW_UNSAFE_BUFFER_USAGE_END

const CSSSelector* CSSSelector::followingInCompound() const
{
    if (relation() != Relation::Subselector)
        return nullptr;
    return precedingInComplexSelector();
}

void CSSSelector::setAttribute(const QualifiedName& value, AttributeMatchType matchType)
{
    createRareData();
    m_data.rareData->attribute = value;
    m_attributeMatchType = std::to_underlying(matchType);
}

void CSSSelector::setArgument(const AtomString& value)
{
    createRareData();
    m_data.rareData->argument = value;
}

void CSSSelector::setIntegerList(FixedVector<int> integerList)
{
    createRareData();
    m_data.rareData->argumentList = WTF::move(integerList);
}

void CSSSelector::setStringList(FixedVector<AtomString> stringList)
{
    createRareData();
    m_data.rareData->argumentList = WTF::move(stringList);
}

void CSSSelector::setLangList(FixedVector<PossiblyQuotedIdentifier> langList)
{
    createRareData();
    m_data.rareData->argumentList = WTF::move(langList);
}

void CSSSelector::setSelectorList(std::unique_ptr<CSSSelectorList> selectorList)
{
    createRareData();
    m_data.rareData->selectorList = WTF::move(selectorList);
}

void CSSSelector::setNth(int a, int b)
{
    createRareData();
    m_data.rareData->a = a;
    m_data.rareData->b = b;
}

bool CSSSelector::matchNth(int count) const
{
    ASSERT(m_hasRareData);
    return m_data.rareData->matchNth(count);
}

int CSSSelector::nthA() const
{
    ASSERT(m_hasRareData);
    return m_data.rareData->a;
}

int CSSSelector::nthB() const
{
    ASSERT(m_hasRareData);
    return m_data.rareData->b;
}

CSSSelector::RareData::RareData(AtomString&& value)
    : matchingValue(value)
    , serializingValue(WTF::move(value))
    , attribute(anyQName())
{
}

CSSSelector::RareData::RareData(const RareData& other)
    : matchingValue(other.matchingValue)
    , serializingValue(other.serializingValue)
    , a(other.a)
    , b(other.b)
    , attribute(other.attribute)
    , argument(other.argument)
    , argumentList(other.argumentList)
{
    if (other.selectorList)
        this->selectorList = makeUnique<CSSSelectorList>(*other.selectorList);
};

auto CSSSelector::RareData::deepCopy() const -> Ref<RareData>
{
    return adoptRef(*new RareData (*this));
}

CSSSelector::RareData::~RareData() = default;

auto CSSSelector::RareData::create(AtomString value) -> Ref<RareData>
{
    return adoptRef(*new RareData(WTF::move(value)));
}

bool CSSSelector::RareData::matchNth(int count)
{
    if (a > 0)
        return count >= b && !((count - b) % a);
    if (a < 0)
        return count <= b && !((b - count) % -a);
    return count == b;
}

bool CSSSelector::RareData::equals(const RareData& other) const
{
    if (selectorList || other.selectorList) {
        if (!selectorList || !other.selectorList || *selectorList != *other.selectorList)
            return false;
    }
    return matchingValue == other.matchingValue
        && serializingValue == other.serializingValue
        && a == other.a
        && b == other.b
        && attribute == other.attribute
        && argument == other.argument
        && argumentList == other.argumentList;
}

CSSSelector::CSSSelector(const CSSSelector& other)
    : m_relation(other.m_relation)
    , m_match(other.m_match)
    , m_pseudoType(other.m_pseudoType)
    , m_isFirstInComplexSelector(other.m_isFirstInComplexSelector)
    , m_isLastInComplexSelector(other.m_isLastInComplexSelector)
    , m_hasRareData(other.m_hasRareData)
    , m_isForPage(other.m_isForPage)
    , m_tagIsForNamespaceRule(other.m_tagIsForNamespaceRule)
    , m_attributeMatchType(other.m_attributeMatchType)
    , m_isImplicit(other.m_isImplicit)
    , m_isEquivalentToClassSelector(other.m_isEquivalentToClassSelector)
{
    // Manually ref count the m_data union because they are stored as raw ptr, not as Ref.
    if (other.m_hasRareData)
        m_data.rareData = &protect(other.m_data.rareData)->deepCopy().leakRef();
    else if (other.match() == Match::Tag) {
        m_data.tagQName = other.m_data.tagQName;
        m_data.tagQName->ref();
    } else if (other.m_data.value) {
        m_data.value = other.m_data.value;
        m_data.value->ref();
    }
}

CSSSelector::CSSSelector(const CSSSelector& other, MutableSelectorCopyTag)
    : CSSSelector(other)
{
    // Restore the selector list bits to the initial state when copying to a MutableCSSSelector.
    m_isFirstInComplexSelector = true;
    m_isLastInComplexSelector = true;
}

bool CSSSelector::visitSimpleSelectors(NOESCAPE const VisitFunctor& functor, VisitFunctionalPseudoClasses visitFunctionalPseudoClasses, VisitOnlySubject visitOnlySubject) const
{
    Deque<const CSSSelector*, 16> worklist;
    worklist.append(this);
    while (!worklist.isEmpty()) {
        auto current = worklist.takeFirst();

        if (functor(*current))
            return true;

        // Visit the selector list member (if any) recursively (such as: :has(<list>), :is(<list>),...)
        if (visitFunctionalPseudoClasses == VisitFunctionalPseudoClasses::Yes) {
            if (auto selectorList = current->selectorList()) {
                for (auto& selector : *selectorList)
                    worklist.append(&selector);
            }
        }

        // Visit the next simple selector
        if (auto next = current->precedingInComplexSelector()) {
            // We stop visiting at the end of the compound selector (= when relation is anything else than subselector) if we are in subject only mode.
            if (current->relation() != Relation::Subselector || visitOnlySubject != VisitOnlySubject::Yes)
                worklist.append(next);
        }
    }
    return false;
}

bool CSSSelector::hasExplicitNestingParent() const
{
    return visitSimpleSelectors([](const CSSSelector& selector) {
        if (selector.match() == Match::NestingParent)
            return true;

        if (selector.match() == Match::ForgivingUnknownNestContaining)
            return true;

        return false;
    } , VisitFunctionalPseudoClasses::Yes);
}

bool CSSSelector::hasExplicitPseudoClassScope() const
{
    return visitSimpleSelectors([] (const CSSSelector& selector) {
        if (selector.isScopePseudoClass())
            return true;
        return false;
    }, VisitFunctionalPseudoClasses::Yes);
}

bool CSSSelector::isHostPseudoClass() const
{
    return match() == Match::PseudoClass && pseudoClass() == PseudoClass::Host;
}

bool CSSSelector::isScopePseudoClass() const
{
    return match() == Match::PseudoClass && pseudoClass() == PseudoClass::Scope;
}

bool CSSSelector::isHasPseudoClass() const
{
    return match() == Match::PseudoClass && pseudoClass() == PseudoClass::Has;
}

bool CSSSelector::hasScope() const
{
    return visitSimpleSelectors([] (auto& selector) {
        if (selector.isScopePseudoClass())
            return true;
        return false;
    });
}

bool complexSelectorCanMatchPseudoElement(const CSSSelector& complexSelector)
{
    const CSSSelector* selector = &complexSelector;
    do {
        if (selector->matchesPseudoElement())
            return true;

        // FIXME: This is probably unneeded as functional pseudo-classes can't contain valid pseudo elements.
        if (const CSSSelectorList* selectorList = selector->selectorList()) {
            for (auto& subSelector : *selectorList) {
                if (complexSelectorCanMatchPseudoElement(subSelector))
                    return true;
            }
        }

        selector = selector->precedingInComplexSelector();
    } while (selector);
    return false;
}

bool complexSelectorMatchesElementBackedPseudoElement(const CSSSelector& complexSelector)
{
    auto isElementBacked = [](CSSSelector::PseudoElement pseudoElement) {
        switch (pseudoElement) {
        case CSSSelector::PseudoElement::Slotted:
        case CSSSelector::PseudoElement::Part:
        case CSSSelector::PseudoElement::Picker:
        case CSSSelector::PseudoElement::UserAgentPart:
        case CSSSelector::PseudoElement::UserAgentPartLegacyAlias:
            return true;
        default:
            return false;
        }
    };

    auto result = false;
    for (auto* simpleSelector = &complexSelector; simpleSelector; simpleSelector = simpleSelector->followingInCompound()) {
        if (simpleSelector->matchesPseudoElement()) {
            if (!isElementBacked(simpleSelector->pseudoElement()))
                return false;
            result = true;
        }
    }
    return result;
}

bool CSSSelector::simpleSelectorEqual(const CSSSelector& other) const
{
    auto valuesEqual = [&] {
        if (m_hasRareData)
            return protect(m_data.rareData)->equals(*protect(other.m_data.rareData));
        if (match() == Match::Tag)
            return *m_data.tagQName == *other.m_data.tagQName;
        return m_data.value == other.m_data.value;
    };

    // Relation and selector list bits are ignored.
    return m_match == other.m_match
        && m_pseudoType == other.m_pseudoType
        && m_hasRareData == other.m_hasRareData
        && m_tagIsForNamespaceRule == other.m_tagIsForNamespaceRule
        && m_attributeMatchType == other.m_attributeMatchType
        && m_isImplicit == other.m_isImplicit
        && valuesEqual();
}

bool isElementBackedPseudoElement(CSSSelector::PseudoElement pseudoElement)
{
    switch (pseudoElement) {
    case CSSSelector::PseudoElement::Part:
    case CSSSelector::PseudoElement::Picker:
    case CSSSelector::PseudoElement::Slotted:
    case CSSSelector::PseudoElement::UserAgentPart:
    case CSSSelector::PseudoElement::UserAgentPartLegacyAlias:
#if ENABLE(VIDEO)
    case CSSSelector::PseudoElement::Cue:
#endif
        return true;
    default:
        return false;
    }
}

static bool LEGACY_NODELETE shouldSkipForEqualMode(const CSSSelector& simpleSelector, ComplexSelectorsEqualMode mode)
{
    if (mode == ComplexSelectorsEqualMode::IgnoreNonElementBackedPseudoElements)
        return simpleSelector.matchesPseudoElement() && !isElementBackedPseudoElement(simpleSelector.pseudoElement());
    return false;
};

bool complexSelectorsEqual(const CSSSelector& complexA, const CSSSelector& complexB, ComplexSelectorsEqualMode mode)
{
    auto aRelation = CSSSelector::Relation::Subselector;
    auto bRelation = CSSSelector::Relation::Subselector;

    for (auto a = &complexA, b = &complexB; a || b; a = a->precedingInComplexSelector(), b = b->precedingInComplexSelector()) {
        if (a && shouldSkipForEqualMode(*a, mode)) {
            aRelation = a->relation();
            a = a->precedingInComplexSelector();
        }
        if (b && shouldSkipForEqualMode(*b, mode)) {
            bRelation = b->relation();
            b = b->precedingInComplexSelector();
        }
        if (!a || !b)
            return a == b;
        if (aRelation != bRelation)
            return false;
        if (!a->simpleSelectorEqual(*b))
            return false;
        aRelation = a->relation();
        bRelation = b->relation();
    }
    return true;
}

static void LEGACY_NODELETE addSimpleSelector(Hasher& hasher, const CSSSelector& simpleSelector)
{
    // This hash does try to include every possible thing in a selector.
    add(hasher, simpleSelector.match());

    switch (simpleSelector.match()) {
    case CSSSelector::Match::Tag:
        add(hasher, simpleSelector.tagQName());
        break;
    case CSSSelector::Match::PseudoClass:
        add(hasher, simpleSelector.pseudoClass());
        break;
    case CSSSelector::Match::PseudoElement:
        add(hasher, simpleSelector.pseudoElement());
        break;
    case CSSSelector::Match::Exact:
    case CSSSelector::Match::Set:
    case CSSSelector::Match::List:
    case CSSSelector::Match::Hyphen:
    case CSSSelector::Match::Begin:
    case CSSSelector::Match::End:
    case CSSSelector::Match::Contain:
        add(hasher, simpleSelector.attribute());
        add(hasher, simpleSelector.value());
        break;
    default:
        add(hasher, simpleSelector.value());
        break;
    }
    if (simpleSelector.selectorList())
        add(hasher, *simpleSelector.selectorList());
}

void addComplexSelector(Hasher& hasher, const CSSSelector& complexSelector, ComplexSelectorsEqualMode mode)
{
    auto relationToRight = CSSSelector::Relation::Subselector;
    for (auto simpleSelector = &complexSelector; simpleSelector; simpleSelector = simpleSelector->precedingInComplexSelector()) {
        if (shouldSkipForEqualMode(*simpleSelector, mode)) {
            relationToRight = simpleSelector->relation();
            continue;
        }
        add(hasher, relationToRight);
        addSimpleSelector(hasher, *simpleSelector);
        relationToRight = simpleSelector->relation();
    }
}

} // namespace WebCore
