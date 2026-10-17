/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003-2017 Inc. All rights reserved.
 * Copyright (C) 2008 Nikolas Zimmermann <zimmermann@kde.org>
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

#include "DOMTokenList.h"
#include "HTMLElement.h"
#include "ScriptElement.h"

namespace WebCore {


enum class ReferrerPolicy : uint8_t;
enum class RequestPriority : uint8_t;

class HTMLScriptElement final : public HTMLElement, public ScriptElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLScriptElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLScriptElement);
public:
    static Ref<HTMLScriptElement> create(const QualifiedName&, Document&, bool wasInsertedByParser, bool alreadyStarted = false);

    String text() const { return scriptContent(); }
    WEBCORE_EXPORT void setText(String&&);

    String src() const;
    void setSrc(String&&);

    WEBCORE_EXPORT void setAsync(bool);
    WEBCORE_EXPORT bool LEGACY_NODELETE async() const;

    WEBCORE_EXPORT String crossOrigin() const;

    String referrerPolicyForBindings() const;
    ReferrerPolicy referrerPolicy() const;

    // ScriptElement
    void ref() const final { HTMLElement::ref(); }
    void deref() const final { HTMLElement::deref(); }

    static bool supports(StringView type) { return type == "classic"_s || type == "module"_s || type == "importmap"_s || type == "speculationrules"_s; }

    String fetchPriorityForBindings() const;
    RequestPriority fetchPriority() const;

    WEBCORE_EXPORT DOMTokenList& blocking();

private:
    HTMLScriptElement(const QualifiedName&, Document&, bool wasInsertedByParser, bool alreadyStarted);

    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) final;
    NeedsPostConnectionSteps insertionSteps(InsertionType, ContainerNode&) final;
    void postConnectionSteps() final;
    void childrenChanged(const ChildChange&) final;


    bool LEGACY_NODELETE isURLAttribute(const Attribute&) const final;

    String typeAttributeValue() const final;
    String languageAttributeValue() const final;
    bool hasAsyncAttribute() const final;
    bool hasSourceAttribute() const final;

    Ref<Element> cloneElementWithoutAttributesAndChildren(Document&, CustomElementRegistry*) const final;

    const std::unique_ptr<DOMTokenList> m_blockingList;
};

} //namespace
