/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2022 Apple Inc. All rights reserved.
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

#include "HTMLTextFormControlElement.h"

namespace WebCore {

class HTMLTextAreaElement final : public HTMLTextFormControlElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLTextAreaElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLTextAreaElement);
public:
    WEBCORE_EXPORT static Ref<HTMLTextAreaElement> create(Document&);
    static Ref<HTMLTextAreaElement> create(const QualifiedName&, Document&);

    unsigned rows() const { return m_rows; }
    WEBCORE_EXPORT void setRows(unsigned);
    unsigned cols() const { return m_cols; }
    WEBCORE_EXPORT void setCols(unsigned);
    WEBCORE_EXPORT String defaultValue() const;
    WEBCORE_EXPORT void setDefaultValue(String&&);
    WEBCORE_EXPORT ValueOrReference<String> value() const final;
    WEBCORE_EXPORT ExceptionOr<void> setValue(const String&, TextFieldEventBehavior = DispatchNoEvent, TextControlSetValueSelection = TextControlSetValueSelection::SetSelectionToEnd) final;
    unsigned textLength() const { return value()->length(); }
    String validationMessage() const final;

    void setSelectionRangeForBindings(unsigned start, unsigned end, const String& direction);

    bool dirAutoUsesValue() const final { return true; }

private:
    HTMLTextAreaElement(const QualifiedName&, Document&);

    void setNonDirtyValue(const String&, TextControlSetValueSelection);
    void setValueCommon(const String&, TextFieldEventBehavior, TextControlSetValueSelection);

    bool supportsReadOnly() const final { return true; }

    bool supportsPlaceholder() const final { return true; }
    bool isEmptyValue() const final { return value()->isEmpty(); }

    bool LEGACY_NODELETE isOptionalFormControl() const final { return !isRequiredFormControl(); }
    bool LEGACY_NODELETE isRequiredFormControl() const final { return isRequired(); }

    bool LEGACY_NODELETE isEnumeratable() const final { return true; }
    bool isLabelable() const final { return true; }

    bool isInteractiveContent() const final { return true; }

    const AtomString& formControlType() const final;

    bool isTextField() const final { return true; }

    void childrenChanged(const ChildChange&) final;
    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) final;
    bool appendFormData(DOMFormData&) final;
    void reset() final;
    bool LEGACY_NODELETE hasCustomFocusLogic() const final { return true; }
    int defaultTabIndex() const final { return 0; }
    bool isMouseFocusable() const final { return isFocusable(); }
    bool isKeyboardFocusable(const FocusEventData&) const final { return isFocusable(); }

    bool accessKeyAction(bool) final;

    bool matchesReadWritePseudoClass() const final { return isMutable(); }

    bool valueMissing() const final;
    bool tooShort() const final;
    bool tooLong() const final;

    bool valueMissing(StringView valueOverride) const;
    bool tooShort(StringView valueOverride, NeedsToCheckDirtyFlag) const;
    bool tooLong(StringView valueOverride, NeedsToCheckDirtyFlag) const;

    void copyNonAttributePropertiesFromElement(const Element&) final;

    static constexpr unsigned defaultRows = 2;
    static constexpr unsigned defaultCols = 20;

    unsigned m_rows { defaultRows };
    unsigned m_cols { defaultCols };
    String m_value;
    uint8_t m_isDirty { false }; // uint8_t for better packing on Windows
    uint8_t m_wasModifiedByUser { false }; // uint8_t for better packing on Windows
};

} // namespace
