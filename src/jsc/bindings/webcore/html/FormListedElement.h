/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004, 2005, 2006, 2007, 2008, 2009, 2010 Apple Inc. All rights reserved.
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

#include "FormAssociatedElement.h"
#include "Node.h"
#include <wtf/CanMakeWeakPtr.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class ContainerNode;
class DOMFormData;
class Document;
class FormAttributeTargetObserver;
class HTMLElement;
class HTMLFormElement;
class ValidityState;

// https://html.spec.whatwg.org/multipage/forms.html#category-listed
class FormListedElement : public FormAssociatedElement, public CanMakeWeakPtr<FormListedElement> {
    WTF_MAKE_TZONE_ALLOCATED(FormListedElement);
    WTF_MAKE_NONCOPYABLE(FormListedElement);
public:
    virtual ~FormListedElement();

    ValidityState& validity();

    virtual bool LEGACY_NODELETE isValidatedFormListedElement() const = 0;
    virtual bool LEGACY_NODELETE isEnumeratable() const = 0;

    // Returns the 'name' attribute value. If this element has no name
    // attribute, it returns an empty string instead of null string.
    // Note that the 'name' IDL attribute doesn't use this function.
    virtual const AtomString& name() const;

    // Override in derived classes to get the encoded name=value pair for submitting.
    // Return true for a successful control (see HTML4-17.13.2).
    virtual bool appendFormData(DOMFormData&) { return false; }

    void formWillBeDestroyed() override;

    void resetFormOwner() final;

    void formOwnerRemovedFromTree(const Node&);

    // ValidityState attribute implementations
    bool badInput() const { return hasBadInput(); }
    virtual bool LEGACY_NODELETE customError() const;

    // Implementations of patternMismatch, rangeOverflow, rangerUnderflow, stepMismatch, tooShort, tooLong and valueMissing must call willValidate.
    virtual bool hasBadInput() const;
    virtual bool patternMismatch() const;
    virtual bool rangeOverflow() const;
    virtual bool rangeUnderflow() const;
    virtual bool stepMismatch() const;
    virtual bool tooShort() const;
    virtual bool tooLong() const;
    virtual bool typeMismatch() const;
    virtual bool valueMissing() const;
    virtual String validationMessage() const;
    virtual bool computeValidity() const;
    virtual void setCustomValidity(const String&);

    void formAttributeTargetChanged();

    virtual FormListedElement* asFormListedElement() = 0;
    virtual ValidatedFormListedElement* asValidatedFormListedElement() = 0;

protected:
    FormListedElement();

    void clearForm() { setForm(nullptr); }

    void didMoveToNewDocument();
    void elementInsertedIntoAncestor(Element&, Node::InsertionType) override;
    void elementRemovedFromAncestor(Element&, Node::RemovalType) override;
    void parseAttribute(const QualifiedName&, const AtomString&);
    void parseFormAttribute(const AtomString&);

    // If you add an override of willChangeForm() or didChangeForm() to a class
    // derived from this one, you will need to add a call to setForm(0) to the
    // destructor of that class.
    virtual void willChangeForm();
    virtual void didChangeForm();

    String LEGACY_NODELETE customValidationMessage() const;

private:
    void setFormInternal(RefPtr<HTMLFormElement>&&) final;
    // "willValidate" means "is a candidate for constraint validation".
    virtual bool willValidate() const = 0;

    void resetFormAttributeTargetObserver();

    std::unique_ptr<FormAttributeTargetObserver> m_formAttributeTargetObserver;
    const std::unique_ptr<ValidityState> m_validity;
    String m_customValidationMessage;
};

} // namespace
