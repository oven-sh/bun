/*
 * Copyright (C) 2023 Apple Inc. All rights reserved.
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

#pragma once

#include "WebGPUInternalError.h"
#include <wtf/Ref.h>
#include <wtf/RefCounted.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class GPUInternalError : public RefCounted<GPUInternalError> {
public:
    static Ref<GPUInternalError> create(String&& message)
    {
        return adoptRef(*new GPUInternalError(WTF::move(message)));
    }

    static Ref<GPUInternalError> create(Ref<WebGPU::InternalError>&& backing)
    {
        return adoptRef(*new GPUInternalError(WTF::move(backing)));
    }

    const String& NODELETE message() const LIFETIME_BOUND;

    WebGPU::InternalError* backing() { return m_backing.get(); }
    const WebGPU::InternalError* backing() const { return m_backing.get(); }
    String stack() const { return "_"_s; }

private:
    GPUInternalError(String&& message)
        : m_message(WTF::move(message))
    {
    }

    GPUInternalError(Ref<WebGPU::InternalError>&& backing)
        : m_backing(WTF::move(backing))
    {
    }

    String m_message;
    RefPtr<WebGPU::InternalError> m_backing;
};

}
