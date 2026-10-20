/*
 * Copyright (C) 2019 Apple Inc. All rights reserved.
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

#include "config.h"
#include "EnterKeyHint.h"

#include "CommonAtomStrings.h"
#include <wtf/SortedArrayMap.h>

namespace WebCore {

EnterKeyHint enterKeyHintForAttributeValue(StringView value)
{
    static constexpr SortedArrayMap enterKeyHints { WTF::toArray<std::pair<PackedLettersLiteral<uint64_t>, EnterKeyHint>>({
        { "done"_s, EnterKeyHint::Done },
        { "enter"_s, EnterKeyHint::Enter },
        { "go"_s, EnterKeyHint::Go },
        { "next"_s, EnterKeyHint::Next },
        { "previous"_s, EnterKeyHint::Previous },
        { "search"_s, EnterKeyHint::Search },
        { "send"_s, EnterKeyHint::Send }
    }) };
    return enterKeyHints.get(value, EnterKeyHint::Unspecified);
}

String attributeValueForEnterKeyHint(EnterKeyHint hint)
{
    switch (hint) {
    case EnterKeyHint::Unspecified:
        return emptyAtom();
    case EnterKeyHint::Enter:
        return "enter"_s;
    case EnterKeyHint::Done:
        return "done"_s;
    case EnterKeyHint::Go:
        return "go"_s;
    case EnterKeyHint::Next:
        return "next"_s;
    case EnterKeyHint::Previous:
        return "previous"_s;
    case EnterKeyHint::Search:
        return searchAtom();
    case EnterKeyHint::Send:
        return "send"_s;
    }
    ASSERT_NOT_REACHED();
    return nullAtom();
}

} // namespace WebCore
