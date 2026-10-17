/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2022 Apple Inc. All rights reserved.
 *           (C) 2006 Alexey Proskuryakov (ap@nypop.com)
 * Copyright (C) 2007 Samuel Weinig (sam@webkit.org)
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
 *
 */

#include "config.h"
#include "HTMLTextAreaElement.h"

#include "DOMFormData.h"
#include "ElementInlines.h"
#include "Event.h"
#include "EventNames.h"
#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include "LocalizedStrings.h"
#include "NodeName.h"
#include "Text.h"
#include "TextNodeTraversal.h"
#include <wtf/Ref.h>
#include <wtf/StdLibExtras.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLTextAreaElement);

using namespace HTMLNames;

static inline unsigned LEGACY_NODELETE computeLengthForAPIValue(StringView text)
{
    unsigned length = text.length();
    unsigned crlfCount = 0;
    for (unsigned i = 0; i < length; ++i) {
        if (text[i] == '\r' && i + 1 < length && text[i + 1] == '\n')
            crlfCount++;
    }
    return text.length() - crlfCount;
}

HTMLTextAreaElement::HTMLTextAreaElement(const QualifiedName& tagName, Document& document)
    : HTMLTextFormControlElement(tagName, document)
{
    ASSERT(hasTagName(textareaTag));
}

Ref<HTMLTextAreaElement> HTMLTextAreaElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLTextAreaElement(tagName, document));
}

Ref<HTMLTextAreaElement> HTMLTextAreaElement::create(Document& document)
{
    return create(textareaTag, document);
}

const AtomString& HTMLTextAreaElement::formControlType() const
{
    return textareaTag->localName();
}

void HTMLTextAreaElement::childrenChanged(const ChildChange& change)
{
    HTMLElement::childrenChanged(change);
    if (!m_isDirty)
        setNonDirtyValue(defaultValue(), TextControlSetValueSelection::Clamp);
}

void HTMLTextAreaElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    HTMLTextFormControlElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);

    switch (name.nodeName()) {
    case AttributeNames::rowsAttr:
        m_rows = limitToOnlyHTMLNonNegativeNumbersGreaterThanZero(newValue, defaultRows);
        break;
    case AttributeNames::colsAttr:
        m_cols = limitToOnlyHTMLNonNegativeNumbersGreaterThanZero(newValue, defaultCols);
        break;
    case AttributeNames::maxlengthAttr:
        internalSetMaxLength(parseHTMLNonNegativeInteger(newValue).value_or(-1));
        updateValidity();
        break;
    case AttributeNames::minlengthAttr:
        internalSetMinLength(parseHTMLNonNegativeInteger(newValue).value_or(-1));
        updateValidity();
        break;
    default:
        break;
    }
}

bool HTMLTextAreaElement::appendFormData(DOMFormData& formData)
{
    if (name().isEmpty())
        return false;

    formData.append(name(), value().get());
    if (auto& dirname = attributeWithoutSynchronization(dirnameAttr); !dirname.isNull())
        formData.append(dirname, directionForFormData());
    return true;    
}

void HTMLTextAreaElement::reset()
{
    setInteractedWithSinceLastFormSubmitEvent(false);
    setNonDirtyValue(defaultValue(), TextControlSetValueSelection::SetSelectionToEnd);
}

ValueOrReference<String> HTMLTextAreaElement::value() const
{
    return m_value;
}

ExceptionOr<void> HTMLTextAreaElement::setValue(const String& value, TextFieldEventBehavior eventBehavior, TextControlSetValueSelection selection)
{
    setValueCommon(value, eventBehavior, selection);
    m_isDirty = true;
    updateValidity();
    return { };
}

void HTMLTextAreaElement::setNonDirtyValue(const String& value, TextControlSetValueSelection selection)
{
    setValueCommon(value, TextFieldEventBehavior::DispatchNoEvent, selection);
    m_isDirty = false;
    updateValidity();
}

