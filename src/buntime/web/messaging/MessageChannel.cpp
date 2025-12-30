/*
 * Copyright (C) 2008 Apple Inc. All Rights Reserved.
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
 *
 */

#include "config.h"
#include "MessageChannel.h"

#include "MessagePort.h"
#include "MessagePortChannelProvider.h"
#include "ScriptExecutionContext.h"

namespace WebCore {

static std::pair<Ref<MessagePort>, Ref<MessagePort>> generateMessagePorts(ScriptExecutionContext& context)
{
    MessagePortIdentifier id1 = { WebCore::Process::identifier(), PortIdentifier::generate() };
    MessagePortIdentifier id2 = { WebCore::Process::identifier(), PortIdentifier::generate() };

    return { MessagePort::create(context, id1, id2), MessagePort::create(context, id2, id1) };
}

Ref<MessageChannel> MessageChannel::create(ScriptExecutionContext& context)
{
    return adoptRef(*new MessageChannel(context));
}

MessageChannel::MessageChannel(ScriptExecutionContext& context)
    : m_ports(generateMessagePorts(context))
{
    if (!context.activeDOMObjectsAreStopped()) {
        ASSERT(!port1().isDetached());
        ASSERT(!port2().isDetached());
        MessagePortChannelProvider::fromContext(context).createNewMessagePortChannel(port1().identifier(), port2().identifier());
    } else {
        ASSERT(port1().isDetached());
        ASSERT(port2().isDetached());
    }
}

MessageChannel::~MessageChannel() = default;

} // namespace WebCore
