/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004, 2005, 2006, 2010 Apple Inc. All rights reserved.
 *           (C) 2006 Alexey Proskuryakov (ap@nypop.com)
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
#include "HTMLFieldSetElement.h"

#include "ElementChildIteratorInlines.h"
#include "GenericCachedHTMLCollection.h"
#include "HTMLFormControlsCollection.h"
#include "HTMLLegendElement.h"
#include "HTMLNames.h"
#include "NodeRareData.h"
#include "ScriptDisallowedScope.h"
#include "TypedElementDescendantIteratorInlines.h"
#include <wtf/StdLibExtras.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLFieldSetElement);

using namespace HTMLNames;

inline HTMLFieldSetElement::HTMLFieldSetElement(const QualifiedName& tagName, Document& document)
    : HTMLFormControlElement(tagName, document)
{
    ASSERT(hasTagName(fieldsetTag));
}

HTMLFieldSetElement::~HTMLFieldSetElement()
{
    if (hasDisabledAttribute())
        document().removeDisabledFieldsetElement();
}

Ref<HTMLFieldSetElement> HTMLFieldSetElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLFieldSetElement(tagName, document));
}

bool HTMLFieldSetElement::isDisabledFormControl() const
{
    // The fieldset element itself should never be considered disabled, it is
    // only supposed to affect its descendants:
    // https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#concept-fe-disabled
    return false;
}

// https://html.spec.whatwg.org/#concept-element-disabled
// https://html.spec.whatwg.org/#concept-fieldset-disabled
bool HTMLFieldSetElement::isActuallyDisabled() const
{
    return HTMLFormControlElement::isDisabledFormControl();
}

static void updateFromControlElementsAncestorDisabledStateUnder(HTMLElement& startNode, bool isDisabled)
{
    auto range = inclusiveDescendantsOfType<Element>(startNode);
    auto it = range.begin();

    // This preserves status-quo established before https://github.com/WebKit/WebKit/pull/4988:
    // setDisabledByAncestorFieldset() may modify shadow DOM of <input> / <textarea> elements, but we don't care.
    it.dropAssertions();

    while (it != range.end()) {
        Ref element = *it;
        if (RefPtr listedElement = element->asValidatedFormListedElement())
            listedElement->setDisabledByAncestorFieldset(isDisabled);

        // Don't call setDisabledByAncestorFieldset() on form controls inside disabled fieldsets.
        if (is<HTMLFieldSetElement>(element) && element->hasAttributeWithoutSynchronization(disabledAttr))
            it.traverseNextSkippingChildren();
        else
            it.traverseNext();
    }
}

void HTMLFieldSetElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    bool oldHasDisabledAttribute = hasDisabledAttribute();

    HTMLFormControlElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);

    if (hasDisabledAttribute() != oldHasDisabledAttribute) {
        if (hasDisabledAttribute())
            document().addDisabledFieldsetElement();
        else
            document().removeDisabledFieldsetElement();
    }
}

void HTMLFieldSetElement::disabledStateChanged()
{
    // This element must be updated before the style of nodes in its subtree gets recalculated.
    HTMLFormControlElement::disabledStateChanged();

    if (disabledByAncestorFieldset())
        return;

    bool thisFieldsetIsDisabled = hasAttributeWithoutSynchronization(disabledAttr);
    bool hasSeenFirstLegendElement = false;
    for (RefPtr<HTMLElement> control = Traversal<HTMLElement>::firstChild(*this); control; control = Traversal<HTMLElement>::nextSibling(*control)) {
        if (!hasSeenFirstLegendElement && is<HTMLLegendElement>(*control)) {
            hasSeenFirstLegendElement = true;
            updateFromControlElementsAncestorDisabledStateUnder(*control, false /* isDisabled */);
            continue;
        }
        updateFromControlElementsAncestorDisabledStateUnder(*control, thisFieldsetIsDisabled);
    }
}

void HTMLFieldSetElement::childrenChanged(const ChildChange& change)
{
    HTMLFormControlElement::childrenChanged(change);
    if (!hasAttributeWithoutSynchronization(disabledAttr))
        return;

    RefPtr<HTMLLegendElement> legend = Traversal<HTMLLegendElement>::firstChild(*this);
    if (!legend)
        return;

    // We only care about the first legend element (in which form controls are not disabled by this element) changing here.
    updateFromControlElementsAncestorDisabledStateUnder(*legend, false /* isDisabled */);
    while ((legend = Traversal<HTMLLegendElement>::nextSibling(*legend)))
        updateFromControlElementsAncestorDisabledStateUnder(*legend, true);
}

void HTMLFieldSetElement::didMoveToNewDocument(Document& oldDocument, Document& newDocument)
{
    ASSERT_WITH_SECURITY_IMPLICATION(&document() == &newDocument);
    HTMLFormControlElement::didMoveToNewDocument(oldDocument, newDocument);
    if (hasDisabledAttribute()) {
        oldDocument.removeDisabledFieldsetElement();
        newDocument.addDisabledFieldsetElement();
    }
}

bool HTMLFieldSetElement::matchesValidPseudoClass() const
{
    return m_invalidDescendants.isEmptyIgnoringNullReferences();
}

bool HTMLFieldSetElement::matchesInvalidPseudoClass() const
{
    return !m_invalidDescendants.isEmptyIgnoringNullReferences();
}

bool HTMLFieldSetElement::supportsFocus() const
{
    return HTMLElement::supportsFocus() && !isDisabledFormControl();
}

const AtomString& HTMLFieldSetElement::formControlType() const
{
    return fieldsetTag->localName();
}

HTMLLegendElement* HTMLFieldSetElement::legend() const
{
    // FIXME: Remove suppression once rdar://189998365 is fixed.
    SUPPRESS_MEMORY_UNSAFE_CAST return const_cast<HTMLLegendElement*>(childrenOfType<HTMLLegendElement>(*this).first());
}

Ref<HTMLCollection> HTMLFieldSetElement::elements()
{
    return ensureRareData().ensureNodeLists().addCachedCollection<HTMLFieldSetElementsCollection>(*this);
}

void HTMLFieldSetElement::addInvalidDescendant(const HTMLElement& invalidFormControlElement)
{
    ASSERT_WITH_MESSAGE(!is<HTMLFieldSetElement>(invalidFormControlElement), "FieldSet are never candidates for constraint validation.");
    ASSERT(static_cast<const Element&>(invalidFormControlElement).matchesInvalidPseudoClass());
    ASSERT_WITH_MESSAGE(!m_invalidDescendants.contains(invalidFormControlElement), "Updating the fieldset on validity change is not an efficient operation, it should only be done when necessary.");

    m_invalidDescendants.add(invalidFormControlElement);
}

void HTMLFieldSetElement::removeInvalidDescendant(const HTMLElement& formControlElement)
{
    ASSERT_WITH_MESSAGE(!is<HTMLFieldSetElement>(formControlElement), "FieldSet are never candidates for constraint validation.");
    ASSERT_WITH_MESSAGE(m_invalidDescendants.contains(formControlElement), "Updating the fieldset on validity change is not an efficient operation, it should only be done when necessary.");

    m_invalidDescendants.remove(formControlElement);
}

} // namespace
