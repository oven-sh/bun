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
 */

#pragma once

#include "CharacterData.h"

namespace WebCore {

class Text : public CharacterData {
    WTF_MAKE_TZONE_ALLOCATED(Text);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(Text);
public:
    static const unsigned defaultLengthLimit = 1 << 16;

    static Ref<Text> create(Document& document, String&& data)
    {
        return adoptRef(*new Text(document, WTF::move(data), NodeType::Text, { }));
    }

    virtual ~Text();

    WEBCORE_EXPORT ExceptionOr<Ref<Text>> splitText(unsigned offset);

    // DOM Level 3: http://www.w3.org/TR/DOM-Level-3-Core/core.html#ID-1312295772

    WEBCORE_EXPORT String wholeText() const;
    WEBCORE_EXPORT void replaceWholeText(const String&);

    bool canContainRangeEndPoint() const final { return true; }

    String description() const final;
    String debugDescription() const final;

protected:
    Text(Document& document, String&& data, NodeType type, OptionSet<TypeFlag> typeFlags)
        : CharacterData(document, WTF::move(data), type, typeFlags | TypeFlag::IsText)
    {
        ASSERT(!isContainerNode());
    }

private:
    String nodeName() const override;
    Ref<Node> cloneNodeInternal(Document&, CloningOperation, CustomElementRegistry*) const override;

    virtual Ref<Text> virtualCreate(String&&);
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::Text)
    static bool isType(const WebCore::Node& node) { return node.isTextNode(); }
SPECIALIZE_TYPE_TRAITS_END()
