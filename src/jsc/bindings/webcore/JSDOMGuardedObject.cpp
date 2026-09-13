/*
 * Copyright (C) 2017-2021 Apple Inc. All rights reserved.
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
#include "JSDOMGuardedObject.h"

namespace WebCore {
using namespace JSC;

DOMGuardedObject::DOMGuardedObject(JSDOMGlobalObject& globalObject, JSCell& guarded)
    : ActiveDOMCallback(globalObject.scriptExecutionContext())
    , m_guarded(&guarded)
    , m_globalObject(&globalObject)
{
    if (globalObject.vm().heap.mutatorShouldBeFenced()) {
        Locker locker { globalObject.gcLock() };
        globalObject.guardedObjects().add(this);
    } else
        globalObject.guardedObjects(NoLockingNecessary).add(this);
    globalObject.vm().writeBarrier(&globalObject, &guarded);
}

DOMGuardedObject::~DOMGuardedObject()
{
    clear();
}

void DOMGuardedObject::clear()
{
    ASSERT(!m_guarded || m_globalObject);
    removeFromGlobalObject();
    m_guarded.clear();
}

void DOMGuardedObject::removeFromGlobalObject()
{
    if (!m_globalObject)
        return;

    if (m_globalObject->vm().heap.mutatorShouldBeFenced()) {
        Locker locker { m_globalObject->gcLock() };
        m_globalObject->guardedObjects().remove(this);
    } else
        m_globalObject->guardedObjects(NoLockingNecessary).remove(this);

    m_globalObject.clear();
}

void DOMGuardedObject::contextDestroyed()
{
    ActiveDOMCallback::contextDestroyed();
    clear();
}

}
