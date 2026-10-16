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

#pragma once

#include "ScriptWrappable.h"
#include <wtf/RefCounted.h>
#include <wtf/RefPtr.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/text/WTFString.h>

namespace JSC {

class AbstractSlotVisitor;

}

namespace WebCore {

class CharacterData;
class ContainerNode;
class Element;
class Node;
class NodeList;
class QualifiedName;

class MutationRecord : public ScriptWrappable, public RefCounted<MutationRecord> {
    WTF_MAKE_TZONE_ALLOCATED(MutationRecord);
public:
    static Ref<MutationRecord> createChildList(ContainerNode& target, Ref<NodeList>&& added, Ref<NodeList>&& removed, RefPtr<Node>&& previousSibling, RefPtr<Node>&& nextSibling);
    static Ref<MutationRecord> createAttributes(Element& target, const QualifiedName&, const AtomString& oldValue);
    static Ref<MutationRecord> createCharacterData(CharacterData& target, const String& oldValue);

    static Ref<MutationRecord> createWithNullOldValue(MutationRecord&);

    virtual ~MutationRecord();

    virtual const AtomString& type() = 0;
    virtual Node& LEGACY_NODELETE target() = 0;

    virtual NodeList& addedNodes() = 0;
    virtual NodeList& removedNodes() = 0;
    virtual Node* previousSibling() { return 0; }
    virtual Node* nextSibling() { return 0; }

    virtual const AtomString& attributeName() { return nullAtom(); }
    virtual const AtomString& attributeNamespace() { return nullAtom(); }

    virtual String oldValue() { return String(); }

    virtual void visitNodesInGCThread(JSC::AbstractSlotVisitor&) const = 0;
};

} // namespace WebCore
