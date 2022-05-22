/*
 * Copyright (C) 2016 Canon Inc.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted, provided that the following conditions
 * are required to be met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Canon Inc. nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY CANON INC. AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL CANON INC. AND ITS CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "JSDOMPromiseDeferred.h"
#include "ReadableStreamDefaultController.h"
#include <wtf/WeakPtr.h>

namespace WebCore {

class ReadableStreamSource : public RefCounted<ReadableStreamSource> {
public:
    virtual ~ReadableStreamSource();

    void start(ReadableStreamDefaultController&&, DOMPromiseDeferred<void>&&);
    void pull(DOMPromiseDeferred<void>&&);
    void cancel(JSC::JSValue);
    void error(JSC::JSValue error);

    bool hasController() const { return !!m_controller; }

    bool isPulling() const { return !!m_promise; }

protected:
    ReadableStreamDefaultController& controller() { return m_controller.value(); }
    const ReadableStreamDefaultController& controller() const { return m_controller.value(); }

    void startFinished();
    void pullFinished();
    void cancelFinished();
    void clean();

    virtual void setActive() = 0;
    virtual void setInactive() = 0;

    virtual void doStart() = 0;
    virtual void doPull() = 0;
    virtual void doCancel() = 0;

    std::unique_ptr<DOMPromiseDeferred<void>> m_promise;

private:
    std::optional<ReadableStreamDefaultController> m_controller;
};

class SimpleReadableStreamSource
    : public ReadableStreamSource,
      public CanMakeWeakPtr<SimpleReadableStreamSource> {
public:
    static Ref<SimpleReadableStreamSource> create() { return adoptRef(*new SimpleReadableStreamSource); }

    void close();
    void enqueue(JSC::JSValue);

private:
    SimpleReadableStreamSource() = default;

    // ReadableStreamSource
    void setActive() final {}
    void setInactive() final {}
    void doStart() final {}
    void doPull() final {}
    void doCancel() final;

    bool m_isCancelled { false };
};

} // namespace WebCore
