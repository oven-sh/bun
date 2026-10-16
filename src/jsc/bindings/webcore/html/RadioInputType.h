/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
 * Copyright (C) 2016 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "BaseCheckableInputType.h"
#include <wtf/TZoneMalloc.h>

namespace WebCore {

enum class WasSetByJavaScript : bool;

class RadioInputType final : public BaseCheckableInputType {
    WTF_MAKE_TZONE_ALLOCATED(RadioInputType);
public:
    static Ref<RadioInputType> create(HTMLInputElement& element)
    {
        return adoptRef(*new RadioInputType(element));
    }

    static void forEachButtonInDetachedGroup(ContainerNode& rootName, const String& groupName, NOESCAPE const Function<bool(HTMLInputElement&)>&);

    bool valueMissing(StringView) const final;

private:
    explicit RadioInputType(HTMLInputElement& element)
        : BaseCheckableInputType(Type::Radio, element)
    {
    }

    const AtomString& formControlType() const final;
    String valueMissingText() const final;
    void handleClickEvent(MouseEvent&) final;
    ShouldCallBaseEventHandler handleKeydownEvent(KeyboardEvent&) final;
    void handleKeyupEvent(KeyboardEvent&) final;
    bool isKeyboardFocusable(const FocusEventData&) const final;
    bool shouldSendChangeEventAfterCheckedChanged() final;
    void willDispatchClick(InputElementClickState&) final;
    void didDispatchClick(Event&, const InputElementClickState&) final;
    bool matchesIndeterminatePseudoClass() const final;
    void willUpdateCheckedness(bool /* nowChecked */, WasSetByJavaScript) final;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_INPUT_TYPE(RadioInputType, Type::Radio)
