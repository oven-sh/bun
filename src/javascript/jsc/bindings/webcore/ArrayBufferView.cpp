/*
 * Copyright (C) 2009-2021 Apple Inc. All rights reserved.
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
#include "JavaScriptCore/ArrayBufferView.h"

namespace JSC {

ArrayBufferView::ArrayBufferView(
    RefPtr<ArrayBuffer>&& buffer, size_t byteOffset, size_t byteLength)
    : m_byteOffset(byteOffset)
    , m_isDetachable(true)
    , m_byteLength(byteLength)
    , m_buffer(WTFMove(buffer))
{
    Checked<size_t, CrashOnOverflow> length(byteOffset);
    length += byteLength;
    RELEASE_ASSERT_WITH_SECURITY_IMPLICATION(length <= m_buffer->byteLength());
    if (m_buffer)
        m_baseAddress = BaseAddress(static_cast<char*>(m_buffer->data()) + m_byteOffset, byteLength);
}

ArrayBufferView::~ArrayBufferView()
{
    if (!m_isDetachable)
        m_buffer->unpin();
}

void ArrayBufferView::setDetachable(bool flag)
{
    if (flag == m_isDetachable)
        return;

    m_isDetachable = flag;

    if (!m_buffer)
        return;

    if (flag)
        m_buffer->unpin();
    else
        m_buffer->pin();
}

} // namespace JSC
