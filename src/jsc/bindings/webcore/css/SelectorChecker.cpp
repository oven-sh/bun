/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 2004-2005 Allan Sandfeld Jensen (kde@carewolf.com)
 * Copyright (C) 2006, 2007 Nicholas Shanks (webkit@nickshanks.com)
 * Copyright (C) 2005-2016 Apple Inc. All rights reserved.
 * Copyright (C) 2007 Alexey Proskuryakov <ap@webkit.org>
 * Copyright (C) 2007, 2008 Eric Seidel <eric@webkit.org>
 * Copyright (C) 2008, 2009 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
 * Copyright (c) 2011, Code Aurora Forum. All rights reserved.
 * Copyright (C) Research In Motion Limited 2011. All rights reserved.
 * Copyright (C) 2014 Yusuke Suzuki <utatane.tea@gmail.com>
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
#include "SelectorChecker.h"

#include "CSSSelector.h"
#include "CSSSelectorList.h"
#include "CommonAtomStrings.h"
#include "Document.h"
#include "ElementChildIteratorInlines.h"
#include "ElementInlinesLight.h"
#include "ElementRareData.h"
#include "ElementTraversal.h"
#include "HTMLHeadingElement.h"
#include "HTMLNames.h"
#include "NodeInlinesLight.h"
#include "SelectorCheckerTestFunctions.h"
#include "ShadowRoot.h"
#include "Text.h"
#include "TypedElementDescendantIteratorInlines.h"

namespace WebCore {

using namespace HTMLNames;

struct SelectorChecker::LocalContext {
    LocalContext(const CSSSelector& selector, const Element& element)
        : selector(&selector)
        , element(&element)
        , firstSelectorOfTheFragment(&selector)
    { }

