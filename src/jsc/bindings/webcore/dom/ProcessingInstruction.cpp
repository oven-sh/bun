/*
 * Copyright (C) 2000 Peter Kelly (pmk@post.com)
 * Copyright (C) 2006-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2013 Samsung Electronics. All rights reserved.
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
#include "ProcessingInstruction.h"

#include "Document.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(ProcessingInstruction);

inline ProcessingInstruction::ProcessingInstruction(Document& document, String&& target, String&& data)
    : CharacterData(document, WTF::move(data), NodeType::ProcessingInstruction)
    , m_target(WTF::move(target))
{
}

Ref<ProcessingInstruction> ProcessingInstruction::create(Document& document, String&& target, String&& data)
{
    return adoptRef(*new ProcessingInstruction(document, WTF::move(target), WTF::move(data)));
}

ProcessingInstruction::~ProcessingInstruction() = default;

String ProcessingInstruction::nodeName() const
{
    return m_target;
}

Ref<Node> ProcessingInstruction::cloneNodeInternal(Document& document, CloningOperation, CustomElementRegistry*) const
{
    return create(document, String { m_target }, String { data() });
}

} // namespace
