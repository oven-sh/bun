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
#include "ReadableStreamSource.h"
namespace WebCore {

ReadableStreamSource::~ReadableStreamSource() = default;

void ReadableStreamSource::start(ReadableStreamDefaultController&& controller, DOMPromiseDeferred<void>&& promise)
{
    ASSERT(!m_promise);
    m_promise = makeUnique<DOMPromiseDeferred<void>>(WTF::move(promise));
    m_controller = WTF::move(controller);

    setActive();
    doStart();
}

void ReadableStreamSource::pull(DOMPromiseDeferred<void>&& promise)
{
    ASSERT(!m_promise);
    ASSERT(m_controller);

    m_promise = makeUnique<DOMPromiseDeferred<void>>(WTF::move(promise));

    setActive();
    doPull();
}

void ReadableStreamSource::startFinished()
{
    ASSERT(m_promise);
    m_promise->resolve();
    m_promise = nullptr;
    setInactive();
}

void ReadableStreamSource::pullFinished()
{
    ASSERT(m_promise);
    m_promise->resolve();
    m_promise = nullptr;
    setInactive();
}

void ReadableStreamSource::cancel(JSC::JSValue)
{
    clean();
    doCancel();
}

void ReadableStreamSource::clean()
{
    if (m_promise) {
        m_promise = nullptr;
        setInactive();
    }
}

void ReadableStreamSource::error(JSC::JSValue value)
{
    if (m_promise) {
        m_promise->reject(value, RejectAsHandled::Yes);
        m_promise = nullptr;
        setInactive();
    } else {
        controller().error(value);
    }
}

void SimpleReadableStreamSource::doCancel()
{
    m_isCancelled = true;
}

void SimpleReadableStreamSource::close()
{
    if (!m_isCancelled)
        controller().close();
}

void SimpleReadableStreamSource::enqueue(JSC::JSValue value)
{
    if (!m_isCancelled)
        controller().enqueue(value);
}

} // namespace WebCore
