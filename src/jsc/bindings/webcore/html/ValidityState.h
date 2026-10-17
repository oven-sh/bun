/*
 * This file is part of the WebKit project.
 *
 * Copyright (C) 2013-2022 Apple Inc. All rights reserved.
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

#include "FormListedElement.h"
#include "HTMLElement.h"
#include "ScriptWrappable.h"
#include <wtf/TZoneMalloc.h>

namespace WebCore {

// The element owns its ValidityState, which keeps the element alive in turn.
class ValidityState final : public ScriptWrappable {
    WTF_MAKE_TZONE_ALLOCATED(ValidityState);
public:
    explicit ValidityState(FormListedElement& element)
        : m_element(element)
    {
    }

    void ref() const { m_element.ref(); }
    void deref() const { m_element.deref(); }

    Element* element() { return &m_element.asHTMLElement(); }
    Node* opaqueRootConcurrently() { return &m_element.asHTMLElement(); }

    bool valueMissing() const { return m_element.valueMissing(); }
    bool typeMismatch() const { return m_element.typeMismatch(); }
    bool patternMismatch() const { return m_element.patternMismatch(); }
    bool tooShort() const { return m_element.tooShort(); }
    bool tooLong() const { return m_element.tooLong(); }
    bool rangeUnderflow() const { return m_element.rangeUnderflow(); }
    bool rangeOverflow() const { return m_element.rangeOverflow(); }
    bool stepMismatch() const { return m_element.stepMismatch(); }
    bool badInput() const { return m_element.badInput(); }
    bool customError() const { return m_element.customError(); }
    bool computeValidity() const { return m_element.computeValidity(); }

private:
    FormListedElement& m_element;
};

} // namespace WebCore
