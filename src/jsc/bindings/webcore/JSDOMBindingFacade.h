/*
 * Copyright (C) 2026 Apple Inc. All rights reserved.
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

// Upstream's generated bindings reach JSC through these free functions so that
// they can avoid including the JSC inline headers. Bun's bindings include them
// anyway, so here the facade is just inline forwarding.

#include "root.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace WebCore {

inline void putDirectWithoutTransition(JSC::JSObject* object, JSC::VM& vm, JSC::PropertyName propertyName, JSC::JSValue value, unsigned attributes)
{
    object->putDirectWithoutTransition(vm, propertyName, value, attributes);
}

inline JSC::JSValue get(const JSC::JSObject* object, JSC::JSGlobalObject* globalObject, JSC::PropertyName propertyName)
{
    return object->get(globalObject, propertyName);
}

inline JSC::JSValue getDirect(const JSC::JSObject* object, JSC::VM& vm, JSC::PropertyName propertyName)
{
    return object->getDirect(vm, propertyName);
}

inline JSC::JSObject* constructEmptyObject(JSC::JSGlobalObject* globalObject)
{
    return JSC::constructEmptyObject(globalObject);
}

inline JSC::JSObject* constructEmptyObject(JSC::JSGlobalObject* globalObject, JSC::JSObject* prototype)
{
    return JSC::constructEmptyObject(globalObject, prototype);
}

} // namespace WebCore
