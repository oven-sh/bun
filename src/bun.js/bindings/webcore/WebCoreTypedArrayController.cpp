/*
 * Copyright (C) 2013-2021 Apple Inc. All rights reserved.
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

#include "root.h"

#include "WebCoreTypedArrayController.h"

#include "JSDOMConvertBufferSource.h"

#include "JSDOMGlobalObject.h"

#include <JavaScriptCore/ArrayBuffer.h>

#include <JavaScriptCore/JSArrayBuffer.h>

static inline WebCore::JSDOMGlobalObject* getDefaultGlobal(JSC::JSGlobalObject* lexicalGlobalObject)
{
    return defaultGlobalObject(lexicalGlobalObject);
}

namespace WebCore {

WebCoreTypedArrayController::WebCoreTypedArrayController(bool allowAtomicsWait)
    : m_allowAtomicsWait(allowAtomicsWait)
{
}

WebCoreTypedArrayController::~WebCoreTypedArrayController() = default;

JSC::JSArrayBuffer* WebCoreTypedArrayController::toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSGlobalObject* globalObject, JSC::ArrayBuffer* buffer)
{
    return JSC::jsCast<JSC::JSArrayBuffer*>(WebCore::toJS(lexicalGlobalObject, getDefaultGlobal(globalObject), buffer));
}

void WebCoreTypedArrayController::registerWrapper(JSC::JSGlobalObject* globalObject, JSC::ArrayBuffer* native, JSC::JSArrayBuffer* wrapper)
{
    cacheWrapper(static_cast<JSVMClientData*>(JSC::getVM(globalObject).clientData)->normalWorld(), native, wrapper);
}

bool WebCoreTypedArrayController::isAtomicsWaitAllowedOnCurrentThread()
{
    return m_allowAtomicsWait;
}

bool WebCoreTypedArrayController::JSArrayBufferOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, JSC::AbstractSlotVisitor& visitor, ASCIILiteral* reason)
{
    if (UNLIKELY(reason))
        *reason = "ArrayBuffer is opaque root"_s;
    auto& wrapper = *JSC::jsCast<JSC::JSArrayBuffer*>(handle.slot()->asCell());
    return visitor.containsOpaqueRoot(wrapper.impl());
}

void WebCoreTypedArrayController::JSArrayBufferOwner::finalize(JSC::Handle<JSC::Unknown> handle, void* context)
{
    auto& wrapper = *static_cast<JSC::JSArrayBuffer*>(handle.slot()->asCell());
    uncacheWrapper(*static_cast<DOMWrapperWorld*>(context), wrapper.impl(), &wrapper);
}

} // namespace WebCore
