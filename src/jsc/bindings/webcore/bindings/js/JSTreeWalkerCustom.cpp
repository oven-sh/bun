/*
 * Copyright (C) 2006-2021 Apple Inc. All rights reserved.
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
#include "JSTreeWalker.h"

#include "JSNodeCustomInlines.h"
#include "Node.h"
#include "WebCoreOpaqueRootInlines.h"
#include <JavaScriptCore/SlotVisitorInlines.h>

namespace WebCore {

template<typename Visitor>
void JSTreeWalker::visitAdditionalChildrenInGCThread(Visitor& visitor)
{
    if (auto filter = wrapped().filter())
        addWebCoreOpaqueRoot(visitor, *filter);
    addWebCoreOpaqueRoot(visitor, wrapped().root());
    addWebCoreOpaqueRoot(visitor, wrapped().opaqueRootForCurrentNodeInGCThread());
}

DEFINE_VISIT_ADDITIONAL_CHILDREN_IN_GC_THREAD(JSTreeWalker);

} // namespace WebCore
