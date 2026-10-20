/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2004-2023 Apple Inc. All rights reserved.
 * Copyright (C) 2010-2015 Google Inc. All rights reserved.
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
#include "HTMLElement.h"

namespace WebCore {

class DeferredPromise;
class HTMLFormElement;

enum class ReferrerPolicy : uint8_t;
enum class RequestPriority : uint8_t;

class HTMLImageElement
    : public HTMLElement
    , public FormAssociatedElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLImageElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLImageElement);
public:
    static Ref<HTMLImageElement> create(Document&);
    static Ref<HTMLImageElement> create(const QualifiedName&, Document&);
    static Ref<HTMLImageElement> createForLegacyFactoryFunction(Document&, std::optional<unsigned> width, std::optional<unsigned> height);

    virtual ~HTMLImageElement();

    using HTMLElement::ref;
    using HTMLElement::deref;

    void formOwnerRemovedFromTree(const Node& formRoot);

    WEBCORE_EXPORT unsigned width();
    WEBCORE_EXPORT unsigned height();

    unsigned naturalWidth() const { return 0; }
    unsigned naturalHeight() const { return 0; }

    const AtomString& currentSrc() const { return emptyAtom(); }

    WEBCORE_EXPORT String crossOrigin() const;
    int x() const { return 0; }
    int y() const { return 0; }
    WEBCORE_EXPORT bool LEGACY_NODELETE complete() const;
    String decoding() const;

    WEBCORE_EXPORT void decode(Ref<DeferredPromise>&&);

    AtomString srcsetForBindings() const;

    enum LoadingValues { Lazy, Eager };

    String referrerPolicyForBindings() const;
    ReferrerPolicy referrerPolicy() const;

    String fetchPriorityForBindings() const;
    RequestPriority fetchPriority() const;

protected:
    HTMLImageElement(const QualifiedName&, Document&);

private:
    void resetFormOwner() final;
    void refFormAssociatedElement() const final { HTMLElement::ref(); }
    void derefFormAssociatedElement() const final { HTMLElement::deref(); }
    void setFormInternal(RefPtr<HTMLFormElement>&&) final;

    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) final;

    bool isReplaced() const final { return true; }

    bool LEGACY_NODELETE isURLAttribute(const Attribute&) const override;

    bool isDraggableIgnoringAttributes() const final { return true; }

    NeedsPostConnectionSteps insertionSteps(InsertionType, ContainerNode&) override;
    void removingSteps(RemovalType, ContainerNode&) override;

    bool LEGACY_NODELETE isFormListedElement() const final { return false; }
    FormAssociatedElement* LEGACY_NODELETE asFormAssociatedElement() final { return this; }
    HTMLImageElement& asHTMLElement() final { return *this; }
    const HTMLImageElement& asHTMLElement() const final { return *this; }

    bool isInteractiveContent() const final;

    bool m_hadNameBeforeAttributeChanged { false }; // FIXME: We only need this because parseAttribute() can't see the old value.
};

} //namespace
