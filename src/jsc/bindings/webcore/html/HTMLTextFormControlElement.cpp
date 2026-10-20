/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2022 Apple Inc. All rights reserved.
 *           (C) 2006 Alexey Proskuryakov (ap@nypop.com)
 * Copyright (C) 2014 Google Inc. All rights reserved.
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
#include "HTMLTextFormControlElement.h"

#include "CommonAtomStrings.h"
#include "ContainerNodeInlines.h"
#include "ElementAncestorIteratorInlines.h"
#include "ElementInlines.h"
#include "ElementTextDirection.h"
#include "Event.h"
#include "EventNames.h"
#include "HTMLFormElement.h"
#include "HTMLInputElement.h"
#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLTextFormControlElement);

using namespace HTMLNames;

HTMLTextFormControlElement::HTMLTextFormControlElement(const QualifiedName& tagName, Document& document)
    : HTMLFormControlElement(tagName, document)
{
}

HTMLTextFormControlElement::~HTMLTextFormControlElement() = default;

Node::NeedsPostConnectionSteps HTMLTextFormControlElement::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree)
{
    NeedsPostConnectionSteps NeedsPostConnectionSteps = HTMLFormControlElement::insertionSteps(insertionType, parentOfInsertedTree);
    if (insertionType.connectedToDocument) {
        String initialValue = value();
        setTextAsOfLastFormControlChangeEvent(initialValue.isNull() ? String(emptyString()) : WTF::move(initialValue));
    }
    return NeedsPostConnectionSteps;
}

bool HTMLTextFormControlElement::placeholderShouldBeVisible() const
{
    // This function is used by the style resolver to match the :placeholder-shown pseudo class.
    // Since it is used for styling, it must not use any value depending on the style.
    return supportsPlaceholder() && isEmptyValue() && hasAttributeWithoutSynchronization(placeholderAttr);
}

void HTMLTextFormControlElement::updatePlaceholderVisibility()
{
    bool newIsPlaceholderVisible = placeholderShouldBeVisible();
    if (m_isPlaceholderVisible == newIsPlaceholderVisible)
        return;

    m_isPlaceholderVisible = newIsPlaceholderVisible;
}

void HTMLTextFormControlElement::setSelectionStart(unsigned start)
{
    setSelectionRange(start, std::max(start, selectionEnd()), selectionDirection());
}

void HTMLTextFormControlElement::setSelectionEnd(unsigned end)
{
    setSelectionRange(std::min(end, selectionStart()), end, selectionDirection());
}

void HTMLTextFormControlElement::setSelectionDirection(const String& direction)
{
    setSelectionRange(selectionStart(), selectionEnd(), direction);
}

void HTMLTextFormControlElement::select()
{
    FocusOptions focusOptions { .preventScroll = true };
    focus(focusOptions);
    if (setSelectionRange(0, std::numeric_limits<unsigned>::max(), SelectionHasNoDirection))
        scheduleSelectEvent();
}

void HTMLTextFormControlElement::dispatchFormControlChangeEvent()
{
    auto value = this->value();
    if (m_textAsOfLastFormControlChangeEvent != value.get()) {
        setTextAsOfLastFormControlChangeEvent(String { value });
        dispatchChangeEvent();
    }
    setChangedSinceLastFormControlChangeEvent(false);
    setInteractedWithSinceLastFormSubmitEvent(true);
}

ExceptionOr<void> HTMLTextFormControlElement::setRangeText(StringView replacement)
{
    return setRangeText(replacement, selectionStart(), selectionEnd(), String());
}

ExceptionOr<void> HTMLTextFormControlElement::setRangeText(StringView replacement, unsigned start, unsigned end, const String& selectionMode)
{
    if (start > end)
        return Exception { ExceptionCode::IndexSizeError };

    String text = value();
    unsigned textLength = text.length();
    unsigned replacementLength = replacement.length();
    unsigned newSelectionStart = selectionStart();
    unsigned newSelectionEnd = selectionEnd();

    start = std::min(start, textLength);
    end = std::min(end, textLength);

    if (start < end)
        text = makeStringByReplacing(text, start, end - start, replacement);
    else
        text = makeStringByInserting(text, replacement, start);

    setValue(text, TextFieldEventBehavior::DispatchNoEvent, TextControlSetValueSelection::DoNotSet);

    if (equalLettersIgnoringASCIICase(selectionMode, "select"_s)) {
        newSelectionStart = start;
        newSelectionEnd = start + replacementLength;
    } else if (equalLettersIgnoringASCIICase(selectionMode, "start"_s))
        newSelectionStart = newSelectionEnd = start;
    else if (equalLettersIgnoringASCIICase(selectionMode, "end"_s))
        newSelectionStart = newSelectionEnd = start + replacementLength;
    else {
        // Default is "preserve".
        long delta = replacementLength - (end - start);

        if (newSelectionStart > end)
            newSelectionStart += delta;
        else if (newSelectionStart > start)
            newSelectionStart = start;

        if (newSelectionEnd > end)
            newSelectionEnd += delta;
        else if (newSelectionEnd > start)
            newSelectionEnd = start + replacementLength;
    }

    if (setSelectionRange(newSelectionStart, newSelectionEnd, SelectionHasNoDirection))
        scheduleSelectEvent();

    return { };
}

