/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2024 Apple Inc. All rights reserved.
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
#include "FormListedElement.h"

#include "ElementAncestorIteratorInlines.h"
#include "ElementInlines.h"
#include "HTMLFormControlElement.h"
#include "HTMLFormElement.h"
#include "HTMLNames.h"
#include "IdTargetObserver.h"
#include "TreeScopeInlines.h"
#include "ValidityState.h"
#include <wtf/TZoneMallocInlines.h>
#include <wtf/WeakRef.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(FormListedElement);
WTF_MAKE_TZONE_ALLOCATED_IMPL(ValidityState);

using namespace HTMLNames;

class FormAttributeTargetObserver final : private IdTargetObserver {
    WTF_MAKE_TZONE_ALLOCATED(FormAttributeTargetObserver);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(FormAttributeTargetObserver);
public:
    FormAttributeTargetObserver(const AtomString& id, FormListedElement&);

private:
    void idTargetChanged(Element&) override;

    WeakRef<FormListedElement> m_element;
};

WTF_MAKE_TZONE_ALLOCATED_IMPL(FormAttributeTargetObserver);

FormListedElement::FormListedElement() = default;

FormListedElement::~FormListedElement() = default;

ValidityState& FormListedElement::validity()
{
    if (!m_validity)
        lazyInitialize(m_validity, makeUniqueWithoutRefCountedCheck<ValidityState>(*this));
    return *m_validity;
}

void FormListedElement::didMoveToNewDocument()
{
    Ref element = asHTMLElement();
    if (element->hasAttributeWithoutSynchronization(formAttr) && element->isConnected())
        resetFormAttributeTargetObserver();
}

void FormListedElement::elementInsertedIntoAncestor(Element& element, Node::InsertionType insertionType)
{
    FormAssociatedElement::elementInsertedIntoAncestor(element, insertionType);

    if (!insertionType.connectedToDocument)
        return;

    if (element.hasAttributeWithoutSynchronization(formAttr))
        resetFormAttributeTargetObserver();
}

void FormListedElement::elementRemovedFromAncestor(Element& element, Node::RemovalType removalType)
{
    ASSERT(&asHTMLElement() == &element);
    m_formAttributeTargetObserver = nullptr;

    FormAssociatedElement::elementRemovedFromAncestor(element, removalType);

    if (removalType.disconnectedFromDocument && element.hasAttributeWithoutSynchronization(formAttr)) {
        setForm(nullptr);
        resetFormOwner();
    }
}

static RefPtr<HTMLFormElement> findAssociatedForm(const HTMLElement& element, HTMLFormElement* currentAssociatedForm)
{
    if (element.isConnected()) {
        if (auto& formId = element.attributeWithoutSynchronization(formAttr); !formId.isNull()) {
            // The HTML5 spec says that the element should be associated with
            // the first element in the document to have an ID that equal to
            // the value of form attribute, so we put the result of
            // treeScope().getElementById() over the given element.
            RefPtr newFormCandidate = dynamicDowncast<HTMLFormElement>(element.elementForAttributeInternal(formAttr));
            if (!newFormCandidate)
                return nullptr;
            if (&element.traverseToRootNode() == &element.treeScope().rootNode()) {
                ASSERT(&element.traverseToRootNode() == &newFormCandidate->traverseToRootNode());
                return newFormCandidate;
            }
        }
    }
    return currentAssociatedForm ? currentAssociatedForm : HTMLFormElement::findClosestFormAncestor(element);
}

void FormListedElement::formOwnerRemovedFromTree(const Node& formRoot)
{
    ASSERT(form());
    // Can't use RefPtr here beacuse this function might be called inside ~ShadowRoot via addChildNodesToDeletionQueue. See webkit.org/b/189493.
    auto formHasSameRootNode = [&](Node* rootNode) -> std::optional<bool> {
        if (auto* currentForm = form()) {
            for (auto* ancestor = rootNode->parentNode(); ancestor; ancestor = ancestor->parentNode()) {
                if (ancestor == currentForm)
                    return std::nullopt;
                rootNode = ancestor;
            }
        }
        return rootNode == &formRoot;
    }(&asHTMLElement());

    if (!formHasSameRootNode) {
        // Form is our ancestor so we don't need to reset our owner, we also no longer
        // need an id observer since we are no longer connected.
        m_formAttributeTargetObserver = nullptr;
        return;
    }

    // We are no longer in the same tree as our form owner so clear our owner.
    if (!*formHasSameRootNode)
        setForm(nullptr);
}

