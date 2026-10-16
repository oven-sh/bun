/*
 * Copyright (C) 2010 Nokia Corporation and/or its subsidiary(-ies).
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
 * Copyright (C) 2010-2015 Google Inc. All rights reserved.
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
#include "HTMLOptionElement.h"
#include <wtf/CompletionHandler.h>
#include <wtf/OptionSet.h>

namespace WebCore {

class HTMLOptionsCollection;
class HTMLSelectedContentElement;

class HTMLSelectElement final : public HTMLFormControlElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLSelectElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLSelectElement);
public:
    USING_CAN_MAKE_WEAKPTR(HTMLElement);

    static Ref<HTMLSelectElement> create(const QualifiedName&, Document&);
    static Ref<HTMLSelectElement> create(Document&);
    ~HTMLSelectElement();

    enum class ExcludeOptGroup : bool { No, Yes };
    static HTMLSelectElement* LEGACY_NODELETE findOwnerSelect(ContainerNode*, ExcludeOptGroup);

    WEBCORE_EXPORT int selectedIndex() const;
    WEBCORE_EXPORT void setSelectedIndex(int);

    String validationMessage() const final;
    bool valueMissing() const final;

    WEBCORE_EXPORT unsigned length() const;

    unsigned size() const { return m_size; }
    bool multiple() const { return m_multiple; }

    bool LEGACY_NODELETE usesMenuList() const;

    using OptionOrOptGroupElement = Variant<Ref<HTMLOptionElement>, Ref<HTMLOptGroupElement>>;
    using HTMLElementOrInt = Variant<Ref<HTMLElement>, int>;
    WEBCORE_EXPORT ExceptionOr<void> add(const OptionOrOptGroupElement&, const std::optional<HTMLElementOrInt>& before);

    using Node::remove;
    WEBCORE_EXPORT void remove(int);

    WEBCORE_EXPORT String value() const;
    WEBCORE_EXPORT void setValue(const String&);

    WEBCORE_EXPORT Ref<HTMLOptionsCollection> options();
    Ref<HTMLCollection> selectedOptions();

    void optionElementChildrenChanged();

    void setRecalcListItems();
    void updateListItemSelectedStates();

    WEBCORE_EXPORT const Vector<WeakPtr<HTMLElement, WeakPtrImplWithEventTargetData>>& listItems() const LIFETIME_BOUND;

    WEBCORE_EXPORT void setSize(unsigned);

    // Called by the bindings for the unnamed index-setter.
    ExceptionOr<void> setItem(unsigned index, HTMLOptionElement*);
    ExceptionOr<void> setLength(unsigned);

    WEBCORE_EXPORT HTMLOptionElement* namedItem(const AtomString& name);
    WEBCORE_EXPORT HTMLOptionElement* item(unsigned index);
    bool isSupportedPropertyIndex(unsigned index);

    void selectDefaultOptionIfNeeded(HTMLOptionElement&);

    int optionToListIndex(int optionIndex) const;

    // For use in the implementation of HTMLOptionElement.
    void optionSelectionStateChanged(HTMLOptionElement&, bool optionIsSelected);

    CompletionHandlerCallingScope optionToSelectFromChildChangeScope(const ChildChange&);

    bool canContainRangeEndPoint() const override { return false; }

    void updateSelectedContent(HTMLOptionElement* = nullptr) const;
    void updateSelectedContent(HTMLSelectedContentElement&) const;
    void queueSelectedContentUpdate();
    RefPtr<HTMLOptionElement> selectedOptionForSelectedContent() const;
    void resetSelectedness(HTMLOptionElement* oldSelectedOption);
    bool updatesSelectedContent() const { return !m_multiple; }

    void LEGACY_NODELETE registerSelectedContentElement();
    void LEGACY_NODELETE unregisterSelectedContentElement();
    bool hasSelectedContentDescendants() const { return m_selectedContentDescendantCount; }

protected:
    HTMLSelectElement(const QualifiedName&, Document&);

private:
    const AtomString& formControlType() const final;

    int defaultTabIndex() const final;
    bool LEGACY_NODELETE hasCustomFocusLogic() const final { return true; }

    bool LEGACY_NODELETE isEnumeratable() const final { return true; }
    bool isLabelable() const final { return true; }

    bool isInteractiveContent() const final { return true; }

    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) final;

    bool appendFormData(DOMFormData&) final;

    void reset() final;

    void invalidateSelectedItems();
    void recalcListItems(bool updateSelectedStates = true) const;

    bool LEGACY_NODELETE isOptionalFormControl() const final { return !isRequiredFormControl(); }
    bool LEGACY_NODELETE isRequiredFormControl() const final;

    bool hasPlaceholderLabelOption() const;

    enum class SelectOptionFlag : uint8_t {
        DeselectOtherOptions = 1 << 0,
        SkipSelectedContentUpdate = 1 << 3,
    };
    void selectOption(int optionIndex, OptionSet<SelectOptionFlag> = { });
    void deselectItemsWithoutValidation(HTMLElement* elementToExclude = nullptr);
    void parseMultipleAttribute(const AtomString&);
    Vector<Ref<HTMLSelectedContentElement>> selectedContentElements() const;
    RefPtr<HTMLOptionElement> firstSelectedOption() const;

    enum class SkipDirection : bool { Backwards, Forwards };
    int nextValidIndex(int listIndex, SkipDirection, int skip) const;
    int nextSelectableListIndex(int startIndex) const;

    void childrenChanged(const ChildChange&) final;

    // m_listItems contains HTMLOptionElement, HTMLOptGroupElement, and HTMLHRElement objects.
    mutable Vector<WeakPtr<HTMLElement, WeakPtrImplWithEventTargetData>> m_listItems;
    unsigned m_size;
    bool m_multiple;
    mutable bool m_shouldRecalcListItems;
    unsigned m_selectedContentDescendantCount { 0 };
    bool m_hasQueuedSelectedContentUpdate { false };
};

} // namespace
