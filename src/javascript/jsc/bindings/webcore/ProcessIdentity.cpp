/*
 * Copyright (C) 2021 Apple Inc. All rights reserved.
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
#include "ProcessIdentity.h"

#include "Logging.h"

#if HAVE(TASK_IDENTITY_TOKEN)
#include <mach/mach.h>
#endif

namespace WebCore {

ProcessIdentity::ProcessIdentity(CurrentProcessTag)
{
#if HAVE(TASK_IDENTITY_TOKEN)
    task_id_token_t identityToken;
    kern_return_t kr = task_create_identity_token(mach_task_self(), &identityToken);
    if (kr == KERN_SUCCESS)
        m_taskIdToken = MachSendRight::adopt(identityToken);
    else
        RELEASE_LOG_ERROR(Process, "task_create_identity_token() failed: %{private}s (%x)", mach_error_string(kr), kr);
#endif
}

ProcessIdentity::operator bool() const
{
#if HAVE(TASK_IDENTITY_TOKEN)
    return static_cast<bool>(m_taskIdToken);
#else
    return false;
#endif
}

#if HAVE(TASK_IDENTITY_TOKEN)
ProcessIdentity::ProcessIdentity(MachSendRight&& taskIdToken)
    : m_taskIdToken(WTFMove(taskIdToken))
{
}
#endif

}