void HTMLTextFormControlElement::setSelectionRange(unsigned start, unsigned end, const String& directionString)
{
    TextFieldSelectionDirection direction = SelectionHasNoDirection;
    if (directionString == "forward"_s)
        direction = SelectionHasForwardDirection;
    else if (directionString == "backward"_s)
        direction = SelectionHasBackwardDirection;

    if (setSelectionRange(start, end, direction))
        scheduleSelectEvent();
}

bool HTMLTextFormControlElement::setSelectionRange(unsigned start, unsigned end, TextFieldSelectionDirection direction)
{
    if (!isTextField())
        return false;

    // Clamps to the current value length.
    unsigned valueLength = value()->length();
    end = std::min(end, valueLength);
    start = std::min(start, end);

    return cacheSelection(start, end, direction);
}

bool HTMLTextFormControlElement::cacheSelection(unsigned start, unsigned end, TextFieldSelectionDirection direction)
{
    bool didChange = m_cachedSelectionStart != start || m_cachedSelectionEnd != end || m_cachedSelectionDirection != direction;
    m_cachedSelectionStart = start;
    m_cachedSelectionEnd = end;
    m_cachedSelectionDirection = direction;
    return didChange;
}

unsigned HTMLTextFormControlElement::selectionStart() const
{
    if (!isTextField())
        return 0;
    return m_cachedSelectionStart;
}

unsigned HTMLTextFormControlElement::selectionEnd() const
{
    if (!isTextField())
        return 0;
    return m_cachedSelectionEnd;
}

static ASCIILiteral directionString(TextFieldSelectionDirection direction)
{
    switch (direction) {
    case SelectionHasNoDirection:
        return "none"_s;
    case SelectionHasForwardDirection:
        return "forward"_s;
    case SelectionHasBackwardDirection:
        return "backward"_s;
    }

    ASSERT_NOT_REACHED();
    return "none"_s;
}

String HTMLTextFormControlElement::selectionDirection() const
{
    if (!isTextField())
        return directionString(SelectionHasNoDirection);
    return directionString(cachedSelectionDirection());
}

void HTMLTextFormControlElement::scheduleSelectionChangeEvent()
{
    if (m_hasScheduledSelectionChangeEvent)
        return;

    m_hasScheduledSelectionChangeEvent = true;
    queueTaskKeepingNodeAlive(*this, TaskSource::UserInteraction, [](auto& textControl) {
        textControl.m_hasScheduledSelectionChangeEvent = false;
        textControl.dispatchEvent(Event::create(eventNames().selectionchangeEvent, Event::CanBubble::Yes, Event::IsCancelable::No));
    });
}

void HTMLTextFormControlElement::scheduleSelectEvent()
{
    queueTaskToDispatchEvent(TaskSource::UserInteraction, Event::create(eventNames().selectEvent, Event::CanBubble::Yes, Event::IsCancelable::No));
    scheduleSelectionChangeEvent();
}

void HTMLTextFormControlElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    if (name == placeholderAttr)
        updatePlaceholderVisibility();
    else
        HTMLFormControlElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
}

String HTMLTextFormControlElement::directionForFormData() const
{
    auto direction = [this] {
        for (Ref element : lineageOfType<HTMLElement>(*this)) {
            auto& value = element->attributeWithoutSynchronization(dirAttr);
            if (equalLettersIgnoringASCIICase(value, "rtl"_s))
                return TextDirection::RTL;
            if (equalLettersIgnoringASCIICase(value, "ltr"_s))
                return TextDirection::LTR;
            if (equalLettersIgnoringASCIICase(value, "auto"_s))
                return computeAutoDirectionality(element).value_or(TextDirection::LTR);
        }
        return TextDirection::LTR;
    }();

    return direction == TextDirection::LTR ? "ltr"_s : "rtl"_s;
}

ExceptionOr<void> HTMLTextFormControlElement::setMaxLength(int maxLength)
{
    if (maxLength < 0 || (m_minLength >= 0 && maxLength < m_minLength))
        return Exception { ExceptionCode::IndexSizeError };
    setIntegralAttribute(maxlengthAttr, maxLength);
    return { };
}

ExceptionOr<void> HTMLTextFormControlElement::setMinLength(int minLength)
{
    if (minLength < 0 || (m_maxLength >= 0 && minLength > m_maxLength))
        return Exception { ExceptionCode::IndexSizeError };
    setIntegralAttribute(minlengthAttr, minLength);
    return { };
}

} // namespace WebCore
