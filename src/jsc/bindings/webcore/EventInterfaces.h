/*
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

#pragma once

namespace WebCore {

enum class EventInterfaceType : uint8_t {
    Invalid = 0,
    Event = 1,
    BeforeUnloadEvent = 2,
    ClipboardEvent = 3,
    CloseEvent = 4,
    CommandEvent = 5,
    CompositionEvent = 6,
    CustomEvent = 7,
    DragEvent = 8,
    ErrorEvent = 9,
    FocusEvent = 10,
    FormDataEvent = 11,
    HashChangeEvent = 12,
    InputEvent = 13,
    KeyboardEvent = 14,
    MessageEvent = 15,
    MouseEvent = 16,
    MutationEvent = 17,
    PageTransitionEvent = 18,
    PointerEvent = 19,
    PopStateEvent = 20,
    ProgressEvent = 21,
    PromiseRejectionEvent = 22,
    StorageEvent = 23,
    SubmitEvent = 24,
    TextEvent = 25,
    ToggleEvent = 26,
    UIEvent = 27,
    WheelEvent = 28,
    CSSAnimationEvent = 29,
    CSSTransitionEvent = 30,
    TouchEvent = 31,
};

} // namespace WebCore