    const CSSSelector* selector;
    CheckedPtr<const Element> element;
    const CSSSelector* firstSelectorOfTheFragment;
    bool inFunctionalPseudoClass { false };
    bool mustMatchHostPseudoClass { false };
    bool matchedHostPseudoClass { false };
};

static inline bool LEGACY_NODELETE isFirstChildElement(const Element& element)
{
    return !ElementTraversal::previousSibling(element);
}

static inline bool LEGACY_NODELETE isLastChildElement(const Element& element)
{
    return !ElementTraversal::nextSibling(element);
}

static inline bool LEGACY_NODELETE isFirstOfType(const Element& element, const QualifiedName& type)
{
    for (const Element* sibling = ElementTraversal::previousSibling(element); sibling; sibling = ElementTraversal::previousSibling(*sibling)) {
        if (sibling->hasTagName(type))
            return false;
    }
    return true;
}

static inline bool LEGACY_NODELETE isLastOfType(const Element& element, const QualifiedName& type)
{
    for (const Element* sibling = ElementTraversal::nextSibling(element); sibling; sibling = ElementTraversal::nextSibling(*sibling)) {
        if (sibling->hasTagName(type))
            return false;
    }
    return true;
}

static inline int LEGACY_NODELETE countElementsBefore(const Element& element)
{
    int count = 0;
    for (auto* sibling = ElementTraversal::previousSibling(element); sibling; sibling = ElementTraversal::previousSibling(*sibling))
        count++;
    return count;
}

static inline int LEGACY_NODELETE countElementsOfTypeBefore(const Element& element, const QualifiedName& type)
{
    int count = 0;
    for (const Element* sibling = ElementTraversal::previousSibling(element); sibling; sibling = ElementTraversal::previousSibling(*sibling)) {
        if (sibling->hasTagName(type))
            ++count;
    }
    return count;
}

static inline int LEGACY_NODELETE countElementsAfter(const Element& element)
{
    int count = 0;
    for (const Element* sibling = ElementTraversal::nextSibling(element); sibling; sibling = ElementTraversal::nextSibling(*sibling))
        ++count;
    return count;
}

static inline int LEGACY_NODELETE countElementsOfTypeAfter(const Element& element, const QualifiedName& type)
{
    int count = 0;
    for (const Element* sibling = ElementTraversal::nextSibling(element); sibling; sibling = ElementTraversal::nextSibling(*sibling)) {
        if (sibling->hasTagName(type))
            ++count;
    }
    return count;
}

SelectorChecker::SelectorChecker(Document& document)
    : m_strictParsing(!document.inQuirksMode())
    , m_documentIsHTML(document.isHTMLDocument())
{
}

bool SelectorChecker::match(const CSSSelector& selector, const Element& element, CheckingContext& checkingContext) const
{
    ASSERT_WITH_SECURITY_IMPLICATION(!selector.destructorHasBeenCalled());

    LocalContext context(selector, element);

    if (checkingContext.mustMatchHostPseudoClass) {
        ASSERT(element.shadowRoot());
        // Rules coming from the element's shadow tree must match :host pseudo class.
        context.mustMatchHostPseudoClass = true;
    }

    return matchRecursively(checkingContext, context) == Match::SelectorMatches;
}

bool SelectorChecker::matchHostPseudoClass(const CSSSelector& selector, const Element& element, CheckingContext& checkingContext) const
{
    if (!element.shadowRoot())
        return false;

    if (auto* selectorList = selector.selectorList()) {
        ASSERT(selectorList->size() == 1);
        LocalContext context(selectorList->first(), element);
        context.inFunctionalPseudoClass = true;
        if (matchRecursively(checkingContext, context) != Match::SelectorMatches)
            return false;
    }
    return true;
}

static SelectorChecker::LocalContext localContextForParent(const SelectorChecker::LocalContext& context)
{
    SelectorChecker::LocalContext updatedContext(context);

    if (updatedContext.mustMatchHostPseudoClass) {
        updatedContext.element = nullptr;
        return updatedContext;
    }

    // Move to the shadow host if the parent is the shadow root and mark that we must match :host
    if (auto* shadowRoot = dynamicDowncast<ShadowRoot>(context.element->parentNode())) {
        updatedContext.element = shadowRoot->host();
        updatedContext.mustMatchHostPseudoClass = true;
        return updatedContext;
    }

    updatedContext.element = context.element->parentElement();
    return updatedContext;
}

static bool isScopeOnlyCompoundSelector(const CSSSelector& selector)
{
    if (selector.match() != CSSSelector::Match::PseudoClass || selector.precedingInComplexSelector())
        return false;
    switch (selector.pseudoClass()) {
    case CSSSelector::PseudoClass::Scope:
        return true;
    case CSSSelector::PseudoClass::Is:
    case CSSSelector::PseudoClass::Where:
        for (auto& subselector : *selector.selectorList()) {
            if (isScopeOnlyCompoundSelector(subselector))
                return true;
        }
        return false;
    default:
        return false;
    }
}

// A document scoping root is not an element, so the ancestor traversal never reaches it.
static bool matchesDocumentScopingRoot(const SelectorChecker::CheckingContext& checkingContext, const CSSSelector& selector, const ContainerNode* ancestor)
{
    return is<Document>(checkingContext.scope)
        && ancestor == checkingContext.scope
        && isScopeOnlyCompoundSelector(selector);
}

// Recursive check of selectors and combinators
// It can return 4 different values:
// * SelectorMatches          - the selector matches the element e
// * SelectorFailsLocally     - the selector fails for the element e
// * SelectorFailsAllSiblings - the selector fails for e and any sibling of e
// * SelectorFailsCompletely  - the selector fails for e and any sibling or ancestor of e
SelectorChecker::Match SelectorChecker::matchRecursively(CheckingContext& checkingContext, LocalContext& context) const
{
    // The first selector has to match.
    if (!checkOne(checkingContext, context))
        return Match::SelectorFailsLocally;

    // The rest of the selectors has to match
    auto relation = context.selector->relation();

    // Prepare next selector
    const CSSSelector* leftSelector = context.selector->precedingInComplexSelector();
    if (!leftSelector) {
        if (context.mustMatchHostPseudoClass && !context.matchedHostPseudoClass)
            return Match::SelectorFailsCompletely;

        return Match::SelectorMatches;
    }

    LocalContext nextContext(context);
    nextContext.selector = leftSelector;

    switch (relation) {
    case CSSSelector::Relation::DescendantSpace:
        nextContext = localContextForParent(nextContext);
        nextContext.firstSelectorOfTheFragment = nextContext.selector;
        for (; nextContext.element; nextContext = localContextForParent(nextContext)) {
            auto result = matchRecursively(checkingContext, nextContext);
            if (result == Match::SelectorMatches || result == Match::SelectorFailsCompletely)
                return result;
        }
        if (matchesDocumentScopingRoot(checkingContext, *nextContext.selector, &context.element->treeScope().rootNode()))
            return Match::SelectorMatches;
        return Match::SelectorFailsCompletely;

    case CSSSelector::Relation::Child:
        {
            nextContext = localContextForParent(nextContext);
            if (!nextContext.element) {
                if (matchesDocumentScopingRoot(checkingContext, *nextContext.selector, context.element->parentNode()))
                    return Match::SelectorMatches;
                return Match::SelectorFailsCompletely;
            }
            nextContext.firstSelectorOfTheFragment = nextContext.selector;
            auto result = matchRecursively(checkingContext, nextContext);
            if (result == Match::SelectorMatches || result == Match::SelectorFailsCompletely)
                return result;
            return Match::SelectorFailsAllSiblings;
        }

    case CSSSelector::Relation::DirectAdjacent:
        {
            CheckedPtr previousElement = context.element->previousElementSibling();
            if (!previousElement)
                return Match::SelectorFailsAllSiblings;

            nextContext.element = previousElement.get();
            nextContext.firstSelectorOfTheFragment = nextContext.selector;
            return matchRecursively(checkingContext, nextContext);
        }
    case CSSSelector::Relation::IndirectAdjacent: {
        nextContext.element = context.element->previousElementSibling();
        nextContext.firstSelectorOfTheFragment = nextContext.selector;
        for (; nextContext.element; nextContext.element = nextContext.element->previousElementSibling()) {
            auto result = matchRecursively(checkingContext, nextContext);
            if (result == Match::SelectorMatches || result == Match::SelectorFailsAllSiblings || result == Match::SelectorFailsCompletely)
                return result;
        }
        return Match::SelectorFailsAllSiblings;
    }
    case CSSSelector::Relation::Subselector:
        return matchRecursively(checkingContext, nextContext);
    case CSSSelector::Relation::ShadowDescendant:
    case CSSSelector::Relation::ShadowPartDescendant:
    case CSSSelector::Relation::ShadowSlotted:
        break;
    }

    ASSERT_NOT_REACHED();
    return Match::SelectorFailsCompletely;
}

static bool attributeValueMatches(const Attribute& attribute, CSSSelector::Match match, const AtomString& selectorValue, bool caseSensitive)
{
    const AtomString& value = attribute.value();
    ASSERT(!value.isNull());

    switch (match) {
    case CSSSelector::Match::Set:
        break;
    case CSSSelector::Match::Exact:
        if (caseSensitive ? selectorValue != value : !equalIgnoringASCIICase(selectorValue, value))
            return false;
        break;
    case CSSSelector::Match::List:
        {
            // Ignore empty selectors or selectors containing spaces.
            if (selectorValue.isEmpty() || selectorValue.find(isASCIIWhitespace<char16_t>) != notFound)
                return false;

            unsigned startSearchAt = 0;
            while (true) {
                size_t foundPos;
                if (caseSensitive)
                    foundPos = value.find(selectorValue, startSearchAt);
                else
                    foundPos = value.findIgnoringASCIICase(selectorValue, startSearchAt);
                if (foundPos == notFound)
                    return false;
                if (!foundPos || isASCIIWhitespace(value[foundPos - 1])) {
                    unsigned endStr = foundPos + selectorValue.length();
                    if (endStr == value.length() || isASCIIWhitespace(value[endStr]))
                        break; // We found a match.
                }

                // No match. Keep looking.
                startSearchAt = foundPos + 1;
            }
            break;
        }
    case CSSSelector::Match::Contain: {
        bool valueContainsSelectorValue;
        if (caseSensitive)
            valueContainsSelectorValue = value.contains(selectorValue);
        else
            valueContainsSelectorValue = value.containsIgnoringASCIICase(selectorValue);

        if (!valueContainsSelectorValue || selectorValue.isEmpty())
            return false;

        break;
    }
    case CSSSelector::Match::Begin:
        if (selectorValue.isEmpty())
            return false;
        if (caseSensitive) {
            if (!value.startsWith(selectorValue))
                return false;
        } else {
            if (!value.startsWithIgnoringASCIICase(selectorValue))
                return false;
        }
        break;
    case CSSSelector::Match::End:
        if (selectorValue.isEmpty())
            return false;
        if (caseSensitive) {
            if (!value.endsWith(selectorValue))
                return false;
        } else {
            if (!value.endsWithIgnoringASCIICase(selectorValue))
                return false;
        }
        break;
    case CSSSelector::Match::Hyphen:
        if (value.length() < selectorValue.length())
            return false;
        if (caseSensitive) {
            if (!value.startsWith(selectorValue))
                return false;
        } else {
            if (!value.startsWithIgnoringASCIICase(selectorValue))
                return false;
        }
        // It they start the same, check for exact match or following '-':
        if (value.length() != selectorValue.length() && value[selectorValue.length()] != '-')
            return false;
        break;
    default:
        ASSERT_NOT_REACHED();
        return false;
    }

    return true;
}

static bool anyAttributeMatches(const Element& element, const CSSSelector& selector, const QualifiedName& selectorAttr, bool caseSensitive)
{
    ASSERT(element.hasAttributesWithoutUpdate());
    bool isHTML = element.isHTMLElement() && element.document().isHTMLDocument();
    for (auto& attribute : element.attributes()) {
        if (!attribute.matches(selectorAttr.prefix(), isHTML ? selectorAttr.localNameLowercase() : selectorAttr.localName(), selectorAttr.namespaceURI()))
            continue;

        if (attributeValueMatches(attribute, selector.match(), selector.value(), caseSensitive))
            return true;
    }

    return false;
}

static bool LEGACY_NODELETE canMatchHoverOrActiveInQuirksMode(const SelectorChecker::LocalContext& context)
{
    // For quirks mode, follow this: http://quirks.spec.whatwg.org/#the-:active-and-:hover-quirk
    // In quirks mode, a compound selector 'selector' that matches the following conditions must not match elements that would not also match the ':any-link' selector.
    //
    //    selector uses the ':active' or ':hover' pseudo-classes.
    //    selector does not use a type selector.
    //    selector does not use an attribute selector.
    //    selector does not use an ID selector.
    //    selector does not use a class selector.
    //    selector does not use a pseudo-class selector other than ':active' and ':hover'.
    //    selector does not use a pseudo-element selector.
    //    selector is not part of an argument to a functional pseudo-class or pseudo-element.
    if (context.inFunctionalPseudoClass)
        return true;

    for (const CSSSelector* selector = context.firstSelectorOfTheFragment; selector; selector = selector->precedingInComplexSelector()) {
        switch (selector->match()) {
        case CSSSelector::Match::Tag:
            if (selector->tagQName() != anyQName())
                return true;
            break;
        case CSSSelector::Match::PseudoClass: {
            auto pseudoClass = selector->pseudoClass();
            if (pseudoClass != CSSSelector::PseudoClass::Hover && pseudoClass != CSSSelector::PseudoClass::Active)
                return true;
            break;
        }
        case CSSSelector::Match::Id:
        case CSSSelector::Match::Class:
        case CSSSelector::Match::ClassPrefix:
        case CSSSelector::Match::Exact:
        case CSSSelector::Match::Set:
        case CSSSelector::Match::List:
        case CSSSelector::Match::Hyphen:
        case CSSSelector::Match::Contain:
        case CSSSelector::Match::Begin:
        case CSSSelector::Match::End:
        case CSSSelector::Match::PagePseudoClass:
        case CSSSelector::Match::PseudoElement:
            return true;
        case CSSSelector::Match::HasScope:
        case CSSSelector::Match::NestingParent:
        case CSSSelector::Match::Unknown:
        case CSSSelector::Match::ForgivingUnknown:
        case CSSSelector::Match::ForgivingUnknownNestContaining:
            ASSERT_NOT_REACHED();
            break;
        }

        auto relation = selector->relation();
        if (relation == CSSSelector::Relation::ShadowDescendant || relation == CSSSelector::Relation::ShadowPartDescendant)
            return true;

        if (relation != CSSSelector::Relation::Subselector)
            return false;
    }
    return false;
}

static inline bool LEGACY_NODELETE isStar(const AtomString& string)
{
    return string.length() == 1 && string[0] == '*';
}

static inline bool LEGACY_NODELETE tagMatches(const Element& element, const CSSSelector& simpleSelector)
{
    const QualifiedName& tagQName = simpleSelector.tagQName();

    const AtomString& localName = (element.isHTMLElement() && element.document().isHTMLDocument()) ? simpleSelector.tagLowercaseLocalName() : tagQName.localName();

    if (localName != element.localName() && !isStar(localName))
        return false;
    const AtomString& namespaceURI = tagQName.namespaceURI();
    return namespaceURI == element.namespaceURI() || isStar(namespaceURI);
}

static bool isSelectorListAllowedToMatchFeaturelessShadowHost(const CSSSelectorList*);

// https://drafts.csswg.org/selectors-4/#featureless
static bool isSimpleSelectorAllowedToMatchFeaturelessShadowHost(const CSSSelector& selector)
{
    if (selector.match() == CSSSelector::Match::PseudoElement || selector.match() == CSSSelector::Match::HasScope)
        return true;
    if (selector.match() != CSSSelector::Match::PseudoClass)
        return false;
    if (selector.isHostPseudoClass() || selector.isScopePseudoClass())
        return true;
    switch (selector.pseudoClass()) {
    case CSSSelector::PseudoClass::Is:
    case CSSSelector::PseudoClass::Where:
    case CSSSelector::PseudoClass::WebKitAny:
    case CSSSelector::PseudoClass::Not:
        return isSelectorListAllowedToMatchFeaturelessShadowHost(selector.selectorList());
    default:
        return false;
    }
}

bool SelectorChecker::isCompoundSelectorAllowedToMatchFeaturelessShadowHost(const CSSSelector& firstInCompound)
{
    // :has() is allowed only if some other simple selector in its compound is.
    bool hasAllowedSimpleSelector = false;
    for (auto* simpleSelector = &firstInCompound; simpleSelector; simpleSelector = simpleSelector->followingInCompound()) {
        if (simpleSelector->isHasPseudoClass())
            continue;
        if (!isSimpleSelectorAllowedToMatchFeaturelessShadowHost(*simpleSelector))
            return false;
        hasAllowedSimpleSelector = true;
    }
    return hasAllowedSimpleSelector;
}

static bool isSelectorListAllowedToMatchFeaturelessShadowHost(const CSSSelectorList* selectorList)
{
    if (!selectorList)
        return false;
    for (auto& selector : *selectorList) {
        if (SelectorChecker::isCompoundSelectorAllowedToMatchFeaturelessShadowHost(selector))
            return true;
    }
    return false;
}

bool SelectorChecker::checkOne(CheckingContext& checkingContext, LocalContext& context) const
{
    CheckedRef element = *context.element;
    const CSSSelector& selector = *context.selector;

    if (context.mustMatchHostPseudoClass) {
        if (!isSimpleSelectorAllowedToMatchFeaturelessShadowHost(selector) && !selector.isHasPseudoClass())
            return false;
    }

    if (selector.match() == CSSSelector::Match::Tag)
        return tagMatches(element, selector);

    if (selector.match() == CSSSelector::Match::Class)
        return element->hasClassName(selector.value());

    if (selector.isEquivalentToClassSelector()) {
        ASSERT(m_strictParsing);
        return element->hasClassName(selector.value());
    }
    if (selector.match() == CSSSelector::Match::ClassPrefix)
        return element->hasClassNamePrefix(selector.value());

    if (selector.match() == CSSSelector::Match::Id) {
        ASSERT(!selector.value().isNull());
        return element->idForStyleResolution() == selector.value();
    }

    if (selector.isAttributeSelector()) {
        if (!element->hasAttributes())
            return false;

        const QualifiedName& attr = selector.attribute();
        bool caseSensitive = [&] {
            switch (selector.attributeMatchType()) {
            case CSSSelector::AttributeMatchType::CaseInsensitive:
                return false;
            case CSSSelector::AttributeMatchType::CaseSensitive:
                return true;
            case CSSSelector::AttributeMatchType::Default:
                return !(m_documentIsHTML && element->isHTMLElement());
            }
            ASSERT_NOT_REACHED();
            return true;
        }();

        return anyAttributeMatches(element, selector, attr, caseSensitive);
    }

    if (selector.match() == CSSSelector::Match::ForgivingUnknown || selector.match() == CSSSelector::Match::ForgivingUnknownNestContaining)
        return false;

    if (selector.match() == CSSSelector::Match::NestingParent) {
        return false;
    }

    if (selector.match() == CSSSelector::Match::HasScope) {
        checkingContext.matchedInsideScope = true;
        bool matched = element.ptr() == checkingContext.hasScope;
        // For :host:has() the implicit scope sentinel anchors at the host; treat hitting it
        // on the host as satisfying the mustMatchHostPseudoClass requirement.
        if (matched && context.mustMatchHostPseudoClass && element->shadowRoot())
            context.matchedHostPseudoClass = true;
        return matched;
    }

    if (selector.match() == CSSSelector::Match::PseudoClass) {
        // Handle :not up front.
        if (selector.pseudoClass() == CSSSelector::PseudoClass::Not) {
            const CSSSelectorList* selectorList = selector.selectorList();

            if (context.mustMatchHostPseudoClass) {
                if (!isSelectorListAllowedToMatchFeaturelessShadowHost(selectorList))
                    return false;
                context.matchedHostPseudoClass = true;
            }

            for (auto& subselector : *selectorList) {
                LocalContext subcontext(context);
                subcontext.inFunctionalPseudoClass = true;
                subcontext.selector = &subselector;
                subcontext.firstSelectorOfTheFragment = &selectorList->first();

                if (matchRecursively(checkingContext, subcontext) == Match::SelectorMatches)
                    return false;
            }
            return true;
        }
        // Normal element pseudo class checking.
        switch (selector.pseudoClass()) {
            // Pseudo classes:
        case CSSSelector::PseudoClass::Not:
            ASSERT_NOT_REACHED();
            break; // Already handled up above.
        // Media, fullscreen and attachments don't exist here, and the converter never emits these.
#if ENABLE(ATTACHMENT_ELEMENT)
        case CSSSelector::PseudoClass::AppleHasAttachment:
#endif
#if ENABLE(FULLSCREEN_API)
        case CSSSelector::PseudoClass::InternalAnimatingFullscreenTransition:
        case CSSSelector::PseudoClass::InternalFullscreenDocument:
        case CSSSelector::PseudoClass::InternalInWindowFullscreen:
        case CSSSelector::PseudoClass::Fullscreen:
#endif
#if ENABLE(VIDEO)
        case CSSSelector::PseudoClass::Buffering:
        case CSSSelector::PseudoClass::Future:
        case CSSSelector::PseudoClass::Muted:
        case CSSSelector::PseudoClass::Past:
        case CSSSelector::PseudoClass::Paused:
        case CSSSelector::PseudoClass::Playing:
        case CSSSelector::PseudoClass::Seeking:
        case CSSSelector::PseudoClass::Stalled:
        case CSSSelector::PseudoClass::VolumeLocked:
#endif
#if ENABLE(MODEL_ELEMENT_IMMERSIVE)
        case CSSSelector::PseudoClass::Immersive:
#endif
#if ENABLE(PICTURE_IN_PICTURE_API)
        case CSSSelector::PseudoClass::PictureInPicture:
#endif
            return false;
        case CSSSelector::PseudoClass::Empty:
            {
                bool result = true;
                for (Node* node = element->firstChild(); node; node = node->nextSibling()) {
                    if (is<Element>(*node)) {
                        result = false;
                        break;
                    }
                    if (auto* textNode = dynamicDowncast<Text>(*node)) {
                        if (!textNode->data().isEmpty()) {
                            result = false;
                            break;
                        }
                    }
                }
                return result;
            }
        case CSSSelector::PseudoClass::FirstChild:
            // first-child matches the first child that is an element
            return isFirstChildElement(element);
        case CSSSelector::PseudoClass::FirstOfType:
            // first-of-type matches the first element of its type
            return isFirstOfType(element, element->tagQName());
        case CSSSelector::PseudoClass::LastChild:
            // last-child matches the last child that is an element
            return isLastChildElement(element);
        case CSSSelector::PseudoClass::LastOfType:
            // last-of-type matches the last element of its type
            return isLastOfType(element, element->tagQName());
        case CSSSelector::PseudoClass::OnlyChild:
            return isFirstChildElement(element) && isLastChildElement(element);
        case CSSSelector::PseudoClass::OnlyOfType:
            // FIXME: This selector is very slow.
            return isFirstOfType(element, element->tagQName()) && isLastOfType(element, element->tagQName());
        case CSSSelector::PseudoClass::Is:
        case CSSSelector::PseudoClass::Where:
        case CSSSelector::PseudoClass::WebKitAny:
            {
                bool hasMatchedAnything = false;

                ASSERT(selector.selectorList());
                for (const auto& subselector : *selector.selectorList()) {
                    LocalContext subcontext(context);
                    subcontext.inFunctionalPseudoClass = true;
                    subcontext.selector = &subselector;
                    subcontext.firstSelectorOfTheFragment = &subselector;
                    auto result = matchRecursively(checkingContext, subcontext);
                    context.matchedHostPseudoClass |= subcontext.matchedHostPseudoClass;

                    if (result == Match::SelectorMatches) {
                        hasMatchedAnything = true;
                        break;
                    }
                }
                return hasMatchedAnything;
            }
        case CSSSelector::PseudoClass::Has:
            return matchHasPseudoClass(checkingContext, element, *selector.selectorList(), context.mustMatchHostPseudoClass);
        case CSSSelector::PseudoClass::PlaceholderShown:
            if (auto* formControl = dynamicDowncast<HTMLTextFormControlElement>(element.get()))
                return formControl->isPlaceholderVisible();
            return false;
        case CSSSelector::PseudoClass::NthChild: {
            if (const CSSSelectorList* selectorList = selector.selectorList()) {
                if (!matchSelectorList(checkingContext, context, element, *selectorList))
                    return false;
            }

            int count = 1;
            if (const CSSSelectorList* selectorList = selector.selectorList()) {
                for (CheckedPtr sibling = ElementTraversal::previousSibling(element); sibling; sibling = ElementTraversal::previousSibling(*sibling)) {
                    if (matchSelectorList(checkingContext, context, *sibling, *selectorList))
                        ++count;
                }
            } else
                count += countElementsBefore(element);

            if (selector.matchNth(count))
                return true;
            break;
        }
        case CSSSelector::PseudoClass::Heading:
            return matchesHeadingPseudoClass(element, selector.integerList());
        case CSSSelector::PseudoClass::NthOfType: {
            int count = 1 + countElementsOfTypeBefore(element, element->tagQName());
            if (selector.matchNth(count))
                return true;
            break;
        }
        case CSSSelector::PseudoClass::NthLastChild: {
            if (const CSSSelectorList* selectorList = selector.selectorList()) {
                if (!matchSelectorList(checkingContext, context, element, *selectorList))
                    return false;
            }

            int count = 1;
            if (const CSSSelectorList* selectorList = selector.selectorList()) {
                for (CheckedPtr sibling = ElementTraversal::nextSibling(element); sibling; sibling = ElementTraversal::nextSibling(*sibling)) {
                    if (matchSelectorList(checkingContext, context, *sibling, *selectorList))
                        ++count;
                }
            } else
                count += countElementsAfter(element);

            return selector.matchNth(count);
        }
        case CSSSelector::PseudoClass::NthLastOfType: {
            int count = 1 + countElementsOfTypeAfter(element, element->tagQName());
            return selector.matchNth(count);
        }
        case CSSSelector::PseudoClass::Target:
            if (element.ptr() == element->document().cssTarget())
                return true;
            break;
        case CSSSelector::PseudoClass::AnyLink:
        case CSSSelector::PseudoClass::Link:
            return element->isLink();
        case CSSSelector::PseudoClass::Visited:
            return false;
        case CSSSelector::PseudoClass::Focus:
            return matchesFocusPseudoClass(element);
        case CSSSelector::PseudoClass::FocusVisible:
            return matchesFocusVisiblePseudoClass(element);
        case CSSSelector::PseudoClass::FocusWithin:
            return matchesFocusWithinPseudoClass(element);
        case CSSSelector::PseudoClass::Hover:
            if (m_strictParsing || element->isLink() || canMatchHoverOrActiveInQuirksMode(context)) {
                if (element->hovered())
                    return true;
            }
            break;
        case CSSSelector::PseudoClass::Active:
            if (m_strictParsing || element->isLink() || canMatchHoverOrActiveInQuirksMode(context)) {
                if (element->active())
                    return true;
            }
            break;
        case CSSSelector::PseudoClass::Enabled:
            return matchesEnabledPseudoClass(element);
        case CSSSelector::PseudoClass::Default:
            return matchesDefaultPseudoClass(element);
        case CSSSelector::PseudoClass::Disabled:
            return matchesDisabledPseudoClass(element);
        case CSSSelector::PseudoClass::ReadOnly:
            return matchesReadOnlyPseudoClass(element);
        case CSSSelector::PseudoClass::ReadWrite:
            return matchesReadWritePseudoClass(element);
        case CSSSelector::PseudoClass::Optional:
            return isOptionalFormControl(element);
        case CSSSelector::PseudoClass::Required:
            return isRequiredFormControl(element);
        case CSSSelector::PseudoClass::Valid:
            return isValid(element);
        case CSSSelector::PseudoClass::Invalid:
            return isInvalid(element);
        case CSSSelector::PseudoClass::Checked:
            return isChecked(element);
        case CSSSelector::PseudoClass::Indeterminate:
            return matchesIndeterminatePseudoClass(element);
        case CSSSelector::PseudoClass::Root:
            if (element.ptr() == element->document().documentElement())
                return true;
            break;
        case CSSSelector::PseudoClass::Lang:
            ASSERT(selector.langList() && !selector.langList()->isEmpty());
            return matchesLangPseudoClass(element, *selector.langList());
        case CSSSelector::PseudoClass::InRange:
            return isInRange(element);
        case CSSSelector::PseudoClass::OutOfRange:
            return isOutOfRange(element);
        case CSSSelector::PseudoClass::Scope: {
            const Node* contextualReferenceNode = !checkingContext.scope ? element->document().documentElement() : checkingContext.scope.get();
            auto match = element.ptr() == contextualReferenceNode;
            if (!match)
                return false;

            if (element->shadowRoot())
                context.matchedHostPseudoClass = true;

            return true;
        }
        case CSSSelector::PseudoClass::State:
            return element->hasCustomState(selector.argument());
        case CSSSelector::PseudoClass::Host: {
            if (!context.mustMatchHostPseudoClass)
                return false;
            if (!matchHostPseudoClass(selector, element, checkingContext))
                return false;
            context.matchedHostPseudoClass = true;
            return true;
        }
        case CSSSelector::PseudoClass::Defined:
            return isDefinedElement(element);

        case CSSSelector::PseudoClass::Horizontal:
        case CSSSelector::PseudoClass::Vertical:
        case CSSSelector::PseudoClass::Decrement:
        case CSSSelector::PseudoClass::Increment:
        case CSSSelector::PseudoClass::Start:
        case CSSSelector::PseudoClass::End:
        case CSSSelector::PseudoClass::DoubleButton:
        case CSSSelector::PseudoClass::SingleButton:
        case CSSSelector::PseudoClass::NoButton:
        case CSSSelector::PseudoClass::CornerPresent:
        case CSSSelector::PseudoClass::WindowInactive:
        case CSSSelector::PseudoClass::Autofill:
        case CSSSelector::PseudoClass::WebKitAutofillAndObscured:
        case CSSSelector::PseudoClass::WebKitAutofillStrongPassword:
        case CSSSelector::PseudoClass::WebKitAutofillStrongPasswordViewable:
        case CSSSelector::PseudoClass::WebKitDrag:
        case CSSSelector::PseudoClass::InternalMediaDocument:
        case CSSSelector::PseudoClass::InternalSelectPopover:
        case CSSSelector::PseudoClass::InternalSelectPreferredSizeOne:
        case CSSSelector::PseudoClass::InternalUsesMenulist:
        case CSSSelector::PseudoClass::ActiveViewTransition:
        case CSSSelector::PseudoClass::ActiveViewTransitionType:
        case CSSSelector::PseudoClass::EvenLessGood:
        case CSSSelector::PseudoClass::Optimum:
        case CSSSelector::PseudoClass::Suboptimum:
            return false;

        case CSSSelector::PseudoClass::Dir:
            return matchesDirPseudoClass(element, selector.argument());

        case CSSSelector::PseudoClass::InternalHTMLDocument:
            return matchesHtmlDocumentPseudoClass(element);

        case CSSSelector::PseudoClass::Open:
            return matchesOpenPseudoClass(element);

        case CSSSelector::PseudoClass::PopoverOpen:
            return matchesPopoverOpenPseudoClass(element);

        case CSSSelector::PseudoClass::Modal:
            return matchesModalPseudoClass(element);

        case CSSSelector::PseudoClass::UserInvalid:
            return matchesUserInvalidPseudoClass(element);

        case CSSSelector::PseudoClass::UserValid:
            return matchesUserValidPseudoClass(element);
        }
        return false;
    }

    ASSERT_NOT_REACHED();
    return false;
}

bool SelectorChecker::matchSelectorList(CheckingContext& checkingContext, const LocalContext& context, const Element& element, const CSSSelectorList& selectorList) const
{
    for (auto& subselector : selectorList) {
        LocalContext subcontext(context);
        subcontext.element = &element;
        subcontext.selector = &subselector;
        subcontext.inFunctionalPseudoClass = true;
        subcontext.firstSelectorOfTheFragment = &subselector;
        if (matchRecursively(checkingContext, subcontext) == Match::SelectorMatches)
            return true;
    }
    return false;
}

bool SelectorChecker::matchHasPseudoClass(CheckingContext& checkingContext, const Element& element, const CSSSelectorList& selectorList, bool matchingHost) const
{
    // :has() should never be nested with another :has()
    // This is generally discarded at parsing time, but
    // with Nesting some selector can become "contextually invalid".
    if (checkingContext.disallowHasPseudoClass)
        return false;

    for (auto& hasSelector : selectorList) {
        if (matchHasArgumentSelector(checkingContext, element, hasSelector, matchingHost))
            return true;
    }
    return false;
}

enum class HasTraversalType : uint8_t { Children, Descendants, Siblings, SiblingDescendants };

// Where the elements that the argument's subject can match are, seen from the :has() scope element.
static HasTraversalType computeHasTraversalType(const CSSSelector& hasSelector)
{
    std::optional<HasTraversalType> type;
    for (auto* simpleSelector = &hasSelector; simpleSelector->precedingInComplexSelector(); simpleSelector = simpleSelector->precedingInComplexSelector()) {
        bool isSiblingOrSubject = !type || *type == HasTraversalType::Siblings;
        switch (simpleSelector->relation()) {
        case CSSSelector::Relation::Subselector:
            break;
        case CSSSelector::Relation::DescendantSpace:
            type = HasTraversalType::Descendants;
            break;
        case CSSSelector::Relation::Child:
            type = isSiblingOrSubject ? HasTraversalType::Children : HasTraversalType::Descendants;
            break;
        case CSSSelector::Relation::DirectAdjacent:
        case CSSSelector::Relation::IndirectAdjacent:
            type = isSiblingOrSubject ? HasTraversalType::Siblings : HasTraversalType::SiblingDescendants;
            break;
        case CSSSelector::Relation::ShadowDescendant:
        case CSSSelector::Relation::ShadowPartDescendant:
        case CSSSelector::Relation::ShadowSlotted:
            ASSERT_NOT_REACHED();
            break;
        }
    }
    ASSERT(type);
    return type.value_or(HasTraversalType::Descendants);
}

bool SelectorChecker::matchHasArgumentSelector(CheckingContext& checkingContext, const Element& element, const CSSSelector& hasSelector, bool matchingHost) const
{
    auto traversalType = computeHasTraversalType(hasSelector);

    // When :has() is part of a :host compound (either the subject is the shadow host, or
    // the ancestor walk has crossed the shadow root upward), :has() must traverse the host's
    // shadow tree, not its light-tree descendants.
    bool traversesShadowTree = matchingHost && element.shadowRoot();
    CheckedRef<const ContainerNode> traversalRoot = traversesShadowTree ? static_cast<const ContainerNode&>(*element.shadowRoot()) : element;

    auto canMatch = [&] {
        switch (traversalType) {
        case HasTraversalType::Children:
        case HasTraversalType::Descendants:
            return !!traversalRoot->firstElementChild();
        case HasTraversalType::Siblings:
        case HasTraversalType::SiblingDescendants:
            // A shadow root has no element siblings, so :host:has(~ x) never matches.
            if (traversesShadowTree)
                return false;
            return !!element.nextElementSibling();
        }
        ASSERT_NOT_REACHED();
        return false;
    };

    // See if there are any elements that this :has() selector could match.
    if (!canMatch())
        return false;

    auto* cache = checkingContext.selectorMatchingState ? &checkingContext.selectorMatchingState->hasPseudoClassMatchCache : nullptr;

    auto checkForCachedMatch = [&]() -> std::optional<bool> {
        if (!cache)
            return { };
        switch (cache->get(Style::makeHasPseudoClassCacheKey(element, hasSelector))) {
        case Style::HasPseudoClassMatch::Matches:
            return true;
        case Style::HasPseudoClassMatch::Fails:
        case Style::HasPseudoClassMatch::FailsSubtree:
            return false;
        case Style::HasPseudoClassMatch::None:
            break;
        }
        return { };
    };

    // See if we know the result already.
    if (auto match = checkForCachedMatch())
        return *match;

    auto filterForElement = [&]() -> Style::HasSelectorFilter* {
        // Filters are keyed by light-tree context; skip for shadow-tree traversal.
        if (traversesShadowTree)
            return nullptr;
        if (!checkingContext.selectorMatchingState)
            return nullptr;
        auto type = [&]() -> std::optional<Style::HasSelectorFilter::Type> {
            switch (traversalType) {
            case HasTraversalType::Children:
                return Style::HasSelectorFilter::Type::Children;
            case HasTraversalType::Descendants:
                return Style::HasSelectorFilter::Type::Descendants;
            default:
                return { };
            }
        }();
        if (!type)
            return nullptr;
        auto& filtersMap = checkingContext.selectorMatchingState->hasPseudoClassSelectorFilters;
        auto addResult = filtersMap.add(Style::makeHasPseudoClassFilterKey(element, *type), std::unique_ptr<Style::HasSelectorFilter>());
        // Only build a filter if the same element gets checked second time with a different selector (misses the match cache).
        if (addResult.isNewEntry)
            return nullptr;

        if (!addResult.iterator->value)
            addResult.iterator->value = makeUnique<Style::HasSelectorFilter>(element, *type);
        return addResult.iterator->value.get();
    };

    // Check if the bloom filter rejects this selector
    if (auto* filter = filterForElement()) {
        if (filter->reject(hasSelector))
            return false;
    }

    CheckingContext hasCheckingContext;
    hasCheckingContext.scope = checkingContext.scope;
    hasCheckingContext.hasScope = &element;
    hasCheckingContext.disallowHasPseudoClass = true;

    bool matchedInsideScope = false;

    auto checkRelative = [&](auto& elementToCheck) {
        LocalContext hasContext(hasSelector, elementToCheck);
        hasContext.inFunctionalPseudoClass = true;

        auto result = matchRecursively(hasCheckingContext, hasContext) == Match::SelectorMatches;

        if (hasCheckingContext.matchedInsideScope)
            matchedInsideScope = true;

        return result;
    };

    auto checkDescendants = [&](const ContainerNode& descendantRoot) {
        for (auto it = descendantsOfType<Element>(descendantRoot).begin(); it;) {
            CheckedRef descendant = *it;
            if (checkRelative(descendant))
                return true;

            if (cache && descendant->firstElementChild()) {
                auto key = Style::makeHasPseudoClassCacheKey(descendant, hasSelector);
                if (cache->get(key) == Style::HasPseudoClassMatch::FailsSubtree) {
                    it.traverseNextSkippingChildren();
                    continue;
                }
            }

            it.traverseNext();
        }

        return false;
    };

    auto match = [&] {
        switch (traversalType) {
        case HasTraversalType::Children:
            // :has(> .child)
            for (CheckedRef child : childrenOfType<Element>(traversalRoot)) {
                if (checkRelative(child))
                    return true;
            }
            break;
        case HasTraversalType::Descendants: {
            // :has(.descendant)
            if (cache && !traversesShadowTree) {
                // See if we already know this descendant selector doesn't match in this subtree.
                // Only valid for light-tree traversal; shadow-tree walks don't share a failure subtree with light ancestors.
                for (CheckedPtr ancestor = element.parentElement(); ancestor; ancestor = ancestor->parentElement()) {
                    auto key = Style::makeHasPseudoClassCacheKey(*ancestor, hasSelector);
                    if (cache->get(key) == Style::HasPseudoClassMatch::FailsSubtree)
                        return false;
                }
            }
            if (checkDescendants(traversalRoot))
                return true;

            break;
        }
        case HasTraversalType::Siblings:
            // :has(~ .sibling)
            ASSERT(!traversesShadowTree);
            for (CheckedPtr sibling = element.nextElementSibling(); sibling; sibling = sibling->nextElementSibling()) {
                if (checkRelative(*sibling))
                    return true;
            }
            break;
        case HasTraversalType::SiblingDescendants:
            // :has(~ .sibling .descendant)
            ASSERT(!traversesShadowTree);
            for (CheckedPtr sibling = element.nextElementSibling(); sibling; sibling = sibling->nextElementSibling()) {
                if (checkDescendants(*sibling))
                    return true;
            }
            break;
        }
        return false;
    };

    auto result = match();

    auto matchTypeForCache = [&] {
        if (result)
            return Style::HasPseudoClassMatch::Matches;
        if (matchedInsideScope)
            return Style::HasPseudoClassMatch::Fails;
        return Style::HasPseudoClassMatch::FailsSubtree;
    };

    if (cache)
        cache->add(Style::makeHasPseudoClassCacheKey(element, hasSelector), matchTypeForCache());

    return result;
}

}
