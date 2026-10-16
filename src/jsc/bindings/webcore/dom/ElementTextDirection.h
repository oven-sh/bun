/*
 * Copyright (C) 2024 Apple Inc. All rights reserved.
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
 */

#pragma once

#include <optional>

namespace WTF {
class AtomString;
};

namespace WebCore {

class Element;

enum class TextDirection : bool;

// https://html.spec.whatwg.org/multipage/dom.html#attr-dir
enum class TextDirectionState : uint8_t {
    LTR,
    RTL,
    Auto,
    Undefined,
};

TextDirectionState parseTextDirectionState(const WTF::AtomString&);
TextDirectionState elementTextDirectionState(const Element&);

bool elementHasValidTextDirectionState(const Element&);
bool elementHasAutoTextDirectionState(const Element&);

std::optional<TextDirection> computeAutoDirectionality(const Element&);
std::optional<TextDirection> computeTextDirectionIfDirIsAuto(const Element&);

void textDirectionStateChanged(Element&, TextDirectionState);

void updateEffectiveTextDirectionState(Element&, TextDirectionState, Element* initiator = nullptr);
void updateEffectiveTextDirectionOfDescendants(Element&, std::optional<TextDirection>, Element* initiator = nullptr);
void updateEffectiveTextDirectionOfAncestors(Element&, Element* initiator);

} // namespace WebCore
