/*
 * Copyright (c) 2012, 2013 Google Inc. All rights reserved.
 * Copyright (C) 2013-2026 Apple Inc. All rights reserved.
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

#pragma once

#include "HTMLElement.h"

namespace WebCore {

class DocumentFragment;
class TemplateContentDocumentFragment;

class HTMLTemplateElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLTemplateElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLTemplateElement);
public:
    static Ref<HTMLTemplateElement> create(const QualifiedName&, Document&);
    virtual ~HTMLTemplateElement();

    DocumentFragment& fragmentForInsertion() const;
    DocumentFragment& content() const;
    DocumentFragment* LEGACY_NODELETE contentIfAvailable() const;

    const AtomString& shadowRootMode() const;
    const AtomString& shadowRootSlotAssignment() const;

    void setDeclarativeShadowRoot(ShadowRoot&);

private:
    HTMLTemplateElement(const QualifiedName&, Document&);

    Ref<Node> cloneNodeInternal(Document&, CloningOperation, CustomElementRegistry*) const final;
    void didMoveToNewDocument(Document& oldDocument, Document& newDocument) final;

    const RefPtr<TemplateContentDocumentFragment> m_content;
    WeakPtr<ShadowRoot, WeakPtrImplWithEventTargetData> m_declarativeShadowRoot;
};

} // namespace WebCore
