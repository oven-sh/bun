/*
 * Copyright (C) 2008-2021 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "JSXMLHttpRequest.h"

#include "JSBlob.h"
#include "JSDOMConvertBufferSource.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertJSON.h"
#include "JSDOMConvertNullable.h"
#include "JSDOMConvertStrings.h"
#include "JSDocument.h"
#include "WebCoreOpaqueRootInlines.h"
#include "XMLHttpRequestUpload.h"

// The wrapper takes over the caller's reference to the blob.
extern "C" SYSV_ABI JSC::EncodedJSValue Blob__create(JSC::JSGlobalObject*, void* blob);

namespace WebCore {
using namespace JSC;

template<typename Visitor>
void JSXMLHttpRequest::visitAdditionalChildrenInGCThread(Visitor& visitor)
{
    // Do not ref `wrapped()` here since this function may get called on a GC thread.
    SUPPRESS_UNCOUNTED_ARG wrapped().visitAdditionalChildrenInGCThread(visitor);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN_IN_GC_THREAD(JSXMLHttpRequest);

JSValue JSXMLHttpRequest::response(JSGlobalObject& lexicalGlobalObject) const
{
    auto cacheResult = [&] (JSValue value) -> JSValue {
        m_response.set(lexicalGlobalObject.vm(), this, value);
        return value;
    };


    if (wrapped().responseCacheIsValid())
        return m_response.get();

    auto type = wrapped().responseType();

    switch (type) {
    case XMLHttpRequest::ResponseType::EmptyString:
    case XMLHttpRequest::ResponseType::Text: {
        auto scope = DECLARE_THROW_SCOPE(lexicalGlobalObject.vm());
        return cacheResult(toJS<IDLNullable<IDLUSVString>>(lexicalGlobalObject, scope, protect(wrapped())->responseText()));
    }
    default:
        break;
    }

    if (!wrapped().doneWithoutErrors())
        return cacheResult(jsNull());

    JSValue value;
    switch (type) {
    case XMLHttpRequest::ResponseType::EmptyString:
    case XMLHttpRequest::ResponseType::Text:
        ASSERT_NOT_REACHED();
        return jsUndefined();

    case XMLHttpRequest::ResponseType::Json:
        value = toJS<IDLJSON>(*realm(), protect(wrapped())->responseTextIgnoringResponseType());
        if (!value)
            value = jsNull();
        break;

    case XMLHttpRequest::ResponseType::Document: {
        auto document = protect(wrapped())->responseXML();
        ASSERT(!document.hasException());
        value = toJS<IDLNullable<IDLInterface<Document>>>(lexicalGlobalObject, *realm(), document.releaseReturnValue());
        break;
    }

    case XMLHttpRequest::ResponseType::Blob:
        value = JSValue::decode(Blob__create(&lexicalGlobalObject, protect(wrapped())->createResponseBlob().leakRef()));
        break;

    case XMLHttpRequest::ResponseType::Arraybuffer:
        value = toJS<IDLNullable<IDLArrayBuffer>>(lexicalGlobalObject, *realm(), protect(wrapped())->createResponseArrayBuffer());
        break;
    }

    protect(wrapped())->didCacheResponse();
    return cacheResult(value);
}

} // namespace WebCore
