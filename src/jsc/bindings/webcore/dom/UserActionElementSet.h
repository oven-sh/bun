/*
 * Copyright (C) 2012 Google Inc. All rights reserved.
 * Copyright (C) 2013-2017 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
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

#include <wtf/Forward.h>
#include <wtf/HashMap.h>
#include <wtf/OptionSet.h>
#include <wtf/OptionSetHash.h>
#include <wtf/Ref.h>
#include <wtf/WeakHashMap.h>

namespace WebCore {

class Element;
class WeakPtrImplWithEventTargetData;

class UserActionElementSet {
public:
    bool isActive(const Element& element) { return hasFlag(element, Flag::IsActive); }
    bool isFocused(const Element& element) { return hasFlag(element, Flag::IsFocused); }
    bool isHovered(const Element& element) { return hasFlag(element, Flag::IsHovered); }
    bool isInActiveChain(const Element& element) { return hasFlag(element, Flag::InActiveChain); }
    bool isBeingDragged(const Element& element) { return hasFlag(element, Flag::IsBeingDragged); }
    bool hasFocusVisible(const Element& element) { return hasFlag(element, Flag::HasFocusVisible); }
    bool hasFocusWithin(const Element& element) { return hasFlag(element, Flag::HasFocusWithin); }

    void setActive(Element& element, bool enable) { setFlags(element, enable, Flag::IsActive); }
    void setFocused(Element& element, bool enable) { setFlags(element, enable, Flag::IsFocused); }
    void setHovered(Element& element, bool enable) { setFlags(element, enable, Flag::IsHovered); }
    void setInActiveChain(Element& element, bool enable) { setFlags(element, enable, Flag::InActiveChain); }
    void setBeingDragged(Element& element, bool enable) { setFlags(element, enable, Flag::IsBeingDragged); }
    void setHasFocusVisible(Element& element, bool enable) { setFlags(element, enable, Flag::HasFocusVisible); }
    void setHasFocusWithin(Element& element, bool enable) { setFlags(element, enable, Flag::HasFocusWithin); }

    void clearActiveAndHovered(Element& element) { clearFlags(element, { Flag::IsActive, Flag::InActiveChain, Flag::IsHovered }); }
    void clearAllForElement(Element& element) { clearFlags(element, { Flag::IsActive, Flag::InActiveChain, Flag::IsHovered, Flag::IsFocused, Flag::IsBeingDragged, Flag::HasFocusVisible, Flag::HasFocusWithin }); }

    void clear();

private:
    enum class Flag {
        IsActive        = 1 << 0,
        InActiveChain   = 1 << 1,
        IsHovered       = 1 << 2,
        IsFocused       = 1 << 3,
        IsBeingDragged  = 1 << 4,
        HasFocusVisible = 1 << 5,
        HasFocusWithin  = 1 << 6,
    };

    void setFlags(Element& element, bool enable, OptionSet<Flag> flags) { enable ? setFlags(element, flags) : clearFlags(element, flags); }
    void setFlags(Element&, OptionSet<Flag>);
    void clearFlags(Element&, OptionSet<Flag>);
    bool LEGACY_NODELETE hasFlag(const Element&, Flag) const;

    WeakHashMap<Element, OptionSet<Flag>, WeakPtrImplWithEventTargetData> m_elements;
};

} // namespace WebCore
