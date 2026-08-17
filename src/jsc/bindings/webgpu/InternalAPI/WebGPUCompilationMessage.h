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

#include "WebGPUCompilationMessageType.h"
#include <cstdint>
#include <wtf/Ref.h>
#include <wtf/RefCounted.h>
#include <wtf/text/WTFString.h>

namespace WebCore::WebGPU {

class CompilationMessage final : public RefCounted<CompilationMessage> {
public:
    static Ref<CompilationMessage> create(String&& message, CompilationMessageType type, uint64_t lineNum, uint64_t linePos, uint64_t offset, uint64_t length)
    {
        return adoptRef(*new CompilationMessage(WTF::move(message), type, lineNum, linePos, offset, length));
    }

    static Ref<CompilationMessage> create(const String& message, CompilationMessageType type, uint64_t lineNum, uint64_t linePos, uint64_t offset, uint64_t length)
    {
        return adoptRef(*new CompilationMessage(message, type, lineNum, linePos, offset, length));
    }

    const String& message() const LIFETIME_BOUND { return m_message; }
    CompilationMessageType type() const { return m_type; }
    uint64_t lineNum() const { return m_lineNum; }
    uint64_t linePos() const { return m_linePos; }
    uint64_t offset() const { return m_offset; }
    uint64_t length() const { return m_length; }

private:
    CompilationMessage(String&& message, CompilationMessageType type, uint64_t lineNum, uint64_t linePos, uint64_t offset, uint64_t length)
        : m_message(WTF::move(message))
        , m_type(type)
        , m_lineNum(lineNum)
        , m_linePos(linePos)
        , m_offset(offset)
        , m_length(length)
    {
    }

    CompilationMessage(const String& message, CompilationMessageType type, uint64_t lineNum, uint64_t linePos, uint64_t offset, uint64_t length)
        : m_message(message)
        , m_type(type)
        , m_lineNum(lineNum)
        , m_linePos(linePos)
        , m_offset(offset)
        , m_length(length)
    {
    }

    CompilationMessage(const CompilationMessage&) = delete;
    CompilationMessage(CompilationMessage&&) = delete;
    CompilationMessage& operator=(const CompilationMessage&) = delete;
    CompilationMessage& operator=(CompilationMessage&&) = delete;

    String m_message;
    CompilationMessageType m_type { CompilationMessageType::Error };
    uint64_t m_lineNum { 0 };
    uint64_t m_linePos { 0 };
    uint64_t m_offset { 0 };
    uint64_t m_length { 0 };
};

} // namespace WebCore::WebGPU
