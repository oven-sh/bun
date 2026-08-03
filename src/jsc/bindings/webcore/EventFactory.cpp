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
#include "EventHeaders.h"
#include "JSDOMWrapperCache.h"
#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/StructureInlines.h>

namespace WebCore {

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<Event>&& impl)
{
    switch (impl->eventInterface()) {
    case EventInterfaceType: {
        return createWrapper<Event>(globalObject, WTF::move(impl));
    }
    case ClipboardEventInterfaceType: {
        return createWrapper<ClipboardEvent>(globalObject, WTF::move(impl));
    }
    case CloseEventInterfaceType: {
        return createWrapper<CloseEvent>(globalObject, WTF::move(impl));
    }
    case ErrorEventInterfaceType: {
        return createWrapper<ErrorEvent>(globalObject, WTF::move(impl));
    }
    case MessageEventInterfaceType:
        return createWrapper<MessageEvent>(globalObject, WTF::move(impl));
    default: {
        break;
    }
    }

    return createWrapper<Event>(globalObject, WTF::move(impl));
}

} // namespace WebCore
