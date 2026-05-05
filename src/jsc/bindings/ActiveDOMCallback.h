/*
 * Copyright (C) 2010, 2012 Google Inc. All rights reserved.
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

#include "ContextDestructionObserver.h"

namespace JSC {
class AbstractSlotVisitor;
class SlotVisitor;
}

namespace WebCore {

class ScriptExecutionContext;

// A base class that prevents binding callbacks from executing when
// active dom objects are stopped or suspended.
//
// Should only be created, used, and destroyed on the script execution
// context thread.
class ActiveDOMCallback : public ContextDestructionObserver {
public:
    WEBCORE_EXPORT ActiveDOMCallback(ScriptExecutionContext*);
    WEBCORE_EXPORT virtual ~ActiveDOMCallback();

    WEBCORE_EXPORT bool canInvokeCallback() const;

    WEBCORE_EXPORT bool activeDOMObjectsAreSuspended() const;
    WEBCORE_EXPORT bool activeDOMObjectAreStopped() const;

    virtual void visitJSFunction(JSC::AbstractSlotVisitor&) {}
    virtual void visitJSFunction(JSC::SlotVisitor&) {}
};

} // namespace WebCore
