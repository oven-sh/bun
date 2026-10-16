/*
 * Copyright (C) 2024 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "ElementTextDirection.h"

#include "ContainerNodeInlines.h"
#include "ElementAncestorIteratorInlines.h"
#include "ElementChildIteratorInlines.h"
#include "ElementRareData.h"
#include "HTMLBDIElement.h"
#include "HTMLInputElement.h"
#include "HTMLSlotElement.h"
#include "HTMLTextFormControlElement.h"
#include "NodeTraversal.h"
#include "TypedElementDescendantIteratorInlines.h"
#include "WritingMode.h"

namespace WebCore {

TextDirectionState parseTextDirectionState(const AtomString& value)
{
    if (equalLettersIgnoringASCIICase(value, "ltr"_s))
        return TextDirectionState::LTR;
    if (equalLettersIgnoringASCIICase(value, "rtl"_s))
        return TextDirectionState::RTL;
    if (equalLettersIgnoringASCIICase(value, "auto"_s))
        return TextDirectionState::Auto;
    return TextDirectionState::Undefined;
}

TextDirectionState elementTextDirectionState(const Element& element)
{
    return parseTextDirectionState(element.attributeWithoutSynchronization(HTMLNames::dirAttr));
}

bool elementHasValidTextDirectionState(const Element& element)
{
    return elementTextDirectionState(element) != TextDirectionState::Undefined;
}

bool elementHasAutoTextDirectionState(const Element& element)
{
    auto textDirectionState = elementTextDirectionState(element);
    return textDirectionState == TextDirectionState::Auto || (is<HTMLBDIElement>(element) && textDirectionState == TextDirectionState::Undefined);
}

static void updateHasDirAutoFlagForSubtree(Node& firstNode, TextDirectionState textDirectionState)
{
    bool dirIsAuto = textDirectionState == TextDirectionState::Auto;
    firstNode.setSelfOrPrecedingNodesAffectDirAuto(dirIsAuto);

    for (RefPtr node = firstNode.firstChild(); node; ) {
        RefPtr element = dynamicDowncast<Element>(*node);

        if (element && (is<HTMLBDIElement>(*element) || elementHasValidTextDirectionState(*element))) {
            node = NodeTraversal::nextSkippingChildren(*node, &firstNode);
            continue;
        }

        node->setSelfOrPrecedingNodesAffectDirAuto(dirIsAuto);
        node = NodeTraversal::next(*node, &firstNode);
    }
}

static void updateElementHasDirAutoFlag(Element& element, TextDirectionState textDirectionState)
{
    RefPtr parent = element.parentOrShadowHostElement();
    element.document().setIsDirAttributeDirty();

    switch (textDirectionState) {
    case TextDirectionState::LTR:
    case TextDirectionState::RTL:
        if (element.selfOrPrecedingNodesAffectDirAuto() || (parent && parent->selfOrPrecedingNodesAffectDirAuto()))
            updateHasDirAutoFlagForSubtree(element, textDirectionState);
        break;

    case TextDirectionState::Auto:
        updateHasDirAutoFlagForSubtree(element, textDirectionState);
        break;

    case TextDirectionState::Undefined:
        if (element.selfOrPrecedingNodesAffectDirAuto() && !(parent && parent->selfOrPrecedingNodesAffectDirAuto()) && !is<HTMLBDIElement>(element))
            updateHasDirAutoFlagForSubtree(element, textDirectionState);
        break;
    }
}

// Specs: https://html.spec.whatwg.org/multipage/dom.html#text-node-directionality
static std::optional<TextDirection> computeTextDirectionFromText(const String& text)
{
    if (auto direction = text.defaultWritingDirection())
        return *direction == U_LEFT_TO_RIGHT ? TextDirection::LTR : TextDirection::RTL;
    return std::nullopt;
}

// Specs: https://html.spec.whatwg.org/multipage/dom.html#attr-dir
static std::optional<TextDirection> computeTextDirection(const Element& element, TextDirectionState textDirectionState)
{
    switch (textDirectionState) {
    case TextDirectionState::LTR:
        return TextDirection::LTR;
    case TextDirectionState::RTL:
        return TextDirection::RTL;

    case TextDirectionState::Auto:
        // Specs: Return the auto directionality of element.
        // Specs: If directionality is null, then return 'ltr'.
        return computeAutoDirectionality(element).value_or(TextDirection::LTR);

    case TextDirectionState::Undefined:
        // Specs: If element is a bdi element, then return the auto directionality of element.
        // Specs: If directionality is null, then return 'ltr'.
        if (is<HTMLBDIElement>(element))
            return computeAutoDirectionality(element).value_or(TextDirection::LTR);

        // Specs: If element is an input element whose type attribute is in the Telephone state
        // then return LTR;
        if (auto* input = dynamicDowncast<HTMLInputElement>(element); input && input->isTelephoneField())
            return TextDirection::LTR;

        // Specs: If the parent is a shadow root, then return the directionality of parent's host.
        // Specs: If the parent is an element, then return the directionality of parent.
        if (RefPtr parent = element.parentOrShadowHostElement())
            return computeTextDirection(*parent, elementTextDirectionState(*parent));

        return std::nullopt;
    }

    return std::nullopt;
}

// Specs: https://html.spec.whatwg.org/multipage/dom.html#contained-text-auto-directionality
static std::optional<TextDirection> computeContainedTextAutoDirection(const Element& element)
{
    for (RefPtr child = element.firstChild(); child; ) {
        // Specs: Skip bdi, script, style nodes.
        if (child->hasTagName(HTMLNames::bdiTag) || child->hasTagName(HTMLNames::scriptTag) || child->hasTagName(HTMLNames::styleTag)) {
            child = NodeTraversal::nextSkippingChildren(*child, &element);
            continue;
        }

        if (RefPtr childElement = dynamicDowncast<Element>(*child)) {
            // Specs: Skip text form controls
            // Specs: Skip the element whose dir attribute is not in the undefined state
            if (childElement->isTextField() || elementHasValidTextDirectionState(*childElement)) {
                child = NodeTraversal::nextSkippingChildren(*child, &element);
                continue;
            }
        }

        // Specs: If child is a slot element whose root is a shadow root,
        // then return the directionality of that shadow root's host.
        if (RefPtr childSlotElement = dynamicDowncast<HTMLSlotElement>(*child)) {
            if (RefPtr childHost = childSlotElement->shadowHost())
                return computeTextDirection(*childHost, elementTextDirectionState(*childHost));
        }

        // Specs: If descendant is a Text node and its text direction is not null,
        // then return it.
        if (child->isTextNode()) {
            if (auto direction = computeTextDirectionFromText(child->textContent(true)))
                return direction;
        }

        child = NodeTraversal::next(*child, &element);
    }

    return std::nullopt;
}

// Specs: https://html.spec.whatwg.org/multipage/dom.html#auto-directionality
static std::optional<TextDirection> computeTextDirectionOfSlotElement(const HTMLSlotElement& slotElement)
{
    // Specs: If element is a slot element whose root is a shadow root
    // and element's assigned nodes are not empty, then return the
    // directionality of this slot.
    if (!slotElement.isInShadowTree())
        return computeContainedTextAutoDirection(slotElement);

    auto* nodes = slotElement.assignedNodes();
    if (!nodes)
        return computeContainedTextAutoDirection(slotElement);

    for (auto& child : *nodes) {
        // Specs: If child is a Text node and its text direction is
        // not null, then return it.
        if (child->isTextNode()) {
            if (auto direction = computeTextDirectionFromText(child->textContent(true)))
                return direction;
        }

        if (RefPtr element = dynamicDowncast<Element>(child.get())) {
            // Specs: If child direction is not null, then return child direction.
            if (auto direction = computeAutoDirectionality(*element))
                return direction;
        }
    }

    return std::nullopt;
}

// Specs: https://html.spec.whatwg.org/multipage/dom.html#auto-directionality
std::optional<TextDirection> computeAutoDirectionality(const Element& element)
{
    if (auto* textFormControl = dynamicDowncast<HTMLTextFormControlElement>(element)) {
        if (!textFormControl->dirAutoUsesValue() || !elementHasAutoTextDirectionState(element))
            return computeContainedTextAutoDirection(*textFormControl);

        // Specs: The directionality of the auto-directionality form-associated
        // element is calculated from its value() text.
        // Specs: If element's value is not the empty string, then return 'ltr'.
        if (auto value = textFormControl->value(); !value->isEmpty())
            return computeTextDirectionFromText(value).value_or(TextDirection::LTR);
        return std::nullopt;
    }

    if (auto* slotElement = dynamicDowncast<HTMLSlotElement>(element))
        return computeTextDirectionOfSlotElement(*slotElement);

    return computeContainedTextAutoDirection(element);
}

std::optional<TextDirection> computeTextDirectionIfDirIsAuto(const Element& element)
{
    if (!(element.selfOrPrecedingNodesAffectDirAuto() && element.hasAutoTextDirectionState()))
        return std::nullopt;
    return computeTextDirection(element, elementTextDirectionState(element));
}

static void updateEffectiveTextDirectionOfElementAndShadowTree(Element& element, std::optional<TextDirection> direction, Element* initiator = nullptr)
{
    bool usesEffectiveTextDirection = !!direction;
    auto effectiveDirection = direction.value_or(TextDirection::LTR);

    element.setUsesEffectiveTextDirection(usesEffectiveTextDirection);
    element.setEffectiveTextDirection(effectiveDirection);

    if (RefPtr shadowRoot = element.shadowRoot()) {
        for (Ref child : childrenOfType<Element>(*shadowRoot)) {
            if (child.ptr() == initiator)
                continue;

            updateEffectiveTextDirectionOfElementAndShadowTree(child, direction);
            updateEffectiveTextDirectionOfDescendants(child, direction);
        }
    }
}

static std::optional<TextDirection> updateEffectiveTextDirectionOfElementAndDescendants(Element& element, TextDirectionState textDirectionState, Element* initiator = nullptr)
{
    updateElementHasDirAutoFlag(element, textDirectionState);

    auto direction = computeTextDirection(element, textDirectionState);

    updateEffectiveTextDirectionOfElementAndShadowTree(element, direction, initiator);
    updateEffectiveTextDirectionOfDescendants(element, direction, initiator);

    return direction;
}

void textDirectionStateChanged(Element& element, TextDirectionState textDirectionState)
{
    updateEffectiveTextDirectionOfElementAndDescendants(element, textDirectionState);

    RefPtr parent = element.parentOrShadowHostElement();
    if (!parent)
        return;

    if (parent->selfOrPrecedingNodesAffectDirAuto())
        updateEffectiveTextDirectionOfAncestors(*parent, &element);
}

void updateEffectiveTextDirectionState(Element& element, TextDirectionState textDirectionState, Element* initiator)
{
    auto direction = updateEffectiveTextDirectionOfElementAndDescendants(element, textDirectionState, initiator);

    RefPtr parent = element.parentOrShadowHostElement();
    if (!parent)
        return;

    // This element won't affect its ancestors if its effective direction
    // is the same as its parent's effective direction.
    if (direction && parent->usesEffectiveTextDirection() && *direction == parent->effectiveTextDirection())
        return;

    if (parent->selfOrPrecedingNodesAffectDirAuto())
        updateEffectiveTextDirectionOfAncestors(*parent, &element);
}

void updateEffectiveTextDirectionOfDescendants(Element& element, std::optional<TextDirection> direction, Element* initiator)
{
    for (auto it = descendantsOfType<Element>(element).begin(); it; ) {
        Ref child = *it;

        if (child.ptr() == initiator) {
            it.traverseNextSkippingChildren();
            continue;
        }

        if (elementHasValidTextDirectionState(child)) {
            // Slot elements with dir=auto depend on slotted light DOM content,
            // so recompute their direction when propagating changes through the shadow tree.
            if (RefPtr slotElement = dynamicDowncast<HTMLSlotElement>(child.get()); slotElement && slotElement->isInShadowTree() && elementHasAutoTextDirectionState(child))
                updateEffectiveTextDirectionOfElementAndDescendants(child, TextDirectionState::Auto);
            it.traverseNextSkippingChildren();
            continue;
        }

        if (is<HTMLBDIElement>(child)) {
            it.traverseNextSkippingChildren();
            continue;
        }

        updateEffectiveTextDirectionOfElementAndShadowTree(child, direction);
        it.traverseNext();
    }
}

void updateEffectiveTextDirectionOfAncestors(Element& element, Element* initiator)
{
    ASSERT(element.selfOrPrecedingNodesAffectDirAuto());
    for (Ref ancestor : lineageOfType<Element>(element)) {
        if (!elementHasAutoTextDirectionState(ancestor))
            continue;
        updateEffectiveTextDirectionState(ancestor, TextDirectionState::Auto, initiator);
        break;
    }
}

} // namespace WebCore
