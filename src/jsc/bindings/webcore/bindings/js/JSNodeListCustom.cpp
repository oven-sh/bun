/*
 * Copyright (C) 2007-2021 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
 */

#include "config.h"
#include "JSNodeList.h"

#include "ChildNodeList.h"
#include "JSNodeCustomInlines.h"
#include "LiveNodeList.h"
#include "NodeList.h"
#include "WebCoreOpaqueRootInlines.h"
#include <JavaScriptCore/HeapCellInlines.h>
#include <JavaScriptCore/JSGlobalObjectInlines.h>
#include <JavaScriptCore/StructureInlines.h>
#include <wtf/text/AtomString.h>


namespace WebCore {
using namespace JSC;

bool JSNodeListOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, AbstractSlotVisitor& visitor, ASCIILiteral* reason)
{
    JSNodeList* jsNodeList = downcast<JSNodeList>(handle.slot()->asCell());
    if (!jsNodeList->hasCustomProperties())
        return false;

    // Cannot ref the node list as this gets called from a GC thread.
    SUPPRESS_UNCOUNTED_LOCAL if (auto* liveNodeList = dynamicDowncast<LiveNodeList>(jsNodeList->wrapped())) {
        if (reason) [[unlikely]]
            *reason = "LiveNodeList owner is opaque root"_s;

        return containsWebCoreOpaqueRoot(visitor, liveNodeList->ownerNode());
    }

    // Cannot ref the node list as this gets called from a GC thread.
    SUPPRESS_UNCOUNTED_LOCAL if (auto* childNodeList = dynamicDowncast<ChildNodeList>(jsNodeList->wrapped())) {
        if (reason) [[unlikely]]
            *reason = "ChildNodeList owner is opaque root"_s;

        return containsWebCoreOpaqueRoot(visitor, childNodeList->ownerNode());
    }

    // Cannot ref the node list as this gets called from a GC thread.
    SUPPRESS_UNCOUNTED_LOCAL if (auto* emptyNodeList = dynamicDowncast<EmptyNodeList>(jsNodeList->wrapped())) {
        if (reason) [[unlikely]]
            *reason = "EmptyNodeList owner is opaque root"_s;

        return containsWebCoreOpaqueRoot(visitor, emptyNodeList->ownerNode());
    }
    return false;
}

JSC::JSValue createWrapper(JSDOMGlobalObject& globalObject, Ref<NodeList>&& nodeList)
{
    // FIXME: Adopt reportExtraMemoryVisited, and switch to reportExtraMemoryAllocated.
    // https://bugs.webkit.org/show_bug.cgi?id=142595
    globalObject.vm().heap.deprecatedReportExtraMemory(nodeList->memoryCost());
    return createWrapper<NodeList>(&globalObject, WTF::move(nodeList));
}

JSC::JSValue toJSNewlyCreated(JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<NodeList>&& nodeList)
{
    return createWrapper(*globalObject, WTF::move(nodeList));
}

} // namespace WebCore
