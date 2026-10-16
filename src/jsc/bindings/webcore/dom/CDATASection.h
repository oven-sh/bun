/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003-2018 Apple Inc. All rights reserved.
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

#include "Text.h"

namespace WebCore {

class CDATASection final : public Text {
    WTF_MAKE_TZONE_ALLOCATED(CDATASection);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(CDATASection);
public:
    static Ref<CDATASection> create(Document&, String&&);

private:
    CDATASection(Document&, String&&);

    String nodeName() const override;
    Ref<Node> cloneNodeInternal(Document&, CloningOperation, CustomElementRegistry*) const override;
    Ref<Text> virtualCreate(String&&) override;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::CDATASection)
    static bool isType(const WebCore::Node& node) { return node.nodeType() == WebCore::NodeType::CDATASection; }
SPECIALIZE_TYPE_TRAITS_END()
