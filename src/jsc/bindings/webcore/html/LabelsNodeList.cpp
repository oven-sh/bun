/**
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2010 Nokia Inc. All rights reserved.
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
#include "LabelsNodeList.h"

#include "CommonAtomStrings.h"
#include "HTMLLabelElement.h"
#include "HTMLNames.h"
#include "LiveNodeListInlines.h"
#include "NodeRareData.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

using namespace HTMLNames;

WTF_MAKE_TZONE_ALLOCATED_IMPL(LabelsNodeList);

LabelsNodeList::LabelsNodeList(HTMLElement& element)
    : CachedLiveNodeList(element, LiveNodeListType::LabelsNodeList, NodeListInvalidationType::InvalidateOnForTypeAttrChange)
{
}

Ref<LabelsNodeList> LabelsNodeList::create(HTMLElement& element, const AtomString&)
{
    return adoptRef(*new LabelsNodeList(element));
}

LabelsNodeList::~LabelsNodeList()
{
    ownerNode().nodeLists()->removeCacheWithAtomName(*this, starAtom());
} 
    
bool LabelsNodeList::elementMatches(Element& testNode) const
{
    RefPtr label = dynamicDowncast<HTMLLabelElement>(testNode);
    return label && label->control() == &ownerNode();
}

} // namespace WebCore
