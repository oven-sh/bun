/*
 * Copyright (C) 2019-2022 Apple Inc. All rights reserved.
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
#include "JSDOMWrapper.h"
#include "wtf/NeverDestroyed.h"
#include "JSAbortSignal.h"

namespace WebCore {

bool JSAbortSignalOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, JSC::AbstractSlotVisitor& visitor, const char** reason)
{
    auto& abortSignal = JSC::jsCast<JSAbortSignal*>(handle.slot()->asCell())->wrapped();
    if (abortSignal.isFiringEventListeners()) {
        if (UNLIKELY(reason))
            *reason = "EventTarget firing event listeners";
        return true;
    }

    if (abortSignal.aborted())
        return false;

    if (abortSignal.isFollowingSignal())
        return true;

    if (abortSignal.hasAbortEventListener() && abortSignal.hasActiveTimeoutTimer())
        return true;

    return visitor.containsOpaqueRoot(&abortSignal);
}

template<typename Visitor>
void JSAbortSignal::visitAdditionalChildren(Visitor& visitor)
{
}

DEFINE_VISIT_ADDITIONAL_CHILDREN(JSAbortSignal);

} // namespace WebCore
