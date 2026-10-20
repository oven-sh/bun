/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 2004-2005 Allan Sandfeld Jensen (kde@carewolf.com)
 * Copyright (C) 2006, 2007 Nicholas Shanks (webkit@nickshanks.com)
 * Copyright (C) 2005, 2006, 2007, 2008, 2009, 2010, 2011 Apple Inc. All rights reserved.
 * Copyright (C) 2007 Alexey Proskuryakov <ap@webkit.org>
 * Copyright (C) 2007, 2008 Eric Seidel <eric@webkit.org>
 * Copyright (C) 2008, 2009 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
 * Copyright (c) 2011, Code Aurora Forum. All rights reserved.
 * Copyright (C) Research In Motion Limited 2011. All rights reserved.
 * Copyright (C) 2012 Google Inc. All rights reserved.
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
#include "SelectorFilter.h"

#include "CSSSelectorList.h"
#include "CommonAtomStrings.h"
#include "ElementInlines.h"
#include "HTMLNames.h"
#include "ShadowRoot.h"
#include "StyledElement.h"

namespace WebCore {

// Salt to separate otherwise identical string hashes so a class-selector like .article won't match <article> elements.
enum { TagNameSalt = 13, IdSalt = 17, ClassSalt = 19, AttributeSalt = 23 };

static bool LEGACY_NODELETE isExcludedAttribute(const AtomString& name)
{
    return name == HTMLNames::classAttr->localName() || name == HTMLNames::idAttr->localName() || name == HTMLNames::styleAttr->localName();
}

void SelectorFilter::collectElementIdentifierHashes(const Element& element, Vector<unsigned, 4>& identifierHashes)
{
    identifierHashes.append(element.localNameLowercase().impl()->existingHash() * TagNameSalt);

    auto& id = element.idForStyleResolution();
    if (!id.isNull())
        identifierHashes.append(id.impl()->existingHash() * IdSalt);

    if (element.hasClass()) {
        identifierHashes.appendContainerWithMapping(element.classNames(), [](auto& className) {
            return className.impl()->existingHash() * ClassSalt;
        });
    }
    
    if (element.hasAttributesWithoutUpdate()) {
        for (auto& attribute : element.attributes()) {
            auto& attributeName = element.isHTMLElement() ? attribute.localName() : attribute.localNameLowercase();
            if (isExcludedAttribute(attributeName))
                continue;
            identifierHashes.append(attributeName.impl()->existingHash() * AttributeSalt);
        }
    }
}

void SelectorFilter::collectSimpleSelectorHash(CollectedSelectorHashes& collectedHashes, const CSSSelector& selector)
{
    switch (selector.match()) {
    case CSSSelector::Match::Id:
        if (!selector.value().isEmpty())
            collectedHashes.ids.append(selector.value().impl()->existingHash() * IdSalt);
        break;
    case CSSSelector::Match::Class:
        if (!selector.value().isEmpty())
            collectedHashes.classes.append(selector.value().impl()->existingHash() * ClassSalt);
        break;
    case CSSSelector::Match::Tag: {
        auto& tagLowercaseLocalName = selector.tagLowercaseLocalName();
        if (tagLowercaseLocalName != starAtom())
            collectedHashes.tags.append(tagLowercaseLocalName.impl()->existingHash() * TagNameSalt);
        break;
    }
    case CSSSelector::Match::Exact:
    case CSSSelector::Match::Set:
    case CSSSelector::Match::List:
    case CSSSelector::Match::Hyphen:
    case CSSSelector::Match::Contain:
    case CSSSelector::Match::Begin:
    case CSSSelector::Match::End: {
        if (selector.isEquivalentToClassSelector()) {
            collectedHashes.classes.append(selector.value().impl()->existingHash() * ClassSalt);
            break;
        }
        auto attributeName = selector.attribute().localNameLowercase();
        if (!isExcludedAttribute(attributeName))
            collectedHashes.attributes.append(attributeName.impl()->existingHash() * AttributeSalt);
        break;
    }
    case CSSSelector::Match::PseudoClass:
        switch (selector.pseudoClass()) {
        case CSSSelector::PseudoClass::Is:
        case CSSSelector::PseudoClass::Where:
            // We can use the filter in the trivial case of single argument :is()/:where().
            // Supporting the multiargument case would require more than one hash.
            if (selector.selectorList()->size() == 1)
                collectSelectorHashes(collectedHashes, selector.selectorList()->first(), IncludeRightmost::Yes);
            break;
        default:
            break;
        }
        break;
    default:
        break;
    }
}

void SelectorFilter::collectSelectorHashes(CollectedSelectorHashes& collectedHashes, const CSSSelector& rightmostSelector, IncludeRightmost includeRightmost)
{
    auto [selector, relation, skipOverSubselectors] = [&] {
        if (includeRightmost == IncludeRightmost::No)
            return std::tuple { rightmostSelector.precedingInComplexSelector(), rightmostSelector.relation(), true };

        return std::tuple { &rightmostSelector, CSSSelector::Relation::Subselector, false };
    }();

    for (; selector; selector = selector->precedingInComplexSelector()) {
        // Only collect identifiers that match ancestors.
        switch (relation) {
        case CSSSelector::Relation::Subselector:
            if (!skipOverSubselectors)
                collectSimpleSelectorHash(collectedHashes, *selector);
            break;
        case CSSSelector::Relation::DirectAdjacent:
        case CSSSelector::Relation::IndirectAdjacent:
        case CSSSelector::Relation::ShadowDescendant:
        case CSSSelector::Relation::ShadowPartDescendant:
        case CSSSelector::Relation::ShadowSlotted:
            skipOverSubselectors = true;
            break;
        case CSSSelector::Relation::DescendantSpace:
        case CSSSelector::Relation::Child:
            skipOverSubselectors = false;
            collectSimpleSelectorHash(collectedHashes, *selector);
            break;
        }
        relation = selector->relation();
    }
}

}

