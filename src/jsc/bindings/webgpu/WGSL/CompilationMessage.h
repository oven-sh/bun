/*
 * Copyright (C) 2022-2024 Apple Inc. All rights reserved.
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

#include "SourceSpan.h"
#include <wtf/TZoneMalloc.h>
#include <wtf/text/WTFString.h>

namespace WGSL {

class CompilationMessage {
    WTF_MAKE_TZONE_ALLOCATED(CompilationMessage);
public:
    CompilationMessage(String&& message, SourceSpan span)
        : m_message(WTF::move(message))
        , m_span(span)
    {
    }

    CompilationMessage(const String& message, SourceSpan span)
        : m_message(message)
        , m_span(span)
    {
    }

    void dump(PrintStream& out) const;

    const String& message() const LIFETIME_BOUND { return m_message; }
    unsigned lineNumber() const { return m_span.line; }
    unsigned lineOffset() const { return m_span.lineOffset; }
    unsigned offset() const { return m_span.offset; }
    unsigned length() const { return m_span.length; }

private:
    String m_message;
    SourceSpan m_span;
};

using Warning = CompilationMessage;
using Error = CompilationMessage;
template <typename T>
using Result = Expected<T, Error>;

} // namespace WGSL
