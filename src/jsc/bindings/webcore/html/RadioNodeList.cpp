/*
 * Copyright (c) 2012 Motorola Mobility, Inc. All rights reserved.
 * Copyright (C) 2014-2020 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY MOTOROLA MOBILITY, INC. AND ITS CONTRIBUTORS
 * ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL MOTOROLA MOBILITY, INC. OR ITS
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
 * OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 * WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "RadioNodeList.h"

#include "HTMLFormElement.h"
#include "HTMLInputElement.h"
#include "LiveNodeListInlines.h"
#include "NodeRareData.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

using namespace HTMLNames;

WTF_MAKE_TZONE_ALLOCATED_IMPL(RadioNodeList);

RadioNodeList::RadioNodeList(ContainerNode& rootNode, const AtomString& name)
    : CachedLiveNodeList(rootNode, LiveNodeListType::RadioNodeList, NodeListInvalidationType::InvalidateForFormControls)
    , m_name(name)
    , m_isRootedAtTreeScope(is<HTMLFormElement>(rootNode))
{
}

Ref<RadioNodeList> RadioNodeList::create(ContainerNode& rootNode, const AtomString& name)
{
    return adoptRef(*new RadioNodeList(rootNode, name));
}

RadioNodeList::~RadioNodeList()
{
    ownerNode().nodeLists()->removeCacheWithAtomName(*this, m_name);
}

static RefPtr<HTMLInputElement> nonEmptyRadioButton(Node& node)
{
    auto* inputElement = dynamicDowncast<HTMLInputElement>(node);
    if (!inputElement)
        return nullptr;

    if (!inputElement->isRadioButton() || inputElement->value()->isEmpty())
        return nullptr;
    return inputElement;
}

String RadioNodeList::value() const
{
    auto length = this->length();
    for (unsigned i = 0; i < length; ++i) {
        Ref node = *item(i);
        if (RefPtr button = nonEmptyRadioButton(node)) {
            if (button->checked())
                return button->value();
        }
    }
    return String();
}

void RadioNodeList::setValue(const String& value)
{
    auto length = this->length();
    for (unsigned i = 0; i < length; ++i) {
        Ref node = *item(i);
        if (RefPtr button = nonEmptyRadioButton(node)) {
            if (button->value() == value) {
                button->setChecked(true);
                return;
            }
        }
    }
}

bool RadioNodeList::elementMatches(Element& element) const
{
    if (!element.isFormListedElement())
        return false;

    if (auto* input = dynamicDowncast<HTMLInputElement>(element); input && input->isImageButton())
        return false;

    if (is<HTMLFormElement>(ownerNode())) {
        auto* form = element.asFormListedElement()->form();
        if (form != &ownerNode())
            return false;
    }

    return element.getIdAttribute() == m_name || element.getNameAttribute() == m_name;
}

} // namespace WebCore
