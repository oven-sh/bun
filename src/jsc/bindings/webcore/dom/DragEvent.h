/*
 * Copyright (C) 2020 Apple Inc. All rights reserved.
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

#include "JSValueInWrappedObject.h"
#include "MouseEvent.h"
#include "MouseEventInit.h"

namespace WebCore {

struct DragEventInit : public MouseEventInit {
    JSC::JSValue dataTransfer;
};

class DragEvent final : public MouseEvent {
    WTF_MAKE_TZONE_ALLOCATED(DragEvent);
public:
    using Init = DragEventInit;

    static Ref<DragEvent> create(const AtomString& eventType, Init&&);
    static Ref<DragEvent> createForBindings();

    virtual ~DragEvent();

    const JSValueInWrappedObject& dataTransfer() const LIFETIME_BOUND { return m_dataTransfer; }

private:
    DragEvent(const AtomString& eventType, Init&&);
    DragEvent();

    JSValueInWrappedObject m_dataTransfer { JSC::jsNull() };
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_EVENT(DragEvent)
