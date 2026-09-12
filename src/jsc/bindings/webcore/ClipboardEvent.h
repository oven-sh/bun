/*
 * Copyright (C) 2011 Google Inc.  All rights reserved.
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

#include "root.h"
#include "Event.h"
#include "EventNames.h"

namespace WebCore {

// https://w3c.github.io/clipboard-apis/#clipboard-event-interfaces
// Bun has no DataTransfer, so the spec'd `clipboardData` member is not stored
// and the attribute is always null; the event is otherwise a plain Event.
class ClipboardEvent final : public Event {
    WTF_MAKE_TZONE_ALLOCATED(ClipboardEvent);

public:
    // The spec's ClipboardEventInit only adds `clipboardData`, which Bun does
    // not store (no DataTransfer), so a plain EventInit describes it fully.
    static Ref<ClipboardEvent> create(const AtomString& type, const EventInit& initializer, IsTrusted isTrusted = IsTrusted::No)
    {
        return adoptRef(*new ClipboardEvent(type, initializer, isTrusted));
    }

private:
    ClipboardEvent(const AtomString& type, const EventInit& initializer, IsTrusted isTrusted)
        : Event(ClipboardEventInterfaceType, type, initializer, isTrusted)
    {
    }
};

} // namespace WebCore
