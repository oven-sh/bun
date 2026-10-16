/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
 * Copyright (C) 2015-2025 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
 * ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "Element.h"
#include "ScriptWrappable.h"
#include <wtf/FixedVector.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore {

class DOMTokenList final : public ScriptWrappable {
    WTF_MAKE_TZONE_ALLOCATED(DOMTokenList);
public:
    using IsSupportedTokenFunction = Function<bool(Document&, StringView)>;
    DOMTokenList(Element&, const QualifiedName& attributeName, IsSupportedTokenFunction&& isSupportedToken = { });

    inline void associatedAttributeValueChanged();

    void ref() { m_element->ref(); }
    void deref() { m_element->deref(); }

    unsigned length() const;
    bool isSupportedPropertyIndex(unsigned index) const { return index < length(); }
    const AtomString& item(unsigned index) const;

    WEBCORE_EXPORT bool contains(const AtomString&) const;
    ExceptionOr<void> add(const FixedVector<AtomString>&);
    ExceptionOr<void> add(const AtomString&);
    ExceptionOr<void> remove(const FixedVector<AtomString>&);
    ExceptionOr<void> remove(const AtomString&);
    WEBCORE_EXPORT ExceptionOr<bool> toggle(const AtomString&, std::optional<bool> force);
    ExceptionOr<bool> replace(const AtomString& token, const AtomString& newToken);
    ExceptionOr<bool> supports(StringView token);

    Element& element() const { return m_element.get(); }

    WEBCORE_EXPORT void setValue(const AtomString&);
    WEBCORE_EXPORT const AtomString& value() const;

private:
    void updateTokensFromAttributeValue(const AtomString&);
    void updateAssociatedAttributeFromTokens();

    WEBCORE_EXPORT Vector<AtomString, 1>& tokens() LIFETIME_BOUND;
    // FIXME: Remove suppression once rdar://189998365 is fixed.
    const Vector<AtomString, 1>& tokens() const LIFETIME_BOUND { SUPPRESS_MEMORY_UNSAFE_CAST return const_cast<DOMTokenList&>(*this).tokens(); }

    static ExceptionOr<void> validateToken(StringView);
    static ExceptionOr<void> validateTokens(std::span<const AtomString> tokens);
    ExceptionOr<void> addInternal(std::span<const AtomString> tokens);
    ExceptionOr<void> removeInternal(std::span<const AtomString> tokens);

    const CheckedRef<Element> m_element;
    const WebCore::QualifiedName& m_attributeName;
    bool m_inUpdateAssociatedAttributeFromTokens { false };
    bool m_tokensNeedUpdating { true };
    Vector<AtomString, 1> m_tokens;
    IsSupportedTokenFunction m_isSupportedToken;
};

inline unsigned DOMTokenList::length() const
{
    return tokens().size();
}

inline const AtomString& DOMTokenList::item(unsigned index) const
{
    auto& tokens = this->tokens();
    return index < tokens.size() ? tokens[index] : nullAtom();
}

inline void DOMTokenList::associatedAttributeValueChanged()
{
    // Do not reset the DOMTokenList value if the attribute value was changed by us.
    if (m_inUpdateAssociatedAttributeFromTokens)
        return;
    m_tokensNeedUpdating = true;
}

} // namespace WebCore
