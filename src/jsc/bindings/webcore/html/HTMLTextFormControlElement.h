/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2018 Apple Inc. All rights reserved.
 * Copyright (C) 2009, 2010, 2011 Google Inc. All rights reserved.
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

#pragma once

#include "HTMLFormControlElement.h"
#include <wtf/ValueOrReference.h>

namespace WebCore {

enum TextFieldSelectionDirection { SelectionHasNoDirection, SelectionHasForwardDirection, SelectionHasBackwardDirection };
enum TextFieldEventBehavior { DispatchNoEvent, DispatchChangeEvent, DispatchInputAndChangeEvent };
enum TextControlSetValueSelection { SetSelectionToEnd, Clamp, DoNotSet };

class HTMLTextFormControlElement : public HTMLFormControlElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLTextFormControlElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLTextFormControlElement);
public:
    // Common flag for HTMLInputElement::tooLong() / tooShort() and HTMLTextAreaElement::tooLong() / tooShort().
    enum NeedsToCheckDirtyFlag {CheckDirtyFlag, IgnoreDirtyFlag};

    virtual ~HTMLTextFormControlElement();

    int maxLength() const { return m_maxLength; }
    WEBCORE_EXPORT ExceptionOr<void> setMaxLength(int);
    int minLength() const { return m_minLength; }
    ExceptionOr<void> setMinLength(int);

    NeedsPostConnectionSteps insertionSteps(InsertionType, ContainerNode&) override;

    // The derived class should return true if placeholder processing is needed.
    bool isPlaceholderVisible() const { return m_isPlaceholderVisible; }
    virtual bool supportsPlaceholder() const = 0;
    void updatePlaceholderVisibility();

    WEBCORE_EXPORT unsigned selectionStart() const;
    WEBCORE_EXPORT unsigned selectionEnd() const;
    WEBCORE_EXPORT String selectionDirection() const;
    WEBCORE_EXPORT void setSelectionStart(unsigned);
    WEBCORE_EXPORT void setSelectionEnd(unsigned);
    WEBCORE_EXPORT void setSelectionDirection(const String&);
    WEBCORE_EXPORT void select();
    WEBCORE_EXPORT ExceptionOr<void> setRangeText(StringView replacement);
    WEBCORE_EXPORT virtual ExceptionOr<void> setRangeText(StringView replacement, unsigned start, unsigned end, const String& selectionMode);
    void setSelectionRange(unsigned start, unsigned end, const String& direction);
    WEBCORE_EXPORT bool setSelectionRange(unsigned start, unsigned end, TextFieldSelectionDirection = SelectionHasNoDirection);

    void scheduleSelectionChangeEvent();

    void dispatchFormControlChangeEvent() final;
    void scheduleSelectEvent();

    virtual ValueOrReference<String> value() const = 0;

    virtual ExceptionOr<void> setValue(const String&, TextFieldEventBehavior = DispatchNoEvent, TextControlSetValueSelection = TextControlSetValueSelection::SetSelectionToEnd) = 0;

    virtual bool dirAutoUsesValue() const = 0;

    String directionForFormData() const;

    void setTextAsOfLastFormControlChangeEvent(String&& text) { m_textAsOfLastFormControlChangeEvent = WTF::move(text); }

    bool canContainRangeEndPoint() const override { return false; }

protected:
    HTMLTextFormControlElement(const QualifiedName&, Document&);

    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) override;

    bool readOnlyBarsFromConstraintValidation() const final { return true; }

    bool LEGACY_NODELETE cacheSelection(unsigned start, unsigned end, TextFieldSelectionDirection);

    void internalSetMaxLength(int maxLength) { m_maxLength = maxLength; }
    void internalSetMinLength(int minLength) { m_minLength = minLength; }

private:
    TextFieldSelectionDirection cachedSelectionDirection() const { return static_cast<TextFieldSelectionDirection>(m_cachedSelectionDirection); }

    bool LEGACY_NODELETE isTextFormControlElement() const final { return true; }

    // Returns true if user-editable value is empty. Used to check placeholder visibility.
    virtual bool isEmptyValue() const = 0;

    bool placeholderShouldBeVisible() const;

    unsigned m_cachedSelectionDirection : 2 { SelectionHasNoDirection };
    unsigned m_isPlaceholderVisible : 1 { false };

    int m_maxLength { -1 };
    int m_minLength { -1 };

    unsigned m_cachedSelectionStart { 0 };
    unsigned m_cachedSelectionEnd { 0 };

    bool m_hasScheduledSelectionChangeEvent { false };

    String m_textAsOfLastFormControlChangeEvent;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::HTMLTextFormControlElement)
    static bool isType(const WebCore::Element& element) { return element.isTextFormControlElement(); }
    static bool isType(const WebCore::Node& node)
    {
        auto* element = dynamicDowncast<WebCore::Element>(node);
        return element && isType(*element);
    }
    static bool isType(const WebCore::EventTarget& target)
    {
        auto* node = dynamicDowncast<WebCore::Node>(target);
        return node && isType(*node);
    }
SPECIALIZE_TYPE_TRAITS_END()
