/*
 * Copyright (C) 2020-2021 Apple Inc. All rights reserved.
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
#include "JSDOMGuardedObject.h"
#include <JavaScriptCore/JSObject.h>

namespace WebCore {
class InternalWritableStream final : public DOMGuarded<JSC::JSObject> {
public:
    static ExceptionOr<Ref<InternalWritableStream>> createFromUnderlyingSink(JSDOMGlobalObject&, JSC::JSValue underlyingSink, JSC::JSValue strategy);
    static Ref<InternalWritableStream> fromObject(JSDOMGlobalObject&, JSC::JSObject&);

    operator JSC::JSValue() const { return guarded(); }

    bool locked() const;
    void lock();
    JSC::JSValue abort(JSC::JSGlobalObject&, JSC::JSValue);
    JSC::JSValue close(JSC::JSGlobalObject&);
    JSC::JSValue getWriter(JSC::JSGlobalObject&);

private:
    InternalWritableStream(JSDOMGlobalObject& globalObject, JSC::JSObject& jsObject)
        : DOMGuarded<JSC::JSObject>(globalObject, jsObject)
    {
    }
};

}
