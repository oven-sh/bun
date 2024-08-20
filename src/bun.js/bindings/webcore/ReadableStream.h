/*
 * Copyright (C) 2017-2020 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY CANON INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL CANON INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "ExceptionOr.h"
#include "JSDOMBinding.h"
#include "JSDOMConvert.h"
#include "JSDOMGuardedObject.h"
#include "JSReadableStream.h"

namespace WebCore {

class ReadableStreamSink;
class ReadableStreamSource;

class ReadableStream final : public DOMGuarded<JSReadableStream> {
public:
    static Ref<ReadableStream> create(JSDOMGlobalObject& globalObject, JSReadableStream& readableStream) { return adoptRef(*new ReadableStream(globalObject, readableStream)); }

    static ExceptionOr<Ref<ReadableStream>> create(JSC::JSGlobalObject&, RefPtr<ReadableStreamSource>&&);
    static ExceptionOr<Ref<ReadableStream>> create(JSC::JSGlobalObject& lexicalGlobalObject, RefPtr<ReadableStreamSource>&& source, JSC::JSValue nativePtr);

    WEBCORE_EXPORT static bool isDisturbed(JSC::JSGlobalObject*, JSReadableStream*);
    WEBCORE_EXPORT static bool isLocked(JSC::JSGlobalObject*, JSReadableStream*);
    WEBCORE_EXPORT static void cancel(WebCore::JSDOMGlobalObject& globalObject, JSReadableStream*, const WebCore::Exception& exception);

    std::optional<std::pair<Ref<ReadableStream>, Ref<ReadableStream>>> tee();

    void cancel(const Exception&);
    void lock();
    void pipeTo(ReadableStreamSink&);
    bool isLocked() const;
    bool isDisturbed() const;

    JSReadableStream* readableStream() const
    {
        return guarded();
    }

    ReadableStream(JSDOMGlobalObject& globalObject, JSReadableStream& readableStream)
        : DOMGuarded<JSReadableStream>(globalObject, readableStream)
    {
    }
};

struct JSReadableStreamWrapperConverter {
    static RefPtr<ReadableStream> toWrapped(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        auto* globalObject = JSC::jsDynamicCast<JSDOMGlobalObject*>(&lexicalGlobalObject);
        if (!globalObject)
            return nullptr;

        auto* readableStream = JSC::jsDynamicCast<JSReadableStream*>(value);
        if (!readableStream)
            return nullptr;

        return ReadableStream::create(*globalObject, *readableStream);
    }
};

template<> struct JSDOMWrapperConverterTraits<ReadableStream> {
    using WrapperClass = JSReadableStreamWrapperConverter;
    using ToWrappedReturnType = RefPtr<ReadableStream>;
    static constexpr bool needsState = true;
};

inline JSC::JSValue toJS(JSC::JSGlobalObject*, JSC::JSGlobalObject*, ReadableStream* stream)
{
    return stream ? stream->readableStream() : JSC::jsUndefined();
}

inline JSC::JSValue toJS(JSC::JSGlobalObject*, JSC::JSGlobalObject*, ReadableStream& stream)
{
    return stream.readableStream();
}

inline JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject*, Ref<ReadableStream>&& stream)
{
    return stream->readableStream();
}

JSC_DECLARE_HOST_FUNCTION(jsFunctionTransferToNativeReadableStream);

}
