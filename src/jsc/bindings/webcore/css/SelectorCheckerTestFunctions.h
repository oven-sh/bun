/*
 * Copyright (C) 2014-2016 Apple Inc. All rights reserved.
 * Copyright (C) 2014 Dhi Aurrahman <diorahman@rockybars.com>
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

#include "Document.h"
#include "ElementInlinesLight.h"
#include "HTMLDetailsElement.h"
#include "HTMLDialogElement.h"
#include "HTMLHeadingElement.h"
#include "HTMLInputElement.h"
#include "HTMLOptionElement.h"
#include "NodeDocument.h"
#include "SelectorChecker.h"
#include "ShadowRoot.h"
#include "WritingMode.h"
#include <wtf/Compiler.h>

namespace WebCore {

ALWAYS_INLINE bool matchesDefaultPseudoClass(const Element& element)
{
    return element.matchesDefaultPseudoClass();
}

// https://html.spec.whatwg.org/multipage/scripting.html#selector-disabled
ALWAYS_INLINE bool matchesDisabledPseudoClass(const Element& element)
{
    auto* htmlElement = dynamicDowncast<HTMLElement>(element);
    return htmlElement && htmlElement->isActuallyDisabled();
}

// https://html.spec.whatwg.org/multipage/scripting.html#selector-enabled
ALWAYS_INLINE bool matchesEnabledPseudoClass(const Element& element)
{
    auto* htmlElement = dynamicDowncast<HTMLElement>(element);
    return htmlElement && htmlElement->canBeActuallyDisabled() && !htmlElement->isActuallyDisabled();
}

// https://dom.spec.whatwg.org/#concept-element-defined
ALWAYS_INLINE bool isDefinedElement(const Element& element)
{
    return element.isDefinedCustomElement() || element.isUncustomizedCustomElement();
}

ALWAYS_INLINE bool isChecked(const Element& element)
{
    if (auto* inputElement = dynamicDowncast<HTMLInputElement>(element))
        return inputElement->matchesCheckedPseudoClass();
    if (auto* option = dynamicDowncast<HTMLOptionElement>(element))
        return option->selected();
    return false;
}

ALWAYS_INLINE bool isInRange(const Element& element)
{
    return element.isInRange();
}

ALWAYS_INLINE bool isOutOfRange(const Element& element)
{
    return element.isOutOfRange();
}

ALWAYS_INLINE bool isInvalid(const Element& element)
{
    return element.matchesInvalidPseudoClass();
}

ALWAYS_INLINE bool isOptionalFormControl(const Element& element)
{
    return element.isOptionalFormControl();
}

ALWAYS_INLINE bool isRequiredFormControl(const Element& element)
{
    return element.isRequiredFormControl();
}

ALWAYS_INLINE bool isValid(const Element& element)
{
    return element.matchesValidPseudoClass();
}

ALWAYS_INLINE bool containslanguageSubtagMatchingRange(StringView language, StringView range, unsigned languageLength, unsigned& position)
{
    unsigned languageSubtagsStartIndex = position;
    unsigned languageSubtagsEndIndex = languageLength;
    bool isAsteriskRange = range == "*"_s;
    do {
        if (languageSubtagsStartIndex > 0)
            languageSubtagsStartIndex += 1;
        
        languageSubtagsEndIndex = std::min<unsigned>(language.find('-', languageSubtagsStartIndex), languageLength);

        if (languageSubtagsStartIndex > languageSubtagsEndIndex)
            return false;

        StringView languageSubtag = language.substring(languageSubtagsStartIndex, languageSubtagsEndIndex - languageSubtagsStartIndex);
        bool isEqual = equalIgnoringASCIICase(range, languageSubtag);
        if (!isAsteriskRange && !isEqual) {
            if (!languageSubtagsStartIndex || (languageSubtag.length() == 1 && languageSubtagsStartIndex > 0))
                return false;
        }
        languageSubtagsStartIndex = languageSubtagsEndIndex;
        if (isEqual || isAsteriskRange) {
            position = languageSubtagsStartIndex;
            return true;
        }

    } while (languageSubtagsStartIndex < languageLength);
    return false;
}

ALWAYS_INLINE bool matchesLangPseudoClass(const Element& element, const FixedVector<PossiblyQuotedIdentifier>& langList)
{
    AtomString language = element.effectiveLang();

    if (language.isEmpty())
        return false;

    // Implement basic and extended filterings of given language tags as specified in www.ietf.org/rfc/rfc4647.txt.
    StringView languageStringView = language;
    unsigned languageLength = language.length();
    for (auto& range : langList) {
        StringView rangeStringView = range.identifier;
        if (rangeStringView.isEmpty())
            continue;
        if (rangeStringView == "*"_s)
            return true;
        if (equalIgnoringASCIICase(languageStringView, rangeStringView))
            return true;

        unsigned rangeLength = rangeStringView.length();
        unsigned rangeSubtagsStartIndex = 0;
        unsigned lastMatchedLanguageSubtagIndex = 0;

        bool matchedRange = true;
        do {
            if (rangeSubtagsStartIndex > 0)
                rangeSubtagsStartIndex += 1;
            if (rangeSubtagsStartIndex > languageLength)
                return false;
            unsigned rangeSubtagsEndIndex = std::min<unsigned>(rangeStringView.find('-', rangeSubtagsStartIndex), rangeLength);
            StringView rangeSubtag = rangeStringView.substring(rangeSubtagsStartIndex, rangeSubtagsEndIndex - rangeSubtagsStartIndex);
            if (!containslanguageSubtagMatchingRange(languageStringView, rangeSubtag, languageLength, lastMatchedLanguageSubtagIndex)) {
                matchedRange = false;
                break;
            }
            rangeSubtagsStartIndex = rangeSubtagsEndIndex;
        } while (rangeSubtagsStartIndex < rangeLength);
        if (matchedRange)
            return true;
    }
    return false;
}

ALWAYS_INLINE bool matchesHeadingPseudoClass(const Element& element, const FixedVector<int>* integerList)
{
    CheckedPtr headingElement = dynamicDowncast<HTMLHeadingElement>(element);
    if (!headingElement)
        return false;
    if (!integerList)
        return true;
    return integerList->contains(static_cast<int>(headingElement->level()));
}

ALWAYS_INLINE bool matchesDirPseudoClass(const Element& element, const AtomString& argument)
{
    switch (element.effectiveTextDirection()) {
    case TextDirection::LTR:
        return equalIgnoringASCIICase(argument, "ltr"_s);
    case TextDirection::RTL:
        return equalIgnoringASCIICase(argument, "rtl"_s);
    }

    return false;
}

ALWAYS_INLINE bool matchesReadOnlyPseudoClass(const Element& element)
{
    return !element.matchesReadWritePseudoClass();
}

ALWAYS_INLINE bool matchesReadWritePseudoClass(const Element& element)
{
    return element.matchesReadWritePseudoClass();
}

ALWAYS_INLINE bool matchesIndeterminatePseudoClass(const Element& element)
{
    return element.matchesIndeterminatePseudoClass();
}

ALWAYS_INLINE bool doesShadowTreeContainFocusedElement(const Element& element)
{
    auto* shadowRoot = element.shadowRoot();
    return shadowRoot && shadowRoot->containsFocusedElement();
}

ALWAYS_INLINE bool matchesFocusPseudoClass(const Element& element)
{
    return element.focused() || doesShadowTreeContainFocusedElement(element);
}

ALWAYS_INLINE bool matchesFocusVisiblePseudoClass(const Element& element)
{
    return element.hasFocusVisible();
}

ALWAYS_INLINE bool matchesFocusWithinPseudoClass(const Element& element)
{
    return element.hasFocusWithin();
}

ALWAYS_INLINE bool matchesHtmlDocumentPseudoClass(const Element& element)
{
    return element.document().isHTMLDocument();
}

ALWAYS_INLINE bool matchesModalPseudoClass(const Element& element)
{
    if (auto* dialog = dynamicDowncast<HTMLDialogElement>(element))
        return dialog->isModal();
    return false;
}

ALWAYS_INLINE bool matchesPopoverOpenPseudoClass(const Element& element)
{
    return element.isPopoverShowing();
}

ALWAYS_INLINE bool matchesOpenPseudoClass(const Element& element)
{
    if (auto* dialog = dynamicDowncast<HTMLDialogElement>(element))
        return dialog->isOpen();
    if (auto* details = dynamicDowncast<HTMLDetailsElement>(element))
        return details->isOpen();
    return false;
}

ALWAYS_INLINE bool matchesUserInvalidPseudoClass(const Element& element)
{
    return element.matchesUserInvalidPseudoClass();
}

ALWAYS_INLINE bool matchesUserValidPseudoClass(const Element& element)
{
    return element.matchesUserValidPseudoClass();
}

} // namespace WebCore
