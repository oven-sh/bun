/*
 * Copyright (C) 2021-2023 Apple Inc. All rights reserved.
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

#include "WebGPUCompilationMessage.h"
#include <wtf/Ref.h>
#include <wtf/RefCounted.h>

namespace WebCore::WebGPU {

class CompilationInfo final : public RefCounted<CompilationInfo> {
public:
    static Ref<CompilationInfo> create(Vector<Ref<CompilationMessage>>&& messages)
    {
        return adoptRef(*new CompilationInfo(WTF::move(messages)));
    }

    const Vector<Ref<CompilationMessage>>& messages() const LIFETIME_BOUND { return m_messages; }

protected:
    CompilationInfo(Vector<Ref<CompilationMessage>>&& messages)
        : m_messages(WTF::move(messages))
    {
    }

private:
    CompilationInfo(const CompilationInfo&) = delete;
    CompilationInfo(CompilationInfo&&) = delete;
    CompilationInfo& operator=(const CompilationInfo&) = delete;
    CompilationInfo& operator=(CompilationInfo&&) = delete;

    Vector<Ref<CompilationMessage>> m_messages;
};

} // namespace WebCore::WebGPU
