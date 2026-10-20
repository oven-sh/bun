/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
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

#include "StaticRange.h"
#include "UIEvent.h"

namespace WebCore {

enum class IsInputMethodComposing : bool { No, Yes };

class InputEvent final : public UIEvent {
    WTF_MAKE_TZONE_ALLOCATED(InputEvent);
public:
    struct Init : UIEventInit {
        String data;
        bool isComposing { false }; // input method
        String inputType;
    };

    virtual ~InputEvent();

    static Ref<InputEvent> create(const AtomString& eventType, const String& inputType, IsCancelable, RefPtr<Window>&& view,
        const String& data, const Vector<Ref<StaticRange>>& targetRanges, int detail, IsInputMethodComposing);

    static Ref<InputEvent> create(const AtomString& type, const Init& initializer)
    {
        return adoptRef(*new InputEvent(type, initializer));
    }

    const String& inputType() const LIFETIME_BOUND { return m_inputType; }
    const String& data() const LIFETIME_BOUND { return m_data; }
    const Vector<Ref<StaticRange>>& getTargetRanges() LIFETIME_BOUND { return m_targetRanges; }
    bool isInputMethodComposing() const { return m_isInputMethodComposing; }

private:
    InputEvent(const AtomString& eventType, const String& inputType, IsCancelable, RefPtr<Window>&&,
        const String& data, const Vector<Ref<StaticRange>>& targetRanges, int detail, IsInputMethodComposing);
    InputEvent(const AtomString& eventType, const Init&);

    String m_inputType;
    String m_data;
    Vector<Ref<StaticRange>> m_targetRanges;
    bool m_isInputMethodComposing;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_EVENT(InputEvent)
