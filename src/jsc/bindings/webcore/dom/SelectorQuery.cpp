/*
 * Copyright (C) 2011-2020 Apple Inc. All rights reserved.
 * Copyright (C) 2014 Yusuke Suzuki <utatane.tea@gmail.com>
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "SelectorQuery.h"

#include "BunSelectorParser.h"
#include "CommonAtomStrings.h"
#include "ElementAncestorIteratorInlines.h"
#include "HTMLBaseElement.h"
#include "HTMLNames.h"
#include "SelectorChecker.h"
#include "StaticNodeList.h"
#include "StyledElement.h"
#include "TreeScopeInlines.h"
#include "TypedElementDescendantIteratorInlines.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(SelectorQuery);
WTF_MAKE_TZONE_ALLOCATED_IMPL(SelectorQueryCache);

#if ASSERT_ENABLED
static bool isSingleTagNameSelector(const CSSSelector& selector)
{
    return !selector.precedingInComplexSelector() && selector.match() == CSSSelector::Match::Tag;
}

static bool isSingleClassNameSelector(const CSSSelector& selector)
{
    return !selector.precedingInComplexSelector() && selector.match() == CSSSelector::Match::Class;
}

static bool isSingleAttributeExactSelector(const CSSSelector& selector)
{
    return !selector.precedingInComplexSelector() && selector.match() == CSSSelector::Match::Exact;
}

#endif // ASSERT_ENABLED

enum class IdMatchingType : uint8_t {
    None,
    Rightmost,
    Filter
};

template<typename Output> static ALWAYS_INLINE void appendOutputForElement(Output& output, Element& element)
{
    if constexpr (std::is_same_v<Output, Element*>) {
        ASSERT(!output);
        output = &element;
    } else
        output.append(element);
}

static bool LEGACY_NODELETE canBeUsedForIdFastPath(const CSSSelector& selector)
{
    return selector.match() == CSSSelector::Match::Id
        || (selector.match() == CSSSelector::Match::Exact && selector.attribute() == HTMLNames::idAttr && selector.attributeMatchType() != CSSSelector::AttributeMatchType::CaseInsensitive);
}

static IdMatchingType LEGACY_NODELETE findIdMatchingType(const CSSSelector& firstSelector)
{
    bool inRightmost = true;
    for (const CSSSelector* selector = &firstSelector; selector; selector = selector->precedingInComplexSelector()) {
        if (canBeUsedForIdFastPath(*selector)) {
            if (inRightmost)
                return IdMatchingType::Rightmost;
            return IdMatchingType::Filter;
        }
        if (selector->relation() != CSSSelector::Relation::Subselector)
            inRightmost = false;
    }
    return IdMatchingType::None;
}

static bool canOptimizeSingleAttributeExactMatch(const CSSSelector& selector)
{
    if (selector.attributeMatchType() != CSSSelector::AttributeMatchType::CaseSensitive)
        return false;

    const auto& attribute = selector.attribute();

    // Bailout if we need to synchronize attributes.
    if (Attribute::nameMatchesFilter(HTMLNames::styleAttr, attribute.prefix(), attribute.localNameLowercase(), attribute.namespaceURI()))
        return false;

    return true;
}

SelectorDataList::SelectorDataList(const CSSSelectorList& selectorList)
{
    m_selectors = FixedVector<SelectorData>::map(selectorList, [](auto& selector) {
        return SelectorData { selector };
    });

    if (m_selectors.size() == 1) {
        const CSSSelector& selector = m_selectors.first().selector;
        if (!selector.precedingInComplexSelector()) {
            switch (selector.match()) {
            case CSSSelector::Match::Tag:
                m_matchType = MatchType::TagNameMatch;
                break;
            case CSSSelector::Match::Class:
                m_matchType = MatchType::ClassNameMatch;
                break;
            case CSSSelector::Match::Exact:
                if (canBeUsedForIdFastPath(selector))
                    m_matchType = MatchType::RightMostWithIdMatch; // [id="name"] pattern goes here.
                else if (canOptimizeSingleAttributeExactMatch(selector))
                    m_matchType = MatchType::AttributeExactMatch;
                else
                    m_matchType = MatchType::SingleSelector;
                break;
            default:
                if (canBeUsedForIdFastPath(selector))
                    m_matchType = MatchType::RightMostWithIdMatch;
                else
                    m_matchType = MatchType::SingleSelector;
                break;
            }
        } else {
            switch (findIdMatchingType(selector)) {
            case IdMatchingType::None:
                m_matchType = MatchType::SingleSelector;
                break;
            case IdMatchingType::Rightmost:
                m_matchType = MatchType::RightMostWithIdMatch;
                break;
            case IdMatchingType::Filter:
                m_matchType = MatchType::SingleSelectorWithRootFilter;
                break;
            }
        }
    } else
        m_matchType = MatchType::MultipleSelectorMatch;
}

inline bool SelectorDataList::selectorMatches(const SelectorData& selectorData, Element& element, const ContainerNode& rootNode) const
{
    SelectorChecker selectorChecker(element.document());
    SelectorChecker::CheckingContext selectorCheckingContext;
    selectorCheckingContext.scope = rootNode.isDocumentNode() ? nullptr : &rootNode;

    return selectorChecker.match(selectorData.selector, element, selectorCheckingContext);
}

bool SelectorDataList::matches(Element& targetElement) const
{
    for (auto& selector : m_selectors) {
        if (selectorMatches(selector, targetElement, targetElement))
            return true;
    }
    return false;
}

RefPtr<Element> SelectorDataList::closest(Element& targetElement) const
{
    // Providing SelectorMatchingState allows cross-element optimizations like caching for :has() matches.
    Style::SelectorMatchingState selectorMatchingState;
    SelectorChecker selectorChecker(targetElement.document());
    SelectorChecker::CheckingContext selectorCheckingContext;
    selectorCheckingContext.scope = &targetElement;
    selectorCheckingContext.selectorMatchingState = &selectorMatchingState;

    for (Ref currentElement : lineageOfType<Element>(targetElement)) {
        for (auto& selector : m_selectors) {
            if (selectorChecker.match(selector.selector, currentElement, selectorCheckingContext))
                return currentElement;
        }
    }
    return nullptr;
}

Ref<NodeList> SelectorDataList::queryAll(ContainerNode& rootNode) const
{
    Vector<Ref<Element>> result;
    execute(rootNode, result);
    return StaticElementList::create(WTF::move(result));
}

Element* SelectorDataList::queryFirst(ContainerNode& rootNode) const
{
    Element* result = nullptr;
    execute(rootNode, result);
    return result;
}

static const CSSSelector* LEGACY_NODELETE selectorForIdLookup(const ContainerNode& rootNode, const CSSSelector& firstSelector)
{
    if (!rootNode.isConnected())
        return nullptr;
    if (rootNode.document().inQuirksMode())
        return nullptr;

    for (const CSSSelector* selector = &firstSelector; selector; selector = selector->followingInCompound()) {
        if (canBeUsedForIdFastPath(*selector))
            return selector;
    }

    return nullptr;
}

template<typename OutputType>
ALWAYS_INLINE void SelectorDataList::executeFastPathForIdSelector(const ContainerNode& rootNode, const SelectorData& selectorData, const CSSSelector* idSelector, OutputType& output) const
{
    ASSERT(m_selectors.size() == 1);
    ASSERT(idSelector);

    const AtomString& idToMatch = idSelector->value();
    if (rootNode.treeScope().containsMultipleElementsWithId(idToMatch)) [[unlikely]] {
        auto* elements = protect(rootNode.treeScope())->getAllElementsById(idToMatch);
        ASSERT(elements);
        bool rootNodeIsTreeScopeRoot = rootNode.isTreeScope();
        for (auto& element : *elements) {
            if ((rootNodeIsTreeScopeRoot || element->isDescendantOf(rootNode)) && selectorMatches(selectorData, protect(element), rootNode)) {
                appendOutputForElement(output, protect(element));
                if constexpr (std::is_same_v<OutputType, Element*>)
                    return;
            }
        }
        return;
    }

    RefPtr element = protect(rootNode.treeScope())->getElementById(idToMatch);
    if (!element || !(rootNode.isTreeScope() || element->isDescendantOf(rootNode)))
        return;
    if (selectorMatches(selectorData, *element, rootNode))
        appendOutputForElement(output, *element);
}

static Ref<ContainerNode> filterRootById(ContainerNode& rootNode, const CSSSelector& firstSelector)
{
    if (!rootNode.isConnected())
        return rootNode;
    if (rootNode.document().inQuirksMode())
        return rootNode;

    // If there was an Id match in the rightmost Simple Selector, we should be in a RightMostWithIdMatch, not in filter.
    // Thus we can skip the rightmost match.
    const CSSSelector* selector = &firstSelector;
    do {
        ASSERT(!canBeUsedForIdFastPath(*selector));
        if (selector->relation() != CSSSelector::Relation::Subselector)
            break;
        selector = selector->precedingInComplexSelector();
    } while (selector);

    bool inAdjacentChain = false;
    for (; selector; selector = selector->precedingInComplexSelector()) {
        if (canBeUsedForIdFastPath(*selector)) {
            const AtomString& idToMatch = selector->value();
            if (RefPtr<ContainerNode> searchRoot = protect(rootNode.treeScope())->getElementById(idToMatch)) {
                if (!rootNode.treeScope().containsMultipleElementsWithId(idToMatch)) [[likely]] {
                    if (inAdjacentChain)
                        searchRoot = searchRoot->parentNode();
                    if (searchRoot && (rootNode.isTreeScope() || searchRoot->isInclusiveDescendantOf(rootNode)))
                        return searchRoot.releaseNonNull();
                }
            }
        }
        if (selector->relation() == CSSSelector::Relation::Subselector)
            continue;
        inAdjacentChain = selector->relation() == CSSSelector::Relation::DirectAdjacent || selector->relation() == CSSSelector::Relation::IndirectAdjacent;
    }
    return rootNode;
}

static ALWAYS_INLINE bool LEGACY_NODELETE localNameMatches(const Element& element, const AtomString& localName, const AtomString& lowercaseLocalName)
{
    if (element.isHTMLElement() && element.document().isHTMLDocument())
        return element.localName() == lowercaseLocalName;
    return element.localName() == localName;

}

template<typename OutputType>
static inline void elementsForLocalName(const ContainerNode& rootNode, const AtomString& localName, const AtomString& lowercaseLocalName, OutputType& output)
{
    if (auto* rootDocument = dynamicDowncast<Document>(rootNode); rootDocument && lowercaseLocalName == HTMLNames::baseTag->localName()) {
        RefPtr firstBaseElement = rootDocument->firstBaseElement();
        if (!firstBaseElement)
            return;
        if constexpr (std::is_same_v<OutputType, Element*>) {
            appendOutputForElement(output, *firstBaseElement);
            return;
        }
    }

    if (localName == lowercaseLocalName) {
        for (Ref element : descendantsOfType<Element>(const_cast<ContainerNode&>(rootNode))) {
            if (element->tagQName().localName() == localName) {
                appendOutputForElement(output, element);
                if constexpr (std::is_same_v<OutputType, Element*>)
                return;
            }
        }
    } else {
        for (Ref element : descendantsOfType<Element>(const_cast<ContainerNode&>(rootNode))) {
            if (localNameMatches(element, localName, lowercaseLocalName)) {
                appendOutputForElement(output, element);
                if constexpr (std::is_same_v<OutputType, Element*>)
                return;
            }
        }
    }
}

template<typename OutputType>
static inline void anyElement(const ContainerNode& rootNode, OutputType& output)
{
    for (Ref element : descendantsOfType<Element>(const_cast<ContainerNode&>(rootNode))) {
        appendOutputForElement(output, element);
        if constexpr (std::is_same_v<OutputType, Element*>)
            return;
    }
}


template<typename OutputType>
ALWAYS_INLINE void SelectorDataList::executeSingleTagNameSelectorData(const ContainerNode& rootNode, const SelectorData& selectorData, OutputType& output) const
{
    ASSERT(m_selectors.size() == 1);
    ASSERT(isSingleTagNameSelector(selectorData.selector));

    const QualifiedName& tagQualifiedName = selectorData.selector.tagQName();
    const AtomString& selectorLocalName = tagQualifiedName.localName();
    const AtomString& selectorLowercaseLocalName = selectorData.selector.tagLowercaseLocalName();
    const AtomString& selectorNamespaceURI = tagQualifiedName.namespaceURI();

    if (selectorNamespaceURI == starAtom()) {
        if (selectorLocalName != starAtom()) {
            // Common case: name defined, selectorNamespaceURI is a wildcard.
            elementsForLocalName(rootNode, selectorLocalName, selectorLowercaseLocalName, output);
        } else {
            // Other fairly common case: both are wildcards.
            anyElement(rootNode, output);
        }
    } else {
        // Fallback: NamespaceURI is set, selectorLocalName may be starAtom().
        for (Ref element : descendantsOfType<Element>(const_cast<ContainerNode&>(rootNode))) {
            if (element->namespaceURI() == selectorNamespaceURI && localNameMatches(element, selectorLocalName, selectorLowercaseLocalName)) {
                appendOutputForElement(output, element);
                if constexpr (std::is_same_v<OutputType, Element*>)
                    return;
            }
        }
    }
}

template<typename OutputType>
ALWAYS_INLINE void SelectorDataList::executeSingleClassNameSelectorData(const ContainerNode& rootNode, const SelectorData& selectorData, OutputType& output) const
{
    ASSERT(m_selectors.size() == 1);
    ASSERT(isSingleClassNameSelector(selectorData.selector));

    const AtomString& className = selectorData.selector.value();
    for (Ref element : descendantsOfType<Element>(const_cast<ContainerNode&>(rootNode))) {
        if (element->hasClassName(className)) {
            appendOutputForElement(output, element);
            if constexpr (std::is_same_v<OutputType, Element*>)
                return;
        }
    }
}

AtomString SelectorDataList::classNameToMatch() const
{
    if (m_matchType != MatchType::ClassNameMatch)
        return nullAtom();
    ASSERT(m_selectors.size() == 1);
    ASSERT(isSingleClassNameSelector(m_selectors.first().selector));
    return m_selectors.first().selector.value();
}

template<typename OutputType>
ALWAYS_INLINE void SelectorDataList::executeSingleAttributeExactSelectorData(const ContainerNode& rootNode, const SelectorData& selectorData, OutputType& output) const
{
    ASSERT(m_selectors.size() == 1);
    ASSERT(isSingleAttributeExactSelector(selectorData.selector));
    ASSERT(canOptimizeSingleAttributeExactMatch(selectorData.selector));

    const auto& selectorAttribute = selectorData.selector.attribute();
    const auto& selectorValue = selectorData.selector.value();
    const auto& localNameLowercase = selectorAttribute.localNameLowercase();
    const auto& localName = selectorAttribute.localName();
    const auto& prefix = selectorAttribute.prefix();
    const auto& namespaceURI = selectorAttribute.namespaceURI();

    bool foundFirstMatch = false;
    CheckedPtr<Element> cachedContainer;
    if (rootNode.isDocumentNode())
        cachedContainer = rootNode.document().cachedFirstElementWithAttribute(selectorAttribute);

    bool documentIsHTML = rootNode.document().isHTMLDocument();

    auto elementDescendants = descendantsOfType<Element>(const_cast<ContainerNode&>(rootNode));
    for (auto it = cachedContainer ? elementDescendants.beginAt(*cachedContainer) : elementDescendants.begin(); it; ++it) {
        Ref element = *it;
        if (!element->hasAttributesWithoutUpdate())
            continue;

        bool isHTML = documentIsHTML && element->isHTMLElement();
        const auto& localNameToMatch = isHTML ? localNameLowercase : localName;
        for (auto& attribute : element->attributes()) {
            if (!attribute.matches(prefix, localNameToMatch, namespaceURI))
                continue;

            if (!foundFirstMatch && rootNode.isDocumentNode()) {
                foundFirstMatch = true;
                protect(rootNode.document())->setCachedFirstElementWithAttribute(selectorAttribute, element);
            }

            if (selectorValue == attribute.value()) {
                appendOutputForElement(output, element);
                if constexpr (std::is_same_v<OutputType, Element*>)
                    return;
                break;
            }
        }
    }
}

template<typename OutputType>
ALWAYS_INLINE void SelectorDataList::executeSingleSelectorData(const ContainerNode& rootNode, const ContainerNode& searchRootNode, const SelectorData& selectorData, OutputType& output) const
{
    ASSERT(m_selectors.size() == 1);

    Style::SelectorMatchingState selectorMatchingState;
    SelectorChecker selectorChecker(rootNode.document());
    SelectorChecker::CheckingContext selectorCheckingContext;
    selectorCheckingContext.scope = rootNode.isDocumentNode() ? nullptr : &rootNode;
    selectorCheckingContext.selectorMatchingState = &selectorMatchingState;

    for (Ref element : descendantsOfType<Element>(const_cast<ContainerNode&>(searchRootNode))) {
        if (selectorChecker.match(selectorData.selector, element, selectorCheckingContext)) {
            appendOutputForElement(output, element);
            if constexpr (std::is_same_v<OutputType, Element*>)
                return;
        }
    }
}

template<typename OutputType>
ALWAYS_INLINE void SelectorDataList::executeSingleMultiSelectorData(const ContainerNode& rootNode, OutputType& output) const
{
    Style::SelectorMatchingState selectorMatchingState;
    SelectorChecker selectorChecker(rootNode.document());
    SelectorChecker::CheckingContext selectorCheckingContext;
    selectorCheckingContext.scope = rootNode.isDocumentNode() ? nullptr : &rootNode;
    selectorCheckingContext.selectorMatchingState = &selectorMatchingState;

    for (Ref element : descendantsOfType<Element>(const_cast<ContainerNode&>(rootNode))) {
        for (auto& selector : m_selectors) {
            if (selectorChecker.match(selector.selector, element, selectorCheckingContext)) {
                appendOutputForElement(output, element);
                if constexpr (std::is_same_v<OutputType, Element*>)
                    return;
                break;
            }
        }
    }
}

template<typename OutputType>
ALWAYS_INLINE void SelectorDataList::execute(ContainerNode& rootNode, OutputType& output) const
{
    RefPtr<ContainerNode> searchRootNode = &rootNode;
    switch (m_matchType) {
    case MatchType::RightMostWithIdMatch:
        {
        const SelectorData& selectorData = m_selectors.first();
        if (const CSSSelector* idSelector = selectorForIdLookup(*searchRootNode, selectorData.selector)) {
            executeFastPathForIdSelector(*searchRootNode, m_selectors.first(), idSelector, output);
            break;
        }
        goto SingleSelectorCase;
        ASSERT_NOT_REACHED();
        }

    case MatchType::SingleSelectorWithRootFilter:
        searchRootNode = filterRootById(*searchRootNode, m_selectors.first().selector);
        [[fallthrough]];
    case MatchType::SingleSelector:
        SingleSelectorCase:
        executeSingleSelectorData(rootNode, *searchRootNode, m_selectors.first(), output);
        break;

    case MatchType::TagNameMatch:
        executeSingleTagNameSelectorData(*searchRootNode, m_selectors.first(), output);
        break;
    case MatchType::ClassNameMatch:
        executeSingleClassNameSelectorData(*searchRootNode, m_selectors.first(), output);
        break;
    case MatchType::AttributeExactMatch:
        executeSingleAttributeExactSelectorData(*searchRootNode, m_selectors.first(), output);
        break;
    case MatchType::MultipleSelectorMatch:
        executeSingleMultiSelectorData(*searchRootNode, output);
        break;
    }
}

SelectorQuery::SelectorQuery(CSSSelectorList&& selectorList)
    : m_selectorList(WTF::move(selectorList))
    , m_selectors(m_selectorList)
{
}

SelectorQuery* SelectorQueryCache::add(const String& selectors, const Document& document)
{
    ASSERT(!selectors.isEmpty());

    bool inQuirksMode = document.inQuirksMode();
    auto& entries = inQuirksMode ? m_quirksModeEntries : m_entries;

    auto result = entries.ensure(selectors, [&] -> std::unique_ptr<SelectorQuery> {
        auto selectorList = parseCSSSelectorList(selectors, inQuirksMode);

        if (!selectorList)
            return nullptr;

        return makeUnique<SelectorQuery>(WTF::move(*selectorList));
    });

    auto* query = result.iterator->value.get();
    constexpr auto maximumSelectorQueryCacheSize = 512;
    while (entries.size() > maximumSelectorQueryCacheSize) {
        auto it = entries.random();
        if (it->key != result.iterator->key)
            entries.remove(it);
    }

    return query;
}

void SelectorQueryCache::clear()
{
    m_entries.clear();
    m_quirksModeEntries.clear();
}

}
