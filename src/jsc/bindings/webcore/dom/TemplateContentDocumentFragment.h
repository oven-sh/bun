/*
 * Copyright (C) 2012, 2013 Google Inc. All rights reserved.
 * Copyright (C) 2018 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
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

#include "DocumentFragment.h"

namespace WebCore {

class HTMLTemplateElement;

class TemplateContentDocumentFragment final : public DocumentFragment {
    WTF_MAKE_TZONE_ALLOCATED(TemplateContentDocumentFragment);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(TemplateContentDocumentFragment);
public:
    static Ref<TemplateContentDocumentFragment> create(Document& document, const HTMLTemplateElement& host)
    {
        return adoptRef(*new TemplateContentDocumentFragment(document, host));
    }

    const HTMLTemplateElement* LEGACY_NODELETE host() const;
    void clearHost();

private:
    TemplateContentDocumentFragment(Document&, const HTMLTemplateElement&);

    bool isTemplateContent() const final { return true; }

    WeakPtr<const HTMLTemplateElement, WeakPtrImplWithEventTargetData> m_host;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::TemplateContentDocumentFragment)
    static bool isType(const WebCore::Node& node)
    {
        auto* fragment = dynamicDowncast<WebCore::DocumentFragment>(node);
        return fragment && is<WebCore::TemplateContentDocumentFragment>(*fragment);
    }
    static bool isType(const WebCore::DocumentFragment& node) { return node.isTemplateContent(); }
SPECIALIZE_TYPE_TRAITS_END()
