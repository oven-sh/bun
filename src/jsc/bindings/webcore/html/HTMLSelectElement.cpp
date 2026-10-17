/*
 * Copyright (C) 2010 Nokia Corporation and/or its subsidiary(-ies).
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
 *           (C) 2006 Alexey Proskuryakov (ap@nypop.com)
 * Copyright (C) 2010-2022 Google Inc. All rights reserved.
 * Copyright (C) 2009 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
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
#include "HTMLSelectElement.h"

#include "CommonAtomStrings.h"
#include "ContainerNodeInlines.h"
#include "DOMFormData.h"
#include "ElementChildIteratorInlines.h"
#include "ElementTraversal.h"
#include "FormAtomStrings.h"
#include "GenericCachedHTMLCollection.h"
#include "HTMLDataListElement.h"
#include "HTMLFormElement.h"
#include "HTMLHRElement.h"
#include "HTMLNames.h"
#include "HTMLOptGroupElement.h"
#include "HTMLOptionsCollectionInlines.h"
#include "HTMLParserIdioms.h"
#include "HTMLSelectedContentElement.h"
#include "LocalizedStrings.h"
#include "NodeName.h"
#include "NodeRareData.h"
#include "ScriptDisallowedScope.h"
#include "TypedElementDescendantIteratorInlines.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLSelectElement);

using namespace HTMLNames;

// https://html.spec.whatwg.org/#dom-htmloptionscollection-length
static constexpr unsigned maxSelectItems = 100000;

HTMLSelectElement::HTMLSelectElement(const QualifiedName& tagName, Document& document)
    : HTMLFormControlElement(tagName, document)
    , m_size(0)
    , m_multiple(false)
    , m_shouldRecalcListItems(false)
{
    ASSERT(hasTagName(selectTag));
}

Ref<HTMLSelectElement> HTMLSelectElement::create(const QualifiedName& tagName, Document& document)
{
    ASSERT(tagName.matches(selectTag));
    return adoptRef(*new HTMLSelectElement(tagName, document));
}

Ref<HTMLSelectElement> HTMLSelectElement::create(Document& document)
{
    return HTMLSelectElement::create(selectTag, document);
}

HTMLSelectElement::~HTMLSelectElement() = default;

HTMLSelectElement* HTMLSelectElement::findOwnerSelect(ContainerNode* startNode, ExcludeOptGroup excludeOptGroup)
{
    if (!startNode)
        return nullptr;
    if (auto* select = dynamicDowncast<HTMLSelectElement>(*startNode))
        return select;
    if (is<HTMLOptGroupElement>(*startNode)) {
        if (excludeOptGroup == ExcludeOptGroup::Yes)
            return nullptr;
        return findOwnerSelect(startNode->parentNode(), ExcludeOptGroup::Yes);
    }
    if (isAnyOf<HTMLDataListElement, HTMLHRElement, HTMLOptionElement>(*startNode))
        return nullptr;
    return findOwnerSelect(startNode->parentNode(), excludeOptGroup);
}

const AtomString& HTMLSelectElement::formControlType() const
{
    auto& names = formAtomStrings();
    return m_multiple ? names.selectMultiple : names.selectOne;
}

bool HTMLSelectElement::hasPlaceholderLabelOption() const
{
    // The select element has no placeholder label option if it has an attribute "multiple" specified or a preferred size of non-1.
    // 
    // The condition "size() > 1" is not compliant with the HTML5 spec as of Dec 3, 2010. "size() != 1" is correct.
    // Using "size() > 1" here because size() may be 0 in WebKit.
    // See the discussion at https://bugs.webkit.org/show_bug.cgi?id=43887
    //
    // "0 size()" happens when an attribute "size" is absent or an invalid size attribute is specified.
    // In this case, the preferred size should be assumed as the default.
    // The default preferred size is 1 for non-multiple select elements, and 4 for multiple select elements.
    //
    // Finally, if size() == 0 and non-multiple, the preferred size can be assumed as 1.
    if (multiple() || size() > 1)
        return false;

    int listIndex = optionToListIndex(0);
    ASSERT(listIndex >= 0);
    if (listIndex)
        return false;
    Ref option = downcast<HTMLOptionElement>(*listItems()[listIndex]);
    return option->value().isEmpty();
}

String HTMLSelectElement::validationMessage() const
{
    if (!willValidate())
        return String();

    if (customError())
        return customValidationMessage();

    return valueMissing() ? validationMessageValueMissingForSelectText() : String();
}

bool HTMLSelectElement::valueMissing() const
{
    if (!isRequired())
        return false;

    int firstSelectionIndex = selectedIndex();

    // If a non-placeholer label option is selected (firstSelectionIndex > 0), it's not value-missing.
    return firstSelectionIndex < 0 || (!firstSelectionIndex && hasPlaceholderLabelOption());
}

bool HTMLSelectElement::usesMenuList() const
{
    return !m_multiple && m_size <= 1;
}

ExceptionOr<void> HTMLSelectElement::add(const OptionOrOptGroupElement& element, const std::optional<HTMLElementOrInt>& before)
{
    RefPtr<HTMLElement> beforeElement;
    Ref<ContainerNode> parent = *this;
    if (before) {
        beforeElement = WTF::switchOn(before.value(),
            [](const Ref<HTMLElement>& element) -> RefPtr<HTMLElement> { return element.ptr(); },
            [this](int index) -> RefPtr<HTMLElement> { return item(index); }
        );
        if (std::holds_alternative<int>(before.value()) && beforeElement && beforeElement->parentNode())
            parent = *beforeElement->parentNode();
    }
    Ref toInsert = WTF::switchOn(element,
        [](const auto& htmlElement) -> HTMLElement& { return htmlElement; }
    );

    return parent->insertBefore(toInsert, WTF::move(beforeElement));
}

void HTMLSelectElement::remove(int optionIndex)
{
    int listIndex = optionToListIndex(optionIndex);
    if (listIndex < 0)
        return;

    Ref { *listItems()[listIndex] }->remove();
}

String HTMLSelectElement::value() const
{
    for (auto& item : listItems()) {
        if (RefPtr option = dynamicDowncast<HTMLOptionElement>(item.get())) {
            if (option->selected())
                return option->value();
        }
    }
    return emptyString();
}

void HTMLSelectElement::setValue(const String& value)
{
    // Find the option with value() matching the given parameter and make it the current selection.
    unsigned optionIndex = 0;
    for (auto& item : listItems()) {
        if (RefPtr option = dynamicDowncast<HTMLOptionElement>(item.get())) {
            if (option->value() == value) {
                setSelectedIndex(optionIndex);
                return;
            }
            ++optionIndex;
        }
    }

    setSelectedIndex(-1);
}

void HTMLSelectElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    switch (name.nodeName()) {
    case AttributeNames::sizeAttr: {
        unsigned oldSize = m_size;
        unsigned size = limitToOnlyHTMLNonNegative(newValue);

        // Ensure that we've determined selectedness of the items at least once prior to changing the size.
        RefPtr<HTMLOptionElement> oldSelectedOption;
        if (oldSize != size) {
            updateListItemSelectedStates();
            oldSelectedOption = selectedOptionForSelectedContent();
        }

        m_size = size;
        updateValidity();
        if (m_size != oldSize) {
            resetSelectedness(oldSelectedOption.get());
            updateValidity();
        }
        break;
    }
    case AttributeNames::multipleAttr:
        parseMultipleAttribute(newValue);
        break;
    default:
        HTMLFormControlElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
        break;
    }
}

int HTMLSelectElement::defaultTabIndex() const
{
    return 0;
}

Ref<HTMLCollection> HTMLSelectElement::selectedOptions()
{
    return ensureRareData().ensureNodeLists().addCachedCollection<HTMLSelectedOptionsCollection>(*this);
}

Ref<HTMLOptionsCollection> HTMLSelectElement::options()
{
    return ensureRareData().ensureNodeLists().addCachedCollection<HTMLOptionsCollection>(*this);
}

void HTMLSelectElement::updateListItemSelectedStates()
{
    if (m_shouldRecalcListItems)
        recalcListItems();
}

CompletionHandlerCallingScope HTMLSelectElement::optionToSelectFromChildChangeScope(const ContainerNode::ChildChange& change)
{
    if (multiple())
        return { };

    auto getLastSelectedOption = [](HTMLOptGroupElement& optGroup) -> HTMLOptionElement* {
        for (auto* option = Traversal<HTMLOptionElement>::lastChild(optGroup); option; option = Traversal<HTMLOptionElement>::previousSibling(*option)) {
            if (option->selectedWithoutUpdate())
                return option;
        }
        return nullptr;
    };

    RefPtr<HTMLOptionElement> optionToSelect;
    if (change.type == ChildChange::Type::ElementInserted || change.type == ChildChange::Type::ElementAndTextInserted || change.type == ChildChange::Type::ElementMovedInto) {
        auto handleInsertedElement = [&](Element& insertedElement) {
            if (auto* option = dynamicDowncast<HTMLOptionElement>(insertedElement)) {
                if (option->selectedWithoutUpdate())
                    optionToSelect = option;
            } else if (auto* optGroup = dynamicDowncast<HTMLOptGroupElement>(insertedElement))
                optionToSelect = getLastSelectedOption(*optGroup);
        };
        if (RefPtr element = change.siblingChanged)
            handleInsertedElement(*element);
        else if (change.insertedChildren) {
            for (auto& child : *change.insertedChildren) {
                if (RefPtr element = dynamicDowncast<Element>(child))
                    handleInsertedElement(*element);
            }
        }
    }

    return CompletionHandlerCallingScope { [optionToSelect = WTF::move(optionToSelect), select = Ref { *this }] {
        if (optionToSelect)
            select->selectOption(optionToSelect->index(), SelectOptionFlag::SkipSelectedContentUpdate);
    } };
}

// FIXME: we should really make this disappear when
// document().settings().htmlEnhancedSelectParsingEnabled() is true, but
// https://github.com/whatwg/html/issues/11825 needs to be resolved. It might not be possible
// without a risky behavioral change.
void HTMLSelectElement::childrenChanged(const ChildChange& change)
{
    ASSERT(change.affectsElements != ChildChange::AffectsElements::Unknown);

    if (change.affectsElements == ChildChange::AffectsElements::No) {
        HTMLFormControlElement::childrenChanged(change);
        return;
    }

    auto selectOptionIfNecessaryScope = optionToSelectFromChildChangeScope(change);

    setRecalcListItems();
    updateValidity();

    HTMLFormControlElement::childrenChanged(change);
}

// Select the given option as the default if no option is explicitly selected.
// This maintains m_isSelected incrementally during option insertion so that
// HTMLOptionElement::finishParsingChildren() can use selectedWithoutUpdate()
// (O(1)) instead of selected() which triggers O(n) recalcListItems().
void HTMLSelectElement::selectDefaultOptionIfNeeded(HTMLOptionElement& candidate)
{
    // The HTML spec only requires a default selection for single-select elements
    // with size <= 1 (dropdowns). Listboxes (size > 1) and multiple-select
    // elements may have no selection.
    // https://html.spec.whatwg.org/C/#selectedness-setting-algorithm
    if (multiple() || m_size > 1)
        return;

    // Walk existing options to check if any is already selected, and whether
    // the candidate is the first non-disabled option. Once any option is
    // default-selected, subsequent calls find it and return immediately (O(1)).
    // Use traverseNextSkippingChildren() since <option> elements cannot nest.
    for (auto it = descendantsOfType<HTMLOptionElement>(*this).begin(); it; it.traverseNextSkippingChildren()) {
        if (it->selectedWithoutUpdate())
            return;
        if (&*it == &candidate) {
            candidate.setSelectedState(true);
            return;
        }
        // A non-disabled option before the candidate exists — the candidate
        // is not the first non-disabled option.
        if (!protect(*it)->isDisabledFormControl())
            return;
    }
}

void HTMLSelectElement::optionElementChildrenChanged()
{
    updateValidity();
}

void HTMLSelectElement::setSize(unsigned size)
{
    setUnsignedIntegralAttribute(sizeAttr, limitToOnlyHTMLNonNegative(size));
}

HTMLOptionElement* HTMLSelectElement::namedItem(const AtomString& name)
{
    return options()->namedItem(name);
}

HTMLOptionElement* HTMLSelectElement::item(unsigned index)
{
    return options()->item(index);
}

bool HTMLSelectElement::isSupportedPropertyIndex(unsigned index)
{
    return options()->isSupportedPropertyIndex(index);
}

ExceptionOr<void> HTMLSelectElement::setItem(unsigned index, HTMLOptionElement* option)
{
    if (!option) {
        remove(index);
        return { };
    }

    // If we are adding options, we should check 'index > maxSelectItems' first to avoid integer overflow.
    if (index > length() && index >= maxSelectItems)
        return { };

    int diff = index - length();
    
    std::optional<HTMLElementOrInt> before;
    // Out of array bounds? First insert empty dummies.
    if (diff > 0) {
        auto result = setLength(index);
        if (result.hasException())
            return result;
        // Replace an existing entry?
    } else if (diff < 0) {
        if (RefPtr itemBefore = item(index + 1))
            before = itemBefore.releaseNonNull();
        remove(index);
    }

    // Finally add the new element.
    auto result = add(*option, before);
    if (result.hasException())
        return result;

    if (diff >= 0 && option->selected())
        optionSelectionStateChanged(*option, true);

    return { };
}

ExceptionOr<void> HTMLSelectElement::setLength(unsigned newLength)
{
    // If we are adding options, we should check 'index > maxSelectItems' first to avoid integer overflow.
    if (newLength > length() && newLength > maxSelectItems)
        return { };

    int diff = length() - newLength;

    if (diff < 0) { // Add dummy elements.
        do {
            auto result = add(HTMLOptionElement::create(protect(document())), std::nullopt);
            if (result.hasException())
                return result;
        } while (++diff);
    } else {
        auto& items = listItems();

        // Removing children fires mutation events, which might mutate the DOM further, so we first copy out a list
        // of elements that we intend to remove then attempt to remove them one at a time.
        Vector<Ref<HTMLOptionElement>> itemsToRemove;
        size_t optionIndex = 0;
        for (auto& item : items) {
            RefPtr option = dynamicDowncast<HTMLOptionElement>(*item);
            if (option && optionIndex++ >= newLength) {
                ASSERT(item->parentNode());
                itemsToRemove.append(option.releaseNonNull());
            }
        }

        // FIXME: Clients can detect what order we remove the options in; is it good to remove them in ascending order?
        // FIXME: This ignores exceptions. A previous version passed through the exception only for the last item removed.
        // What exception behavior do we want?
        for (auto& item : itemsToRemove)
            item->remove();
    }
    return { };
}

bool HTMLSelectElement::isRequiredFormControl() const
{
    return isRequired();
}

// Returns the 1st valid item |skip| items from |listIndex| in direction |direction| if there is one.
// Otherwise, it returns the valid item closest to that boundary which is past |listIndex| if there is one.
// Otherwise, it returns |listIndex|.
// Valid means that it is enabled and an option element.
int HTMLSelectElement::nextValidIndex(int listIndex, SkipDirection direction, int skip) const
{
    auto& listItems = this->listItems();
    int lastGoodIndex = listIndex;
    int size = listItems.size();
    int step = direction == SkipDirection::Forwards ? 1 : -1;
    for (listIndex += step; listIndex >= 0 && listIndex < size; listIndex += step) {
        --skip;
        RefPtr listItem = listItems[listIndex].get();
        if (!listItem->isDisabledFormControl() && is<HTMLOptionElement>(*listItem)) {
            lastGoodIndex = listIndex;
            if (skip <= 0)
                break;
        }
    }
    return lastGoodIndex;
}

int HTMLSelectElement::nextSelectableListIndex(int startIndex) const
{
    return nextValidIndex(startIndex, SkipDirection::Forwards, 1);
}

const Vector<WeakPtr<HTMLElement, WeakPtrImplWithEventTargetData>>& HTMLSelectElement::listItems() const
{
    if (m_shouldRecalcListItems)
        recalcListItems();
    else {
#if ASSERT_ENABLED
        Vector<WeakPtr<HTMLElement, WeakPtrImplWithEventTargetData>> items = m_listItems;
        recalcListItems(false);
        ASSERT(items == m_listItems);
#endif
    }

    return m_listItems;
}

void HTMLSelectElement::invalidateSelectedItems()
{
    if (RefPtr collection = cachedHTMLCollection(CollectionType::SelectedOptions))
        collection->invalidateCache();
}

void HTMLSelectElement::setRecalcListItems()
{
    m_shouldRecalcListItems = true;
    if (!isConnected()) {
        if (RefPtr collection = cachedHTMLCollection(CollectionType::SelectOptions))
            collection->invalidateCache();
        invalidateSelectedItems();
    }
}

void HTMLSelectElement::recalcListItems(bool updateSelectedStates) const
{
    m_listItems.shrink(0);

    m_shouldRecalcListItems = false;

    RefPtr<HTMLOptionElement> foundSelected;
    auto handleOptionElement = [&](HTMLOptionElement& option) {
        m_listItems.append(&option);
        if (updateSelectedStates && !m_multiple) {
            if (option.selected()) {
                if (foundSelected)
                    foundSelected->setSelectedState(false);
                foundSelected = option;
            } else if (m_size <= 1 && !foundSelected && !option.isDisabledFormControl()) {
                foundSelected = option;
                foundSelected->setSelectedState(true);
            }
        }
    };

    for (auto it = descendantsOfType<HTMLElement>(*const_cast<HTMLSelectElement*>(this)).begin(); it;) {
        Ref descendant = *it;
        if (RefPtr option = dynamicDowncast<HTMLOptionElement>(descendant)) {
            handleOptionElement(*option);
            it.traverseNextSkippingChildren();
            continue;
        }
        if (is<HTMLOptGroupElement>(descendant)) {
            m_listItems.append(descendant.ptr());
            for (auto optGroupIt = descendantsOfType<HTMLElement>(descendant).begin(); optGroupIt;) {
                Ref optGroupDescendant = *optGroupIt;
                if (RefPtr option = dynamicDowncast<HTMLOptionElement>(optGroupDescendant)) {
                    handleOptionElement(*option);
                    optGroupIt.traverseNextSkippingChildren();
                    continue;
                }
                if (isAnyOf<HTMLOptGroupElement, HTMLDataListElement, HTMLSelectElement, HTMLHRElement>(optGroupDescendant)) {
                    optGroupIt.traverseNextSkippingChildren();
                    continue;
                }
                optGroupIt.traverseNext();
            }
            it.traverseNextSkippingChildren();
            continue;
        }
        if (is<HTMLHRElement>(descendant)) {
            m_listItems.append(descendant.ptr());
            it.traverseNextSkippingChildren();
            continue;
        }
        if (isAnyOf<HTMLDataListElement, HTMLSelectElement>(descendant)) {
            it.traverseNextSkippingChildren();
            continue;
        }
        it.traverseNext();
    }
}

int HTMLSelectElement::selectedIndex() const
{
    unsigned index = 0;

    // Return the number of the first option selected.
    for (auto& element : listItems()) {
        if (RefPtr option = dynamicDowncast<HTMLOptionElement>(*element)) {
            if (option->selected())
                return index;
            ++index;
        }
    }

    return -1;
}

void HTMLSelectElement::setSelectedIndex(int index)
{
    selectOption(index, SelectOptionFlag::DeselectOtherOptions);
}

void HTMLSelectElement::optionSelectionStateChanged(HTMLOptionElement& option, bool optionIsSelected)
{
    ASSERT(option.ownerSelectElement() == this);
    if (optionIsSelected)
        selectOption(option.index());
    else if (!usesMenuList())
        selectOption(-1);
    else
        selectOption(nextSelectableListIndex(-1));
}

void HTMLSelectElement::selectOption(int optionIndex, OptionSet<SelectOptionFlag> flags)
{
    bool shouldDeselect = !m_multiple || flags.contains(SelectOptionFlag::DeselectOtherOptions);

    auto& items = listItems();
    int listIndex = optionToListIndex(optionIndex);

    RefPtr<HTMLElement> element;
    if (listIndex >= 0)
        element = items[listIndex].get();

    if (shouldDeselect)
        deselectItemsWithoutValidation(element.get());

    RefPtr<HTMLOptionElement> selectedOption;
    if (RefPtr option = dynamicDowncast<HTMLOptionElement>(element)) {
        option->setSelectedState(true);
        selectedOption = option;
    }

    invalidateSelectedItems();
    updateValidity();

    if (!flags.contains(SelectOptionFlag::SkipSelectedContentUpdate))
        updateSelectedContent(selectedOption.get());
}

int HTMLSelectElement::optionToListIndex(int optionIndex) const
{
    auto& items = listItems();
    int listSize = static_cast<int>(items.size());
    if (optionIndex < 0 || optionIndex >= listSize)
        return -1;

    int optionIndex2 = -1;
    for (int listIndex = 0; listIndex < listSize; ++listIndex) {
        if (is<HTMLOptionElement>(*items[listIndex])) {
            ++optionIndex2;
            if (optionIndex2 == optionIndex)
                return listIndex;
        }
    }

    return -1;
}

void HTMLSelectElement::deselectItemsWithoutValidation(HTMLElement* excludeElement)
{
    for (auto& element : listItems()) {
        if (element == excludeElement)
            continue;
        if (RefPtr option = dynamicDowncast<HTMLOptionElement>(*element))
            option->setSelectedState(false);
    }
    invalidateSelectedItems();
}

void HTMLSelectElement::parseMultipleAttribute(const AtomString& value)
{
    bool oldMultiple = m_multiple;
    int oldSelectedIndex = selectedIndex();
    m_multiple = !value.isNull();
    updateValidity();
    if (oldMultiple != m_multiple) {
        if (oldSelectedIndex >= 0)
            setSelectedIndex(oldSelectedIndex);
        else {
            setRecalcListItems();
            invalidateSelectedItems();
            updateSelectedContent();
        }
    }
}

bool HTMLSelectElement::appendFormData(DOMFormData& formData)
{
    const AtomString& name = this->name();
    if (name.isEmpty())
        return false;

    bool successful = false;
    for (auto& element : listItems()) {
        RefPtr option = dynamicDowncast<HTMLOptionElement>(*element);
        if (option && option->selected() && !option->isDisabledFormControl()) {
            formData.append(name, option->value());
            successful = true;
        }
    }

    // It's possible that this is a menulist with multiple options and nothing
    // will be submitted (!successful). We won't send a unselected non-disabled
    // option as fallback. This behavior matches to other browsers.
    return successful;
} 

void HTMLSelectElement::reset()
{
    RefPtr<HTMLOptionElement> firstOption;
    RefPtr<HTMLOptionElement> selectedOption;

    for (auto& element : listItems()) {
        RefPtr option = dynamicDowncast<HTMLOptionElement>(*element);
        if (!option)
            continue;

        option->setDirty(false);

        if (option->hasAttributeWithoutSynchronization(selectedAttr)) {
            if (selectedOption && !m_multiple)
                selectedOption->setSelectedState(false);
            option->setSelectedState(true);
            selectedOption = option;
        } else
            option->setSelectedState(false);

        if (!firstOption && !option->isDisabledFormControl())
            firstOption = WTF::move(option);
    }

    if (!selectedOption && firstOption && !m_multiple && m_size <= 1)
        firstOption->setSelectedState(true);

    setInteractedWithSinceLastFormSubmitEvent(false);
    invalidateSelectedItems();
    updateValidity();
    updateSelectedContent();
}

unsigned HTMLSelectElement::length() const
{
    unsigned options = 0;

    auto& items = listItems();
    for (unsigned i = 0; i < items.size(); ++i) {
        if (is<HTMLOptionElement>(*items[i]))
            ++options;
    }

    return options;
}

void HTMLSelectElement::updateSelectedContent(HTMLOptionElement* selectedOption) const
{
    ASSERT(ScriptDisallowedScope::InMainThread::isScriptAllowed());

    if (!m_selectedContentDescendantCount || !updatesSelectedContent())
        return;

    RefPtr selectedOptionRef = selectedOption;
    if (!selectedOptionRef)
        selectedOptionRef = firstSelectedOption();

    for (Ref selectedContent : selectedContentElements()) {
        if (!selectedOptionRef)
            selectedContent->removeChildren();
        else
            selectedOptionRef->cloneIntoSelectedContent(selectedContent);
    }
}

// https://html.spec.whatwg.org/#update-a-selectedcontent
void HTMLSelectElement::updateSelectedContent(HTMLSelectedContentElement& selectedContent) const
{
    ASSERT(ScriptDisallowedScope::InMainThread::isScriptAllowed());

    if (selectedContent.isDisabled())
        return;

    if (RefPtr selectedOption = firstSelectedOption())
        selectedOption->cloneIntoSelectedContent(selectedContent);
    else
        selectedContent.removeChildren();
}

Vector<Ref<HTMLSelectedContentElement>> HTMLSelectElement::selectedContentElements() const
{
    Vector<Ref<HTMLSelectedContentElement>> result;
    // FIXME: Remove suppression once rdar://189998365 is fixed.
    SUPPRESS_MEMORY_UNSAFE_CAST for (Ref selectedContent : descendantsOfType<HTMLSelectedContentElement>(*const_cast<HTMLSelectElement*>(this))) {
        if (!selectedContent->isDisabled())
            result.append(selectedContent);
    }
    return result;
}

RefPtr<HTMLOptionElement> HTMLSelectElement::selectedOptionForSelectedContent() const
{
    if (m_multiple || !m_selectedContentDescendantCount)
        return nullptr;
    return firstSelectedOption();
}

// https://html.spec.whatwg.org/#reset-a-select's-selectedness
void HTMLSelectElement::resetSelectedness(HTMLOptionElement* oldSelectedOption)
{
    setRecalcListItems();
    if (RefPtr selectedOption = selectedOptionForSelectedContent(); selectedOption != oldSelectedOption)
        updateSelectedContent(selectedOption.get());
}

void HTMLSelectElement::queueSelectedContentUpdate()
{
    if (m_hasQueuedSelectedContentUpdate || !m_selectedContentDescendantCount || !updatesSelectedContent())
        return;

    m_hasQueuedSelectedContentUpdate = true;
    protect(document())->queueMicrotask([weakThis = WeakPtr<HTMLSelectElement, WeakPtrImplWithEventTargetData> { *this }] {
        RefPtr select = weakThis;
        if (!select)
            return;
        select->m_hasQueuedSelectedContentUpdate = false;
        select->updateSelectedContent();
    });
}

RefPtr<HTMLOptionElement> HTMLSelectElement::firstSelectedOption() const
{
    for (auto& element : listItems()) {
        if (RefPtr option = dynamicDowncast<HTMLOptionElement>(*element); option && option->selected())
            return option;
    }
    return nullptr;
}

void HTMLSelectElement::registerSelectedContentElement()
{
    ++m_selectedContentDescendantCount;
}

void HTMLSelectElement::unregisterSelectedContentElement()
{
    ASSERT(m_selectedContentDescendantCount > 0);
    --m_selectedContentDescendantCount;
}

} // namespace WebCore
