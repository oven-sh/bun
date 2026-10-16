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

#include "config.h"
#include "CDATASection.h"

#include "Document.h"
#include "NodeDocument.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CDATASection);

inline CDATASection::CDATASection(Document& document, String&& data)
    : Text(document, WTF::move(data), NodeType::CDATASection, { })
{
}

Ref<CDATASection> CDATASection::create(Document& document, String&& data)
{
    return adoptRef(*new CDATASection(document, WTF::move(data)));
}

String CDATASection::nodeName() const
{
    return "#cdata-section"_s;
}

Ref<Node> CDATASection::cloneNodeInternal(Document& document, CloningOperation, CustomElementRegistry*) const
{
    return create(document, String { data() });
}

Ref<Text> CDATASection::virtualCreate(String&& data)
{
    return create(protect(document()), WTF::move(data));
}

} // namespace WebCore
