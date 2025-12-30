/*
 * Copyright (C) 2020 Apple Inc. All rights reserved.
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

#include "JSDOMPromiseDeferred.h"
#include <wtf/RefCounted.h>
#include <wtf/text/WTFString.h>

namespace JSC {
class JSValue;
}

namespace WebCore {

class WritableStreamSink : public RefCounted<WritableStreamSink> {
public:
    virtual ~WritableStreamSink() = default;

    virtual void write(ScriptExecutionContext&, JSC::JSValue, DOMPromiseDeferred<void>&&) = 0;
    virtual void close() = 0;
    virtual void error(String&&) = 0;
};

class SimpleWritableStreamSink : public WritableStreamSink {
public:
    using WriteCallback = Function<ExceptionOr<void>(ScriptExecutionContext&, JSC::JSValue)>;
    static Ref<SimpleWritableStreamSink> create(WriteCallback&& writeCallback) { return adoptRef(*new SimpleWritableStreamSink(WTF::move(writeCallback))); }

private:
    explicit SimpleWritableStreamSink(WriteCallback&&);

    void write(ScriptExecutionContext&, JSC::JSValue, DOMPromiseDeferred<void>&&) final;
    void close() final {}
    void error(String&&) final {}

    WriteCallback m_writeCallback;
};

inline SimpleWritableStreamSink::SimpleWritableStreamSink(WriteCallback&& writeCallback)
    : m_writeCallback(WTF::move(writeCallback))
{
}

inline void SimpleWritableStreamSink::write(ScriptExecutionContext& context, JSC::JSValue value, DOMPromiseDeferred<void>&& promise)
{
    promise.settle(m_writeCallback(context, value));
}

} // namespace WebCore
