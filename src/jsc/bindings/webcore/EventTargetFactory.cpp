/*
 * THIS FILE WAS AUTOMATICALLY GENERATED, DO NOT EDIT.
 *
 * Copyright (C) 2011 Google Inc.  All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY GOOGLE, INC. ``AS IS'' AND ANY
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
#include "EventTargetHeaders.h"
#include "JSDOMWrapperCache.h"

#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/StructureInlines.h>

namespace WebCore {

JSC::JSValue toJS(JSC::JSGlobalObject* state, JSDOMGlobalObject* globalObject, EventTarget& impl)
{
    switch (impl.eventTargetInterface()) {
    case EventTargetInterfaceType:
        break;
    case AbortSignalEventTargetInterfaceType:
        return toJS(state, globalObject, static_cast<AbortSignal&>(impl));
    case BroadcastChannelEventTargetInterfaceType:
        return toJS(state, globalObject, static_cast<BroadcastChannel&>(impl));
    case BunWebViewEventTargetInterfaceType:
        return Bun::toJS(state, globalObject, static_cast<Bun::WebViewEventTarget&>(impl));
    case DOMWindowEventTargetInterfaceType:
        // GlobalEventScope is the EventTarget behind globalThis.addEventListener(). Script sees the
        // global as its JSGlobalProxy, so event.target / currentTarget / listener `this` must be
        // that proxy; the JSGlobalObject cell itself is never === globalThis and JSValue::toThis
        // turns it into undefined in strict-mode listeners.
        return globalObject->globalThis();
    case MessagePortEventTargetInterfaceType:
        return toJS(state, globalObject, static_cast<MessagePort&>(impl));
    case WebSocketEventTargetInterfaceType:
        return toJS(state, globalObject, static_cast<WebSocket&>(impl));
    case WorkerEventTargetInterfaceType:
        return toJS(state, globalObject, static_cast<Worker&>(impl));
    default: {
        break;
    }
    }
    return wrap(state, globalObject, impl);
}

} // namespace WebCore
