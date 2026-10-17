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
    case EventTargetInterfaceType::Invalid:
        ASSERT_NOT_REACHED();
        break;
    case EventTargetInterfaceType::EventTarget:
        break;
    case EventTargetInterfaceType::AbortSignal:
        return toJS(state, globalObject, static_cast<AbortSignal&>(impl));
    case EventTargetInterfaceType::BroadcastChannel:
        return toJS(state, globalObject, static_cast<BroadcastChannel&>(impl));
    case EventTargetInterfaceType::BunWebView:
        return Bun::toJS(state, globalObject, static_cast<Bun::WebViewEventTarget&>(impl));
    case EventTargetInterfaceType::DOMWindow:
        return globalObject;
    case EventTargetInterfaceType::FileReader:
        return toJS(state, globalObject, static_cast<FileReader&>(impl));
    case EventTargetInterfaceType::MessagePort:
        return toJS(state, globalObject, static_cast<MessagePort&>(impl));
    case EventTargetInterfaceType::Node:
        return toJS(state, globalObject, downcast<Node>(impl));
    case EventTargetInterfaceType::WebSocket:
        return toJS(state, globalObject, static_cast<WebSocket&>(impl));
    case EventTargetInterfaceType::Window:
        return toJS(state, globalObject, static_cast<Window&>(impl));
    case EventTargetInterfaceType::Worker:
        return toJS(state, globalObject, static_cast<Worker&>(impl));
    case EventTargetInterfaceType::XMLHttpRequest:
        return toJS(state, globalObject, static_cast<XMLHttpRequest&>(impl));
    case EventTargetInterfaceType::XMLHttpRequestUpload:
        return toJS(state, globalObject, static_cast<XMLHttpRequestUpload&>(impl));
    default: {
        break;
    }
    }
    return wrap(state, globalObject, impl);
}

} // namespace WebCore
