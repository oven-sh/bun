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
#include "WritableStream.h"

#include "JSWritableStream.h"
#include "JSWritableStreamSink.h"

namespace WebCore {

ExceptionOr<Ref<WritableStream>> WritableStream::create(JSC::JSGlobalObject& globalObject, std::optional<JSC::Strong<JSC::JSObject>>&& underlyingSink, std::optional<JSC::Strong<JSC::JSObject>>&& strategy)
{
    JSC::JSValue underlyingSinkValue = JSC::jsUndefined();
    if (underlyingSink)
        underlyingSinkValue = underlyingSink->get();

    JSC::JSValue strategyValue = JSC::jsUndefined();
    if (strategy)
        strategyValue = strategy->get();

    return create(globalObject, underlyingSinkValue, strategyValue);
}

ExceptionOr<Ref<WritableStream>> WritableStream::create(JSC::JSGlobalObject& globalObject, JSC::JSValue underlyingSink, JSC::JSValue strategy)
{
    auto result = InternalWritableStream::createFromUnderlyingSink(*JSC::jsCast<JSDOMGlobalObject*>(&globalObject), underlyingSink, strategy);
    if (result.hasException())
        return result.releaseException();

    return adoptRef(*new WritableStream(result.releaseReturnValue()));
}

ExceptionOr<Ref<WritableStream>> WritableStream::create(JSDOMGlobalObject& globalObject, Ref<WritableStreamSink>&& sink)
{
    return create(globalObject, toJSNewlyCreated(&globalObject, &globalObject, WTF::move(sink)), JSC::jsUndefined());
}

Ref<WritableStream> WritableStream::create(Ref<InternalWritableStream>&& internalWritableStream)
{
    return adoptRef(*new WritableStream(WTF::move(internalWritableStream)));
}

WritableStream::WritableStream(Ref<InternalWritableStream>&& internalWritableStream)
    : m_internalWritableStream(WTF::move(internalWritableStream))
{
}

JSC::JSValue JSWritableStream::abort(JSC::JSGlobalObject& globalObject, JSC::CallFrame& callFrame)
{
    return wrapped().internalWritableStream().abort(globalObject, callFrame.argument(0));
}

JSC::JSValue JSWritableStream::close(JSC::JSGlobalObject& globalObject, JSC::CallFrame&)
{
    return wrapped().internalWritableStream().close(globalObject);
}

JSC::JSValue JSWritableStream::getWriter(JSC::JSGlobalObject& globalObject, JSC::CallFrame&)
{
    return wrapped().internalWritableStream().getWriter(globalObject);
}

} // namespace WebCore
