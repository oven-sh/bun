/*
 * Copyright (C) 2016-2021 Apple Inc. All rights reserved.
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

#include "config.h"
#include "StaticRange.h"

#include "ContainerNodeInlines.h"
#include "WebCoreOpaqueRootInlines.h"
#include <JavaScriptCore/AbstractSlotVisitorInlines.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(StaticRange);

StaticRange::StaticRange(SimpleRange&& range)
    : SimpleRange(WTF::move(range))
{
}

Ref<StaticRange> StaticRange::create(SimpleRange&& range)
{
    return adoptRef(*new StaticRange(WTF::move(range)));
}

Ref<StaticRange> StaticRange::create(const SimpleRange& range)
{
    return create(SimpleRange { range });
}

static bool LEGACY_NODELETE isDocumentTypeOrAttr(Node& node)
{
    switch (node.nodeType()) {
    case NodeType::Attribute:
    case NodeType::DocumentType:
        return true;
    default:
        return false;
    }
}

ExceptionOr<Ref<StaticRange>> StaticRange::create(Init&& init)
{
    if (isDocumentTypeOrAttr(init.startContainer) || isDocumentTypeOrAttr(init.endContainer))
        return Exception { ExceptionCode::InvalidNodeTypeError };
    return create({ { WTF::move(init.startContainer), init.startOffset }, { WTF::move(init.endContainer), init.endOffset } });
}

void StaticRange::visitNodesInGCThread(JSC::AbstractSlotVisitor& visitor) const
{
    addWebCoreOpaqueRoot(visitor, start.container->opaqueRoot());
    addWebCoreOpaqueRoot(visitor, end.container->opaqueRoot());
}

bool StaticRange::computeValidity() const
{
    Ref startContainer = this->startContainer();
    Ref endContainer = this->endContainer();

    if (startOffset() > startContainer->length())
        return false;
    if (endOffset() > endContainer->length())
        return false;
    if (startContainer.ptr() == endContainer.ptr())
        return endOffset() >= startOffset();
    if (!connectedInSameTreeScope(&startContainer->rootNode(), &endContainer->rootNode()))
        return false;
    return !is_gt(treeOrder<ComposedTree>(startContainer, endContainer));
}

} // namespace WebCore
