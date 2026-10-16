/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Simon Hausmann (hausmann@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2019 Apple Inc. All rights reserved.
 * Copyright (C) 2009 Ericsson AB. All rights reserved.
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
 */

#include "config.h"
#include "HTMLIFrameElement.h"

#include "DOMTokenList.h"
#include "ElementInlines.h"
#include "HTMLNames.h"
#include "ReferrerPolicy.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLIFrameElement);

using namespace HTMLNames;

inline HTMLIFrameElement::HTMLIFrameElement(const QualifiedName& tagName, Document& document)
    : HTMLFrameElementBase(tagName, document)
{
    ASSERT(hasTagName(iframeTag));
}

HTMLIFrameElement::~HTMLIFrameElement() = default;

Ref<HTMLIFrameElement> HTMLIFrameElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLIFrameElement(tagName, document));
}

static bool isSupportedSandboxPolicy(StringView policy)
{
    static constexpr std::array supportedPolicies {
        "allow-top-navigation-to-custom-protocols"_s, "allow-forms"_s, "allow-same-origin"_s, "allow-scripts"_s,
        "allow-top-navigation"_s, "allow-pointer-lock"_s, "allow-popups"_s, "allow-popups-to-escape-sandbox"_s,
        "allow-top-navigation-by-user-activation"_s, "allow-modals"_s, "allow-storage-access-by-user-activation"_s,
        "allow-downloads"_s
    };

    for (auto supportedPolicy : supportedPolicies) {
        if (equalIgnoringASCIICase(policy, supportedPolicy))
            return true;
    }
    return false;
}

DOMTokenList& HTMLIFrameElement::sandbox()
{
    if (!m_sandbox) {
        lazyInitialize(m_sandbox, makeUniqueWithoutRefCountedCheck<DOMTokenList>(*this, sandboxAttr, [](Document&, StringView token) {
            return isSupportedSandboxPolicy(token);
        }));
    }
    return *m_sandbox;
}

void HTMLIFrameElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    if (name == sandboxAttr) {
        if (m_sandbox)
            m_sandbox->associatedAttributeValueChanged();
    } else
        HTMLFrameElementBase::attributeChanged(name, oldValue, newValue, attributeModificationReason);
}

String HTMLIFrameElement::referrerPolicyForBindings() const
{
    return referrerPolicyToString(referrerPolicy());
}

ReferrerPolicy HTMLIFrameElement::referrerPolicy() const
{
    return parseReferrerPolicy(attributeWithoutSynchronization(referrerpolicyAttr), ReferrerPolicySource::ReferrerPolicyAttribute).value_or(ReferrerPolicy::EmptyString);
}

}
