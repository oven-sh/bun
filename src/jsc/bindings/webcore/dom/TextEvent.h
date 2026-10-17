/*
 * Copyright (C) 2007, 2008 Apple Inc. All rights reserved.
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
 *
 */

#pragma once

#include "TextEventInputType.h"
#include "UIEvent.h"

namespace WebCore {

    class TextEvent final : public UIEvent {
        WTF_MAKE_TZONE_ALLOCATED(TextEvent);
    public:
        static Ref<TextEvent> create(RefPtr<Window>&&, const String& data, TextEventInputType = TextEventInputKeyboard);
        static Ref<TextEvent> createForBindings();

        virtual ~TextEvent();
    
        WEBCORE_EXPORT void initTextEvent(const AtomString& type, bool canBubble, bool cancelable, RefPtr<Window>&&, const String& data);
    
        String data() const { return m_data; }

        bool isLineBreak() const { return m_inputType == TextEventInputLineBreak; }
        bool isComposition() const { return m_inputType == TextEventInputComposition; }
        bool isBackTab() const { return m_inputType == TextEventInputBackTab; }
        bool isPaste() const { return m_inputType == TextEventInputPaste; }
        bool isDrop() const { return m_inputType == TextEventInputDrop; }
        bool isDictation() const { return m_inputType == TextEventInputDictation; }
        bool isAutocompletion() const { return m_inputType == TextEventInputAutocompletion; }
        bool isKeyboard() const { return m_inputType == TextEventInputKeyboard; }
        bool isRemoveBackground() const { return m_inputType == TextEventInputRemoveBackground; }

    private:
        TextEvent();

        TextEvent(RefPtr<Window>&&, const String& data, TextEventInputType = TextEventInputKeyboard);

        TextEventInputType m_inputType { TextEventInputKeyboard };
        String m_data;
    };

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_EVENT(TextEvent)