void FormListedElement::setFormInternal(RefPtr<HTMLFormElement>&& newForm)
{
    willChangeForm();
    if (RefPtr oldForm = form())
        oldForm->unregisterFormListedElement(*this);
    FormAssociatedElement::setFormInternal(newForm.copyRef());
    if (newForm)
        newForm->registerFormListedElement(*this);
    didChangeForm();
}

void FormListedElement::willChangeForm()
{
}

void FormListedElement::didChangeForm()
{
}

void FormListedElement::formWillBeDestroyed()
{
    ASSERT(form());
    if (!form())
        return;
    willChangeForm();
    FormAssociatedElement::formWillBeDestroyed();
    didChangeForm();
}

void FormListedElement::resetFormOwner()
{
    RefPtr originalForm = form();
    Ref element = asHTMLElement();
    setForm(findAssociatedForm(element.get(), originalForm.get()));
}

void FormListedElement::parseAttribute(const QualifiedName& name, const AtomString& value)
{
    if (name == formAttr)
        parseFormAttribute(value);
}

void FormListedElement::parseFormAttribute(const AtomString& value)
{
    Ref element = asHTMLElement();
    if (value.isNull()) {
        // The form attribute removed. We need to reset form owner here.
        // Instead of calling setForm(findAssociatedForm(&element, originalForm.get())) here,
        // we effectively perform setForm(findAssociatedForm(&element, nullptr)) because
        // it's known that originalForm is obsolete and can't be used as a fallback.
        setForm(HTMLFormElement::findClosestFormAncestor(element.get()));
        m_formAttributeTargetObserver = nullptr;
    } else {
        resetFormOwner();
        if (element->isConnected())
            resetFormAttributeTargetObserver();
    }
}

bool FormListedElement::customError() const
{
    return !m_customValidationMessage.isEmpty();
}

bool FormListedElement::hasBadInput() const
{
    return false;
}

bool FormListedElement::patternMismatch() const
{
    return false;
}

bool FormListedElement::rangeOverflow() const
{
    return false;
}

bool FormListedElement::rangeUnderflow() const
{
    return false;
}

bool FormListedElement::stepMismatch() const
{
    return false;
}

bool FormListedElement::tooShort() const
{
    return false;
}

bool FormListedElement::tooLong() const
{
    return false;
}

bool FormListedElement::typeMismatch() const
{
    return false;
}

bool FormListedElement::computeValidity() const
{
    bool someError = typeMismatch() || stepMismatch() || rangeUnderflow() || rangeOverflow()
        || tooShort() || tooLong() || patternMismatch() || valueMissing() || hasBadInput() || customError();
    return !someError;
}

bool FormListedElement::valueMissing() const
{
    return false;
}

String FormListedElement::customValidationMessage() const
{
    return m_customValidationMessage;
}

String FormListedElement::validationMessage() const
{
    return willValidate() ? m_customValidationMessage : String();
}

void FormListedElement::setCustomValidity(const String& error)
{
    m_customValidationMessage = makeStringBySimplifyingNewLines(error);
}

void FormListedElement::resetFormAttributeTargetObserver()
{
    ASSERT_WITH_SECURITY_IMPLICATION(asHTMLElement().isConnected());
    m_formAttributeTargetObserver = makeUnique<FormAttributeTargetObserver>(asHTMLElement().attributeWithoutSynchronization(formAttr), *this);
}

void FormListedElement::formAttributeTargetChanged()
{
    resetFormOwner();
}

const AtomString& FormListedElement::name() const
{
    const AtomString& name = asHTMLElement().getNameAttribute();
    return name.isNull() ? emptyAtom() : name;
}

FormAttributeTargetObserver::FormAttributeTargetObserver(const AtomString& id, FormListedElement& element)
    : IdTargetObserver(protect(element.asHTMLElement().treeScope())->idTargetObserverRegistry(), id)
    , m_element(element)
{
}

void FormAttributeTargetObserver::idTargetChanged(Element&)
{
    Ref { m_element.get() }->formAttributeTargetChanged();
}

} // namespace WebCore
