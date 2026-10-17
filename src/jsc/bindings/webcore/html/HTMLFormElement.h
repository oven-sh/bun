/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2019 Apple Inc. All rights reserved.
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

#include "FormSubmission.h"
#include "HTMLElement.h"
#include "RadioButtonGroups.h"
#include <memory>
#include <wtf/TZoneMalloc.h>
#include <wtf/WeakHashSet.h>

namespace WebCore {

class DOMFormData;
class Event;
class FormListedElement;
class HTMLFormControlElement;
class HTMLFormControlsCollection;
class HTMLImageElement;
class ValidatedFormListedElement;

class HTMLFormElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLFormElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLFormElement);
public:
    static Ref<HTMLFormElement> create(Document&);
    static Ref<HTMLFormElement> create(const QualifiedName&, Document&);
    virtual ~HTMLFormElement();

    Ref<HTMLFormControlsCollection> elements();
    Vector<Ref<Element>> namedElements(const AtomString&);
    bool isSupportedPropertyName(const AtomString&);

    bool isSupportedPropertyIndex(unsigned index) { return index < length(); }
    WEBCORE_EXPORT unsigned length();
    HTMLElement* item(unsigned index);
    std::optional<Variant<Ref<RadioNodeList>, Ref<Element>>> namedItem(const AtomString&);
    Vector<AtomString> LEGACY_NODELETE supportedPropertyNames() const;

    String enctype() const { return m_attributes.encodingType(); }

    WEBCORE_EXPORT const AtomString& autocomplete() const;

    void registerFormListedElement(FormListedElement&);
    void unregisterFormListedElement(FormListedElement&);

    void addInvalidFormControl(const HTMLElement&);
    void removeInvalidFormControlIfNeeded(const HTMLElement&);

    void registerImgElement(HTMLImageElement&);
    void unregisterImgElement(HTMLImageElement&);

    void submitIfPossible(Event*, HTMLFormControlElement* = nullptr, FormSubmissionTrigger = NotSubmittedByJavaScript);
    void submitFromJavaScript();
    ExceptionOr<void> requestSubmit(HTMLElement* submitter);
    WEBCORE_EXPORT void reset();

    void submitImplicitly(Event&, bool fromImplicitSubmissionTrigger);

    String LEGACY_NODELETE name() const;

    bool LEGACY_NODELETE noValidate() const;

    WEBCORE_EXPORT String action() const;
    WEBCORE_EXPORT String method() const;

    DOMTokenList& relList();

    AtomString target() const final;

    HTMLFormControlElement* findSubmitter(const Event*) const;

    HTMLFormControlElement* defaultButton() const;
    void resetDefaultButton();

    WEBCORE_EXPORT bool checkValidity();
    bool reportValidity();

    RadioButtonGroups& radioButtonGroups() LIFETIME_BOUND { return m_radioButtonGroups; }

    WEBCORE_EXPORT const Vector<WeakPtr<HTMLElement, WeakPtrImplWithEventTargetData>>& LEGACY_NODELETE unsafeListedElements() const;
    WEBCORE_EXPORT Vector<Ref<FormListedElement>> copyListedElementsVector() const;
    Vector<Ref<ValidatedFormListedElement>> copyValidatedListedElementsVector() const;
    const Vector<WeakPtr<HTMLImageElement, WeakPtrImplWithEventTargetData>>& imageElements() const LIFETIME_BOUND { return m_imageElements; }

    static HTMLFormElement* findClosestFormAncestor(const Element&);
    
    RefPtr<DOMFormData> constructEntryList(RefPtr<HTMLFormControlElement>&&, Ref<DOMFormData>&&);
    
private:
    HTMLFormElement(const QualifiedName&, Document&);

    void removingSteps(RemovalType, ContainerNode&) final;

    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) final;
    bool LEGACY_NODELETE isURLAttribute(const Attribute&) const final;

    void submit(Event*, FormSubmissionTrigger, HTMLFormControlElement* submitter = nullptr);

    void submitDialog(const String& returnValue);

    unsigned formElementIndexWithFormAttribute(Element*, unsigned rangeStart, unsigned rangeEnd);
    unsigned formElementIndex(FormListedElement&);

    bool validateInteractively();

    // Validates each of the controls, and stores controls of which 'invalid'
    // event was not canceled to the specified vector. Returns true if there
    // are any invalid controls in this form.
    bool checkInvalidControlsAndCollectUnhandled(Vector<Ref<ValidatedFormListedElement>>&);

    RefPtr<HTMLElement> elementFromPastNamesMap(const AtomString&) const;
    void addToPastNamesMap(FormAssociatedElement&, const AtomString& pastName);
#if ASSERT_ENABLED
    void assertItemCanBeInPastNamesMap(FormAssociatedElement&) const;
#endif
    void removeFromPastNamesMap(FormAssociatedElement&);

    bool matchesValidPseudoClass() const final;
    bool matchesInvalidPseudoClass() const final;

    void resetListedFormControlElements();

    FormSubmission::Attributes m_attributes;
    HashMap<AtomString, WeakPtr<HTMLElement, WeakPtrImplWithEventTargetData>> m_pastNamesMap;

    RadioButtonGroups m_radioButtonGroups;
    mutable WeakPtr<HTMLFormControlElement, WeakPtrImplWithEventTargetData> m_defaultButton;

    Vector<WeakPtr<HTMLElement, WeakPtrImplWithEventTargetData>> m_listedElements;
    Vector<WeakPtr<HTMLImageElement, WeakPtrImplWithEventTargetData>> m_imageElements;
    WeakHashSet<HTMLElement, WeakPtrImplWithEventTargetData> m_invalidFormControls;
    const std::unique_ptr<DOMTokenList> m_relList;
    RefPtr<HTMLFormControlsCollection> m_controlsCollection;

    unsigned m_listedElementsBeforeIndex { 0 };
    unsigned m_listedElementsAfterIndex { 0 };

    bool m_isSubmittingOrPreparingForSubmission { false };
    bool m_shouldSubmit { false };

    bool m_isInResetFunction { false };

    bool m_isConstructingEntryList { false };
};

} // namespace WebCore
