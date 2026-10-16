/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2012 Samsung Electronics. All rights reserved.
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
#include <memory>
#include <wtf/ValueOrReference.h>

namespace WebCore {

class Decimal;
class FileList;
class HTMLDataListElement;
class InputType;
class RadioButtonGroups;

struct InputElementClickState {
    bool stateful { false };
    bool checked { false };
    bool indeterminate { false };
    bool trusted { false };
    RefPtr<HTMLInputElement> checkedRadioButton;
};

enum class WasSetByJavaScript : bool { No, Yes };

class HTMLInputElement final : public HTMLTextFormControlElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLInputElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLInputElement);
public:
    USING_CAN_MAKE_WEAKPTR(HTMLElement);

    static Ref<HTMLInputElement> create(const QualifiedName&, Document&, bool createdByParser);
    virtual ~HTMLInputElement();

    bool checked() const { return m_isChecked; }
    WEBCORE_EXPORT void setChecked(bool, WasSetByJavaScript = WasSetByJavaScript::Yes);
    String colorSpace();
    WEBCORE_EXPORT FileList* LEGACY_NODELETE files();
    WEBCORE_EXPORT void setFiles(RefPtr<FileList>&&);
    FileList* filesForBindings() { return files(); }
    void setFilesForBindings(RefPtr<FileList>&& fileList) { return setFiles(WTF::move(fileList)); }
    WEBCORE_EXPORT unsigned height() const;
    bool indeterminate() const { return m_isIndeterminate; }
    WEBCORE_EXPORT void setIndeterminate(bool);
    WEBCORE_EXPORT RefPtr<HTMLElement> list() const;
    unsigned size() const { return m_size; }
    WEBCORE_EXPORT ExceptionOr<void> setSize(unsigned);
    WEBCORE_EXPORT ValueOrReference<String> value() const final;
    WEBCORE_EXPORT ExceptionOr<void> setValue(const String&, TextFieldEventBehavior = DispatchNoEvent, TextControlSetValueSelection = TextControlSetValueSelection::SetSelectionToEnd) final;
    WEBCORE_EXPORT WallTime valueAsDate() const;
    WEBCORE_EXPORT ExceptionOr<void> setValueAsDate(WallTime);
    WEBCORE_EXPORT double valueAsNumber() const;
    WEBCORE_EXPORT ExceptionOr<void> setValueAsNumber(double, TextFieldEventBehavior = DispatchNoEvent);
    WEBCORE_EXPORT ExceptionOr<void> stepUp(int = 1);
    WEBCORE_EXPORT ExceptionOr<void> stepDown(int = 1);
    WEBCORE_EXPORT unsigned width() const;
    WEBCORE_EXPORT String validationMessage() const final;
    std::optional<unsigned> selectionStartForBindings() const;
    ExceptionOr<void> setSelectionStartForBindings(std::optional<unsigned>);
    std::optional<unsigned> selectionEndForBindings() const;
    ExceptionOr<void> setSelectionEndForBindings(std::optional<unsigned>);
    ExceptionOr<String> selectionDirectionForBindings() const;
    ExceptionOr<void> setSelectionDirectionForBindings(const String&);
    using HTMLTextFormControlElement::setRangeText;
    WEBCORE_EXPORT ExceptionOr<void> setRangeText(StringView, unsigned start, unsigned end, const String& selectionMode) final;
    ExceptionOr<void> setSelectionRangeForBindings(unsigned start, unsigned end, const String& direction);
    ExceptionOr<void> showPicker();

    // For ValidityState
    bool hasBadInput() const final;
    bool patternMismatch() const final;
    bool rangeUnderflow() const final;
    bool rangeOverflow() const final;
    bool stepMismatch() const final;
    bool tooShort() const final;
    bool tooLong() const final;
    bool typeMismatch() const final;
    bool valueMissing() const final;
    bool computeValidity() const final;

    // Sets the "allowed value step" defined in the HTML spec to the specified double pointer.
    // Returns false if there is no "allowed value step."
    bool getAllowedValueStep(Decimal*) const;

    WEBCORE_EXPORT bool LEGACY_NODELETE isTextButton() const;
    bool LEGACY_NODELETE isRadioButton() const;
    WEBCORE_EXPORT bool isTextField() const final;
    bool LEGACY_NODELETE isInputTypeHidden() const;
    WEBCORE_EXPORT bool LEGACY_NODELETE isPasswordField() const;
    bool LEGACY_NODELETE isTextType() const;
    WEBCORE_EXPORT bool LEGACY_NODELETE isEmailField() const;
    WEBCORE_EXPORT bool LEGACY_NODELETE isFileUpload() const;
    bool LEGACY_NODELETE isImageButton() const;
    WEBCORE_EXPORT bool LEGACY_NODELETE isNumberField() const;
    WEBCORE_EXPORT bool isSubmitButton() const final;
    WEBCORE_EXPORT bool LEGACY_NODELETE isTelephoneField() const;
    WEBCORE_EXPORT bool LEGACY_NODELETE isURLField() const;

    bool LEGACY_NODELETE matchesCheckedPseudoClass() const;
    bool matchesIndeterminatePseudoClass() const final;
    void setDefaultCheckedState(bool);

    bool hasDirtyValue() const { return !m_valueIfDirty.isNull(); }

    ValueOrReference<String> sanitizeValue(const String& value LIFETIME_BOUND) const;

    String valueWithDefault() const;

    bool isReplaced() const final;

    bool isActivatedSubmit() const final;
    void setActivatedSubmit(bool flag) final;

    void willDispatchEvent(Event&, InputElementClickState&);
    void didDispatchClickEvent(Event&, const InputElementClickState&);

    unsigned effectiveMaxLength() const;

    WEBCORE_EXPORT bool LEGACY_NODELETE multiple() const;

    bool hasActivationBehavior() const final;

    RefPtr<HTMLDataListElement> dataList() const;

    RefPtr<HTMLInputElement> checkedRadioButtonForGroup() const;
    // Returns null if this isn't associated with any radio button group.
    RadioButtonGroups* radioButtonGroups() const;
    // Functions for InputType classes.
    void setValueInternal(const String&, TextFieldEventBehavior);
    bool isTextFormControlFocusable() const;
    bool isTextFormControlKeyboardFocusable(const FocusEventData&) const;
    bool isTextFormControlMouseFocusable() const;

    bool LEGACY_NODELETE hasCustomFocusLogic() const final;

    void cacheSelectionInResponseToSetValue(int caretOffset) { cacheSelection(caretOffset, caretOffset, SelectionHasNoDirection); }

    // FIXME: According to HTML4, the length attribute's value can be arbitrarily
    // large. However, due to https://bugs.webkit.org/show_bug.cgi?id=14536 things
    // get rather sluggish when a text field has a larger number of characters than
    // this, even when just clicking in the text field.
    static constexpr unsigned maxEffectiveLength = 524288;

    const AtomString& name() const final;

    bool matchesReadWritePseudoClass() const final;

    String resultForDialogSubmit() const final;

    void finishParsingChildren() final;

    void initializeInputTypeAfterParsingOrCloning();

