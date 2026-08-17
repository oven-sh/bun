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

#include "config.h"
#include "GPUCompilationMessage.h"

namespace WebCore {

const String& GPUCompilationMessage::message() const
{
    return m_backing->message();
}

GPUCompilationMessageType GPUCompilationMessage::type() const
{
    switch (m_backing->type()) {
    case WebGPU::CompilationMessageType::Error:
        return GPUCompilationMessageType::Error;
    case WebGPU::CompilationMessageType::Warning:
        return GPUCompilationMessageType::Warning;
    case WebGPU::CompilationMessageType::Info:
        return GPUCompilationMessageType::Info;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

uint64_t GPUCompilationMessage::lineNum() const
{
    return m_backing->lineNum();
}

uint64_t GPUCompilationMessage::linePos() const
{
    return m_backing->linePos();
}

uint64_t GPUCompilationMessage::offset() const
{
    return m_backing->offset();
}

uint64_t GPUCompilationMessage::length() const
{
    return m_backing->length();
}

}
