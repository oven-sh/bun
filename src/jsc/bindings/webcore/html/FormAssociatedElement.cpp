/*
 * Copyright (C) 2023 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "FormAssociatedElement.h"

#include "ElementInlines.h"

namespace WebCore {

RefPtr<HTMLFormElement> FormAssociatedElement::formForBindings() const
{
    // FIXME: The downcast should be unnecessary, but the WPT was written before https://github.com/WICG/webcomponents/issues/1072 was resolved. Update once the WPT has been updated.
    return dynamicDowncast<HTMLFormElement>(protect(asHTMLElement())->retargetReferenceTargetForBindings(form()));
}

void FormAssociatedElement::setFormInternal(RefPtr<HTMLFormElement>&& newForm)
{
    ASSERT(m_form.get() != newForm);
    m_form = WTF::move(newForm);
}

void FormAssociatedElement::elementInsertedIntoAncestor(Element& element, Node::InsertionType)
{
    ASSERT(&asHTMLElement() == &element);
    if (m_formSetByParser) {
        // The form could have been removed by a script during parsing.
        if (m_formSetByParser->isConnected())
            setForm(m_formSetByParser.get());
        m_formSetByParser = nullptr;
    }

    if (m_form && element.rootElement() != m_form->rootElement())
        setForm(nullptr);
}

void FormAssociatedElement::elementRemovedFromAncestor(Element& element, Node::RemovalType)
{
    ASSERT(&asHTMLElement() == &element);
    // Do not rely on rootNode() because m_form's IsInTreeScope can be outdated.
    if (m_form && &element.traverseToRootNode() != &m_form->traverseToRootNode()) {
        setForm(nullptr);
        resetFormOwner();
    }
}

}
