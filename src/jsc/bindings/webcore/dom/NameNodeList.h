/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2020 Apple Inc. All rights reserved.
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

#include "LiveNodeList.h"
#include <wtf/text/AtomString.h>

namespace WebCore {

class NameNodeList final : public CachedLiveNodeList<NameNodeList> {
    WTF_MAKE_TZONE_ALLOCATED(NameNodeList);
public:
    static Ref<NameNodeList> create(ContainerNode& rootNode, const AtomString& name);
    virtual ~NameNodeList();

    bool elementMatches(Element&) const final;
    bool isRootedAtTreeScope() const final { return false; }

private:
    NameNodeList(ContainerNode& rootNode, const AtomString& name);

    AtomString m_name;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_LIVENODELIST(NameNodeList)
