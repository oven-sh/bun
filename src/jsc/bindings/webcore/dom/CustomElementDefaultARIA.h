/*
 * Copyright (C) 2022 Apple Inc. All rights reserved.
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

#pragma once

#include "QualifiedName.h"
#include <wtf/CheckedRef.h>
#include <wtf/HashMap.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/Vector.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/AtomString.h>

namespace WebCore {

class Element;
class WeakPtrImplWithEventTargetData;

class CustomElementDefaultARIA final : public CanMakeCheckedPtr<CustomElementDefaultARIA> {
    WTF_MAKE_TZONE_ALLOCATED(CustomElementDefaultARIA);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(CustomElementDefaultARIA);
public:
    CustomElementDefaultARIA();
    ~CustomElementDefaultARIA();

    bool hasAttribute(const QualifiedName&) const;
    const AtomString& valueForAttribute(const Element& thisElement, const QualifiedName&) const;
    void setValueForAttribute(const QualifiedName&, const AtomString&);
    RefPtr<Element> elementForAttribute(const Element& thisElement, const QualifiedName&) const;
    void setElementForAttribute(const QualifiedName&, Element*);
    std::optional<Vector<Ref<Element>>> elementsForAttribute(const Element& thisElement, const QualifiedName&) const;
    void setElementsForAttribute(const QualifiedName&, std::optional<Vector<Ref<Element>>>&&);

private:
    using WeakElementPtr = WeakPtr<Element, WeakPtrImplWithEventTargetData>;
    HashMap<QualifiedName, Variant<AtomString, WeakElementPtr, Vector<WeakElementPtr>>> m_map;
};

}; // namespace WebCore
