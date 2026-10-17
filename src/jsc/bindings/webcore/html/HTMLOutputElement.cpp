/*
 * Copyright (c) 2010 Google Inc. All rights reserved.
 * Copyright (c) 2021 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "HTMLOutputElement.h"

#include "DOMTokenList.h"
#include "Document.h"
#include "ElementInlines.h"
#include "HTMLFormElement.h"
#include "HTMLNames.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLOutputElement);

inline HTMLOutputElement::HTMLOutputElement(const QualifiedName& tagName, Document& document)
    : HTMLFormControlElement(tagName, document)
{
}

HTMLOutputElement::~HTMLOutputElement() = default;

Ref<HTMLOutputElement> HTMLOutputElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLOutputElement(tagName, document));
}

Ref<HTMLOutputElement> HTMLOutputElement::create(Document& document)
{
    return create(HTMLNames::outputTag, document);
}

const AtomString& HTMLOutputElement::formControlType() const
{
    return HTMLNames::outputTag->localName();
}

bool HTMLOutputElement::supportsFocus() const
{
    return HTMLElement::supportsFocus();
}

void HTMLOutputElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    if (name == HTMLNames::forAttr && m_forTokens)
        m_forTokens->associatedAttributeValueChanged();
    HTMLFormControlElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
}

void HTMLOutputElement::reset()
{
    setInteractedWithSinceLastFormSubmitEvent(false);
    stringReplaceAll(defaultValue());
    m_defaultValueOverride = { };
}

String HTMLOutputElement::value() const
{
    return textContent();
}

void HTMLOutputElement::setValue(String&& value)
{
    m_defaultValueOverride = defaultValue();
    stringReplaceAll(WTF::move(value));
}

String HTMLOutputElement::defaultValue() const
{
    return m_defaultValueOverride.isNull() ? textContent() : m_defaultValueOverride;
}

void HTMLOutputElement::setDefaultValue(String&& value)
{
    if (m_defaultValueOverride.isNull())
        stringReplaceAll(WTF::move(value));
    else
        m_defaultValueOverride = WTF::move(value);
}

DOMTokenList& HTMLOutputElement::htmlFor()
{
    if (!m_forTokens)
        lazyInitialize(m_forTokens, makeUniqueWithoutRefCountedCheck<DOMTokenList>(*this, HTMLNames::forAttr));
    return *m_forTokens;
}

} // namespace
