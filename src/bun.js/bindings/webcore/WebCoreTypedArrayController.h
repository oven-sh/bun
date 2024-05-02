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

#pragma once

#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/TypedArrayController.h>

namespace WebCore {

class WebCoreTypedArrayController : public JSC::TypedArrayController {
public:
    WebCoreTypedArrayController(bool allowAtomicsWait);
    virtual ~WebCoreTypedArrayController();

    JSC::JSArrayBuffer* toJS(JSC::JSGlobalObject*, JSC::JSGlobalObject*, JSC::ArrayBuffer*) override;
    void registerWrapper(JSC::JSGlobalObject*, ArrayBuffer*, JSC::JSArrayBuffer*) override;
    bool isAtomicsWaitAllowedOnCurrentThread() override;

    JSC::WeakHandleOwner* wrapperOwner() { return &m_owner; }

private:
    class JSArrayBufferOwner : public JSC::WeakHandleOwner {
    public:
        bool isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown>, void* context, JSC::AbstractSlotVisitor&, ASCIILiteral*) override;
        void finalize(JSC::Handle<JSC::Unknown>, void* context) override;
    };

    JSArrayBufferOwner m_owner;
    bool m_allowAtomicsWait;
};

} // namespace WebCore