/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 * Copyright (C) 2021 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "MutationRecord.h"

#include "CharacterData.h"
#include "CommonAtomStrings.h"
#include "StaticNodeList.h"
#include "WebCoreOpaqueRootInlines.h"
#include <JavaScriptCore/AbstractSlotVisitorInlines.h>
#include <wtf/StdLibExtras.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(MutationRecord);

namespace {

static void addOpaqueRoot(JSC::AbstractSlotVisitor& visitor, Node* node)
{
    if (node)
        addWebCoreOpaqueRoot(visitor, node->opaqueRoot());
}

static void visitNodeListInGCThread(JSC::AbstractSlotVisitor& visitor, NodeList& nodeList)
{
    ASSERT(!nodeList.isLiveNodeList());
    unsigned length = nodeList.length();
    for (unsigned i = 0; i < length; ++i) {
        // We cannot ref the item here as this function may get called from a GC thread.
        SUPPRESS_UNRETAINED_ARG addOpaqueRoot(visitor, nodeList.item(i));
    }
}

class ChildListRecord final : public MutationRecord {
public:
    ChildListRecord(ContainerNode& target, Ref<NodeList>&& added, Ref<NodeList>&& removed, RefPtr<Node>&& previousSibling, RefPtr<Node>&& nextSibling)
        : m_target(target)
        , m_addedNodes(WTF::move(added))
        , m_removedNodes(WTF::move(removed))
        , m_previousSibling(WTF::move(previousSibling))
        , m_nextSibling(WTF::move(nextSibling))
    {
    }

private:
    const AtomString& type() override;
    Node& target() override { return m_target; }
    NodeList& addedNodes() override { return m_addedNodes; }
    NodeList& removedNodes() override { return m_removedNodes; }
    Node* previousSibling() override { return m_previousSibling.get(); }
    Node* nextSibling() override { return m_nextSibling.get(); }

    void visitNodesInGCThread(JSC::AbstractSlotVisitor& visitor) const final
    {
        addOpaqueRoot(visitor, m_target.ptr());
        addOpaqueRoot(visitor, m_previousSibling.get());
        addOpaqueRoot(visitor, m_nextSibling.get());
        // We cannot ref m_addedNodes here as this function may get called from a GC thread.
        SUPPRESS_UNRETAINED_ARG visitNodeListInGCThread(visitor, m_addedNodes.get());
        // We cannot ref m_removedNodes here as this function may get called from a GC thread.
        SUPPRESS_UNRETAINED_ARG visitNodeListInGCThread(visitor, m_removedNodes.get());
    }
    
    const Ref<ContainerNode> m_target;
    const Ref<NodeList> m_addedNodes;
    const Ref<NodeList> m_removedNodes;
    const RefPtr<Node> m_previousSibling;
    const RefPtr<Node> m_nextSibling;
};

class RecordWithEmptyNodeLists : public MutationRecord {
public:
    RecordWithEmptyNodeLists(Node& target, const String& oldValue)
        : m_target(target)
        , m_oldValue(oldValue)
    {
    }

private:
    Node& target() override { return m_target; }
    String oldValue() override { return m_oldValue; }
    NodeList& addedNodes() override { return lazilyInitializeEmptyNodeList(m_addedNodes); }
    NodeList& removedNodes() override { return lazilyInitializeEmptyNodeList(m_removedNodes); }

    static NodeList& lazilyInitializeEmptyNodeList(const RefPtr<NodeList>& nodeList)
    {
        if (!nodeList)
            lazyInitialize(nodeList, StaticNodeList::create());
        return *nodeList;
    }

    void visitNodesInGCThread(JSC::AbstractSlotVisitor& visitor) const final
    {
        addOpaqueRoot(visitor, m_target.ptr());
    }

    const Ref<Node> m_target;
    String m_oldValue;
    const RefPtr<NodeList> m_addedNodes;
    const RefPtr<NodeList> m_removedNodes;
};

class AttributesRecord final : public RecordWithEmptyNodeLists {
public:
    AttributesRecord(Element& target, const QualifiedName& name, const AtomString& oldValue)
        : RecordWithEmptyNodeLists(target, oldValue)
        , m_attributeName(name.localName())
        , m_attributeNamespace(name.namespaceURI())
    {
    }

private:
    const AtomString& type() override;
    const AtomString& attributeName() override { return m_attributeName; }
    const AtomString& attributeNamespace() override { return m_attributeNamespace; }

    AtomString m_attributeName;
    AtomString m_attributeNamespace;
};

class CharacterDataRecord : public RecordWithEmptyNodeLists {
public:
    CharacterDataRecord(CharacterData& target, const String& oldValue)
        : RecordWithEmptyNodeLists(target, oldValue)
    {
    }

private:
    const AtomString& type() override;
};

class MutationRecordWithNullOldValue final : public MutationRecord {
public:
    MutationRecordWithNullOldValue(MutationRecord& record)
        : m_record(record)
    {
    }

private:
    const AtomString& type() override { return m_record->type(); }
    Node& target() override { return m_record->target(); }
    NodeList& addedNodes() override { return m_record->addedNodes(); }
    NodeList& removedNodes() override { return m_record->removedNodes(); }
    Node* previousSibling() override { return m_record->previousSibling(); }
    Node* nextSibling() override { return m_record->nextSibling(); }
    const AtomString& attributeName() override { return m_record->attributeName(); }
    const AtomString& attributeNamespace() override { return m_record->attributeNamespace(); }

    String oldValue() override { return String(); }

    void visitNodesInGCThread(JSC::AbstractSlotVisitor& visitor) const final
    {
        m_record->visitNodesInGCThread(visitor);
    }

    const Ref<MutationRecord> m_record;
};

const AtomString& ChildListRecord::type()
{
    return childListAtom();
}

const AtomString& AttributesRecord::type()
{
    return attributesAtom();
}

const AtomString& CharacterDataRecord::type()
{
    return characterDataAtom();
}

} // namespace

Ref<MutationRecord> MutationRecord::createChildList(ContainerNode& target, Ref<NodeList>&& added, Ref<NodeList>&& removed, RefPtr<Node>&& previousSibling, RefPtr<Node>&& nextSibling)
{
    return adoptRef(static_cast<MutationRecord&>(*new ChildListRecord(target, WTF::move(added), WTF::move(removed), WTF::move(previousSibling), WTF::move(nextSibling))));
}

Ref<MutationRecord> MutationRecord::createAttributes(Element& target, const QualifiedName& name, const AtomString& oldValue)
{
    return adoptRef(static_cast<MutationRecord&>(*new AttributesRecord(target, name, oldValue)));
}

Ref<MutationRecord> MutationRecord::createCharacterData(CharacterData& target, const String& oldValue)
{
    return adoptRef(static_cast<MutationRecord&>(*new CharacterDataRecord(target, oldValue)));
}

Ref<MutationRecord> MutationRecord::createWithNullOldValue(MutationRecord& record)
{
    return adoptRef(static_cast<MutationRecord&>(*new MutationRecordWithNullOldValue(record)));
}

MutationRecord::~MutationRecord() = default;

} // namespace WebCore