void HTMLTextAreaElement::setValueCommon(const String& newValue, TextFieldEventBehavior, TextControlSetValueSelection selection)
{
    m_wasModifiedByUser = false;
    // Code elsewhere normalizes line endings added by the user via the keyboard or pasting.
    // We normalize line endings coming from JavaScript here.
    auto normalizedValue = newValue.isNull() ? emptyString() : makeStringBySimplifyingNewLines(newValue);

    // Return early because we don't want to move the caret or trigger other side effects
    // when the value isn't changing. This matches Firefox behavior, at least.
    if (normalizedValue == value())
        return;

    bool shouldClamp = selection == TextControlSetValueSelection::Clamp;
    auto selectionStartValue = shouldClamp ? selectionStart() : 0;
    auto selectionEndValue = shouldClamp ? selectionEnd() : 0;

    m_value = normalizedValue;
    updatePlaceholderVisibility();
    if (selfOrPrecedingNodesAffectDirAuto())
        updateEffectiveTextDirection();

    auto endOfString = m_value.length();
    if (selection == TextControlSetValueSelection::SetSelectionToEnd)
        cacheSelection(endOfString, endOfString, SelectionHasNoDirection);
    else if (shouldClamp)
        cacheSelection(std::min(endOfString, selectionStartValue), std::min(endOfString, selectionEndValue), SelectionHasNoDirection);

    setTextAsOfLastFormControlChangeEvent(String(normalizedValue));
}

String HTMLTextAreaElement::defaultValue() const
{
    return TextNodeTraversal::childTextContent(*this);
}

void HTMLTextAreaElement::setDefaultValue(String&& defaultValue)
{
    setTextContent(WTF::move(defaultValue));
}

String HTMLTextAreaElement::validationMessage() const
{
    if (!willValidate())
        return String();

    if (customError())
        return customValidationMessage();

    if (valueMissing())
        return validationMessageValueMissingText();

    if (tooShort())
        return validationMessageTooShortText(value()->length(), minLength());

    if (tooLong())
        return validationMessageTooLongText(value()->length(), maxLength());

    return String();
}

void HTMLTextAreaElement::setSelectionRangeForBindings(unsigned start, unsigned end, const String& direction)
{
    setSelectionRange(start, end, direction);
}

bool HTMLTextAreaElement::valueMissing() const
{
    return valueMissing({ });
}

bool HTMLTextAreaElement::tooShort() const
{
    return tooShort({ }, CheckDirtyFlag);
}

bool HTMLTextAreaElement::tooLong() const
{
    return tooLong({ }, CheckDirtyFlag);
}

bool HTMLTextAreaElement::valueMissing(StringView value) const
{
    if (!(isRequired() && isMutable()))
        return false;
    if (value.isNull())
        return this->value()->isEmpty();
    return value.isEmpty();
}

bool HTMLTextAreaElement::tooShort(StringView value, NeedsToCheckDirtyFlag check) const
{
    // Return false for the default value or value set by script even if it is
    // shorter than minLength.
    if (check == CheckDirtyFlag && !m_wasModifiedByUser)
        return false;

    int min = minLength();
    if (min <= 0)
        return false;

    // The empty string is excluded from tooShort validation.
    unsigned length = value.isNull() ? this->value()->length() : computeLengthForAPIValue(value);
    return length > 0 && length < static_cast<unsigned>(min);
}

bool HTMLTextAreaElement::tooLong(StringView value, NeedsToCheckDirtyFlag check) const
{
    // Return false for the default value or value set by script even if it is
    // longer than maxLength.
    if (check == CheckDirtyFlag && !m_wasModifiedByUser)
        return false;

    int max = maxLength();
    if (max < 0)
        return false;

    unsigned length = value.isNull() ? this->value()->length() : computeLengthForAPIValue(value);
    return length > static_cast<unsigned>(max);
}

bool HTMLTextAreaElement::accessKeyAction(bool)
{
    focus();
    return false;
}

void HTMLTextAreaElement::setCols(unsigned cols)
{
    setUnsignedIntegralAttribute(colsAttr, limitToOnlyHTMLNonNegativeNumbersGreaterThanZero(cols, defaultCols));
}

void HTMLTextAreaElement::setRows(unsigned rows)
{
    setUnsignedIntegralAttribute(rowsAttr, limitToOnlyHTMLNonNegativeNumbersGreaterThanZero(rows, defaultRows));
}

void HTMLTextAreaElement::copyNonAttributePropertiesFromElement(const Element& source)
{
    auto& sourceElement = downcast<HTMLTextAreaElement>(source);

    setValueCommon(sourceElement.value(), DispatchNoEvent, TextControlSetValueSelection::DoNotSet);
    m_isDirty = sourceElement.m_isDirty;
    m_wasModifiedByUser = sourceElement.m_wasModifiedByUser;
    HTMLTextFormControlElement::copyNonAttributePropertiesFromElement(source);

    updateValidity();
}

} // namespace WebCore
