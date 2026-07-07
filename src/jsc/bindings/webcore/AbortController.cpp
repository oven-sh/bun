/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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
#include "AbortController.h"

#include "AbortSignal.h"
#include "DOMException.h"
#include "JSDOMException.h"
#include <wtf/TZoneMallocInlines.h>
#include "WebCoreOpaqueRoot.h"
#include "WebCoreOpaqueRootInlines.h"

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(AbortController);

Ref<AbortController> AbortController::create(ScriptExecutionContext& context)
{
    return adoptRef(*new AbortController(context));
}

AbortController::AbortController(ScriptExecutionContext& context)
    : m_signal(AbortSignal::create(&context))
{
}

AbortController::~AbortController() = default;

AbortSignal& AbortController::signal()
{
    return m_signal.get();
}

void AbortController::abort(JSDOMGlobalObject& globalObject, JSC::JSValue reason)
{
    ASSERT(reason);
    if (reason.isUndefined()) {
        protectedSignal()->signalAbort(&globalObject, CommonAbortReason::UserAbort);
    } else {
        protectedSignal()->signalAbort(reason);
    }
}

WebCoreOpaqueRoot AbortController::opaqueRoot()
{
    return root(&signal());
}

Ref<AbortSignal> AbortController::protectedSignal() const
{
    return m_signal;
}

}