private:
    enum class CreationType : uint8_t { Normal, ByParser, ByCloning };
    HTMLInputElement(const QualifiedName&, Document&, CreationType);

    void defaultEventHandler(Event&) final;

    Ref<Element> cloneElementWithoutAttributesAndChildren(Document&, CustomElementRegistry*) const override;

    static constexpr int defaultSize = 20;

    void willChangeForm() final;
    void didChangeForm() final;
    NeedsPostConnectionSteps insertionSteps(InsertionType, ContainerNode&) final;
    void postConnectionSteps() final;
    void removingSteps(RemovalType, ContainerNode&) final;
    void movingSteps(MovingType, ContainerNode&) final;

    int defaultTabIndex() const final;
    bool supportsFocus() const final;
    bool isKeyboardFocusable(const FocusEventData&) const final;
    bool isMouseFocusable() const final;
    bool LEGACY_NODELETE isEnumeratable() const final;
    bool isLabelable() const final;

    bool isInteractiveContent() const final;

    bool canTriggerImplicitSubmission() const final { return isTextField(); }

    const AtomString& formControlType() const final;

    bool LEGACY_NODELETE canHaveSelection() const;

    bool accessKeyAction(bool sendMouseEvents) final;

    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason = AttributeModificationReason::Directly) final;

    void copyNonAttributePropertiesFromElement(const Element&) final;

    bool appendFormData(DOMFormData&) final;

    bool isSuccessfulSubmitButton() const final;
    bool matchesDefaultPseudoClass() const final;

    void reset() final;

    bool LEGACY_NODELETE isURLAttribute(const Attribute&) const final;
    bool isInRange() const final;
    bool isOutOfRange() const final;

    bool supportsReadOnly() const final;
    bool supportsMinLength() const { return isTextType(); }
    bool supportsMaxLength() const { return isTextType(); }
    bool LEGACY_NODELETE tooShort(StringView, NeedsToCheckDirtyFlag) const;
    bool tooLong(StringView, NeedsToCheckDirtyFlag) const;

    bool supportsPlaceholder() const final;
    bool isEmptyValue() const final;

    bool LEGACY_NODELETE isOptionalFormControl() const final { return !isRequiredFormControl(); }
    bool LEGACY_NODELETE isRequiredFormControl() const final;
    bool computeWillValidate() const final;
    void requiredStateChanged() final;

    void updateType(const AtomString& typeAttributeValue);
    void runPostTypeUpdateTasks();

    void maxLengthAttributeChanged(const AtomString& newValue);
    void minLengthAttributeChanged(const AtomString& newValue);
    void updateValueIfNeeded();

    void addToRadioButtonGroup();
    void removeFromRadioButtonGroup();

    bool dirAutoUsesValue() const final;

    AtomString m_name;
    String m_valueIfDirty;
    unsigned m_size { defaultSize };
    bool m_isChecked : 1 { false };
    bool m_dirtyCheckednessFlag : 1 { false };
    bool m_isDefaultChecked : 1 { false };
    bool m_isIndeterminate : 1 { false };
    bool m_isActivatedSubmit : 1 { false };
    bool m_hasNonEmptyList : 1 { false };
    bool m_parsingInProgress : 1;
    bool m_wasModifiedByUser : 1 { false };
    RefPtr<InputType> m_inputType;
};

}
