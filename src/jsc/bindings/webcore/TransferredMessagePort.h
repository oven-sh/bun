/*
 * Copyright (C) 2018-2022 Apple Inc. All rights reserved.
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

// A MessagePort endpoint in transit between contexts. Carried alongside
// SerializedScriptValue (not encoded into the byte stream), so holding a
// live RefPtr to the shared pipe is fine — this never leaves the process.
//
// The struct is move-only and owns its pipe side: if it is dropped without
// ever reaching entangle() (e.g. the carrying message lands on a closed
// port, or the destination's inbox is discarded on close()), the
// destructor marks that side Closed so the peer port's hasPendingActivity
// can fall to false and the peer becomes collectable. entangle() takes the
// pipe via releaseNonNull(), so on the happy path the destructor is a no-op.

#pragma once

#include <wtf/RefPtr.h>

namespace WebCore {

class MessagePortPipe;

struct TransferredMessagePort {
    RefPtr<MessagePortPipe> pipe;
    uint8_t side { 0 };

    TransferredMessagePort() = default;
    TransferredMessagePort(RefPtr<MessagePortPipe>&& p, uint8_t s)
        : pipe(WTF::move(p))
        , side(s)
    {
    }

    // Out-of-line in MessagePortPipe.cpp to avoid a header cycle
    // (MessagePortPipe.h → MessageWithMessagePorts.h → this file).
    ~TransferredMessagePort();

    TransferredMessagePort(TransferredMessagePort&&) = default;
    TransferredMessagePort& operator=(TransferredMessagePort&&);
    TransferredMessagePort(const TransferredMessagePort&) = delete;
    TransferredMessagePort& operator=(const TransferredMessagePort&) = delete;
};

} // namespace WebCore
