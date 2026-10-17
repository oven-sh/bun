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

#pragma once

#include "SelectorMatchingState.h"
#include "CSSSelector.h"
#include "Element.h"

namespace WebCore {

class CSSSelector;
class Element;

class SelectorChecker {
    WTF_MAKE_NONCOPYABLE(SelectorChecker);
    enum class Match { SelectorMatches, SelectorFailsLocally, SelectorFailsAllSiblings, SelectorFailsCompletely };

public:
    SelectorChecker(Document&);

    struct CheckingContext {
        RefPtr<const ContainerNode> scope;
        CheckedPtr<const Element> hasScope;
        Style::SelectorMatchingState* selectorMatchingState { nullptr };

        bool matchedInsideScope { false };
        bool disallowHasPseudoClass { false };
        // The rule comes from the shadow tree of the element.
        bool mustMatchHostPseudoClass { false };
    };

    bool match(const CSSSelector&, const Element&, CheckingContext&) const;

    bool matchHostPseudoClass(const CSSSelector&, const Element&, CheckingContext&) const;

    // Takes the first simple selector of the compound. https://drafts.csswg.org/selectors-4/#featureless
    static bool isCompoundSelectorAllowedToMatchFeaturelessShadowHost(const CSSSelector&);

    struct LocalContext;
    
private:
    Match matchRecursively(CheckingContext&, LocalContext&) const;
    bool checkOne(CheckingContext&, LocalContext&) const;
    bool matchSelectorList(CheckingContext&, const LocalContext&, const Element&, const CSSSelectorList&) const;
    bool matchHasPseudoClass(CheckingContext&, const Element&, const CSSSelectorList&, bool matchingHost) const;
    bool matchHasArgumentSelector(CheckingContext&, const Element&, const CSSSelector&, bool matchingHost) const;

    bool m_strictParsing;
    bool m_documentIsHTML;
};

} // namespace WebCore
