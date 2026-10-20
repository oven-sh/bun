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
#include "JSNode.h"

#include "Attr.h"
#include "CDATASection.h"
#include "Comment.h"
#include "Document.h"
#include "DocumentFragment.h"
#include "DocumentType.h"
#include "HTMLElement.h"
#include "HTMLNames.h"
#include "JSAttr.h"
#include "JSCDATASection.h"
#include "JSComment.h"
#include "JSDOMBinding.h"
#include "JSDocument.h"
#include "JSDocumentFragment.h"
#include "JSDocumentType.h"
#include "JSEventListener.h"
#include "JSHTMLElement.h"
#include "JSHTMLElementWrapperFactory.h"
#include "JSProcessingInstruction.h"
#include "JSSVGElementWrapperFactory.h"
#include "JSShadowRoot.h"
#include "JSText.h"
#include "Node.h"
#include "ProcessingInstruction.h"
#include "RegisteredEventListener.h"
#include "SVGElement.h"
#include "ShadowRoot.h"
#include "GCReachableRef.h"
#include "Text.h"
#include "WebCoreOpaqueRootInlines.h"

namespace WebCore {

using namespace JSC;
using namespace HTMLNames;

bool JSNodeOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, AbstractSlotVisitor& visitor, ASCIILiteral* reason)
{
    SUPPRESS_UNCHECKED_LOCAL auto& node = downcast<JSNode>(handle.slot()->asCell())->wrapped();
    // Upstream asks this of disconnected nodes only. A node in a document that script has let go of needs it as well.
    if (GCReachableRefMap::contains(node) || node.isInCustomElementReactionQueue()) {
        if (reason) [[unlikely]]
            *reason = "Node is scheduled to be used in an async script invocation)"_s;
        return true;
    }

    if (reason) [[unlikely]]
        *reason = "Connected node"_s;

    return containsWebCoreOpaqueRoot(visitor, node.opaqueRoot());
}

template<typename Visitor>
void JSNode::visitAdditionalChildrenInGCThread(Visitor& visitor)
{
    addWebCoreOpaqueRoot(visitor, wrapped().opaqueRoot());
}

DEFINE_VISIT_ADDITIONAL_CHILDREN_IN_GC_THREAD(JSNode);

static ALWAYS_INLINE JSValue createWrapperForGlobalObject(JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Ref<Node>&& node)
{
    ASSERT(!node->wrapper());

    JSDOMObject* wrapper;
    switch (node->nodeType()) {
    case NodeType::Element:
        if (is<HTMLElement>(node))
            wrapper = createJSHTMLWrapper(globalObject, uncheckedDowncast<HTMLElement>(WTF::move(node)));
        else if (is<SVGElement>(node))
            wrapper = createJSSVGWrapper(globalObject, uncheckedDowncast<SVGElement>(WTF::move(node)));
        else
            wrapper = createWrapper<Element>(globalObject, WTF::move(node));
        break;
    case NodeType::Attribute:
        wrapper = createWrapper<Attr>(globalObject, WTF::move(node));
        break;
    case NodeType::Text:
        wrapper = createWrapper<Text>(globalObject, WTF::move(node));
        break;
    case NodeType::CDATASection:
        wrapper = createWrapper<CDATASection>(globalObject, WTF::move(node));
        break;
    case NodeType::ProcessingInstruction:
        wrapper = createWrapper<ProcessingInstruction>(globalObject, WTF::move(node));
        break;
    case NodeType::Comment:
        wrapper = createWrapper<Comment>(globalObject, WTF::move(node));
        break;
    case NodeType::Document:
        // we don't want to cache the document itself in the per-document dictionary
        return toJS(lexicalGlobalObject, globalObject, uncheckedDowncast<Document>(node.get()));
    case NodeType::DocumentType:
        wrapper = createWrapper<DocumentType>(globalObject, WTF::move(node));
        break;
    case NodeType::DocumentFragment:
        if (node->isShadowRoot())
            wrapper = createWrapper<ShadowRoot>(globalObject, WTF::move(node));
        else
            wrapper = createWrapper<DocumentFragment>(globalObject, WTF::move(node));
        break;
    default:
        wrapper = createWrapper<Node>(globalObject, WTF::move(node));
    }

    return wrapper;
}

JSValue createWrapper(JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Ref<Node>&& node)
{
    return createWrapperForGlobalObject(lexicalGlobalObject, globalObject, WTF::move(node));
}

JSValue toJSNewlyCreated(JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Ref<Node>&& node)
{
    return createWrapperForGlobalObject(lexicalGlobalObject, globalObject, WTF::move(node));
}

void createNodeWrapperInDocumentRealmSlowCase(Node& node, Document& document)
{
    ASSERT(!node.wrapper());

    auto* globalObject = downcast<JSDOMGlobalObject>(document.globalObject());
    if (!globalObject)
        return;

    JSLockHolder lock(globalObject);
    createWrapperForGlobalObject(globalObject, globalObject, node);
}

} // namespace WebCore
