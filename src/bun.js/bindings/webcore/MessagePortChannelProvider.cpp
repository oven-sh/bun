/*
 * Copyright (C) 2018 Apple Inc. All rights reserved.
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
// #include "MessagePortChannelProvider.h"

// #include "Document.h"
#include "MessagePortChannelProviderImpl.h"
// #include "WorkerGlobalScope.h"
// #include "WorkletGlobalScope.h"
#include <wtf/MainThread.h>

namespace WebCore {

static MessagePortChannelProviderImpl* globalProvider;

MessagePortChannelProvider& MessagePortChannelProvider::singleton()
{
    // TODO: I think this assertion is relevant. Bun will call this on the Worker's thread
    // ASSERT(isMainThread());
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [] {
        if (!globalProvider)
            globalProvider = new MessagePortChannelProviderImpl;
    });

    return *globalProvider;
}

// void MessagePortChannelProvider::setSharedProvider(MessagePortChannelProvider& provider)
// {
//     RELEASE_ASSERT(isMainThread());
//     RELEASE_ASSERT(!globalProvider);
//     globalProvider = &provider;
// }

MessagePortChannelProvider& MessagePortChannelProvider::fromContext(ScriptExecutionContext& context)
{
    // if (auto document = dynamicDowncast<Document>(context))
    //     return document->messagePortChannelProvider();

    // if (auto workletScope = dynamicDowncast<WorkletGlobalScope>(context))
    //     return workletScope->messagePortChannelProvider();

    return jsCast<Zig::GlobalObject*>(context.jsGlobalObject())->globalEventScope->messagePortChannelProvider();
}

} // namespace WebCore
