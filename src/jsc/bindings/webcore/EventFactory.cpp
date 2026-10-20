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
    switch (impl->interfaceType()) {
    case EventInterfaceType::Event: {
        return createWrapper<Event>(globalObject, WTF::move(impl));
    }
    case EventInterfaceType::CloseEvent: {
        return createWrapper<CloseEvent>(globalObject, WTF::move(impl));
    }
    case EventInterfaceType::CustomEvent: {
        return createWrapper<CustomEvent>(globalObject, WTF::move(impl));
    }
    case EventInterfaceType::ErrorEvent: {
        return createWrapper<ErrorEvent>(globalObject, WTF::move(impl));
    }
    case EventInterfaceType::MessageEvent:
        return createWrapper<MessageEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::BeforeUnloadEvent:
        return createWrapper<BeforeUnloadEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::ClipboardEvent:
        return createWrapper<ClipboardEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::CommandEvent:
        return createWrapper<CommandEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::CompositionEvent:
        return createWrapper<CompositionEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::DragEvent:
        return createWrapper<DragEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::FocusEvent:
        return createWrapper<FocusEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::FormDataEvent:
        return createWrapper<FormDataEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::HashChangeEvent:
        return createWrapper<HashChangeEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::InputEvent:
        return createWrapper<InputEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::KeyboardEvent:
        return createWrapper<KeyboardEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::MouseEvent:
        return createWrapper<MouseEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::PageTransitionEvent:
        return createWrapper<PageTransitionEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::PointerEvent:
        return createWrapper<PointerEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::PopStateEvent:
        return createWrapper<PopStateEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::ProgressEvent:
        return createWrapper<ProgressEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::PromiseRejectionEvent:
        return createWrapper<PromiseRejectionEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::StorageEvent:
        return createWrapper<StorageEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::SubmitEvent:
        return createWrapper<SubmitEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::TextEvent:
        return createWrapper<TextEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::ToggleEvent:
        return createWrapper<ToggleEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::TouchEvent:
        return createWrapper<TouchEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::UIEvent:
        return createWrapper<UIEvent>(globalObject, WTF::move(impl));
    case EventInterfaceType::WheelEvent:
        return createWrapper<WheelEvent>(globalObject, WTF::move(impl));
    default: {
        break;
    }
    }

    return createWrapper<Event>(globalObject, WTF::move(impl));
}

} // namespace WebCore
