/*
 * Copyright (C) 2018 Apple Inc. All rights reserved.
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
#include "InputMode.h"

#include "CommonAtomStrings.h"
#include "FormAtomStrings.h"

namespace WebCore {

InputMode inputModeForAttributeValue(const AtomString& value)
{
    if (equalIgnoringASCIICase(value, InputModeNames::none()))
        return InputMode::None;
    if (equalIgnoringASCIICase(value, InputModeNames::text()))
        return InputMode::Text;
    if (equalIgnoringASCIICase(value, InputModeNames::tel()))
        return InputMode::Telephone;
    if (equalIgnoringASCIICase(value, InputModeNames::url()))
        return InputMode::Url;
    if (equalIgnoringASCIICase(value, InputModeNames::email()))
        return InputMode::Email;
    if (equalIgnoringASCIICase(value, InputModeNames::numeric()))
        return InputMode::Numeric;
    if (equalIgnoringASCIICase(value, InputModeNames::decimal()))
        return InputMode::Decimal;
    if (equalIgnoringASCIICase(value, InputModeNames::search()))
        return InputMode::Search;

    return InputMode::Unspecified;
}

const AtomString& stringForInputMode(InputMode mode)
{
    switch (mode) {
    case InputMode::Unspecified:
        return emptyAtom();
    case InputMode::None:
        return InputModeNames::none();
    case InputMode::Text:
        return InputModeNames::text();
    case InputMode::Telephone:
        return InputModeNames::tel();
    case InputMode::Url:
        return InputModeNames::url();
    case InputMode::Email:
        return InputModeNames::email();
    case InputMode::Numeric:
        return InputModeNames::numeric();
    case InputMode::Decimal:
        return InputModeNames::decimal();
    case InputMode::Search:
        return InputModeNames::search();
    }

    return emptyAtom();
}

namespace InputModeNames {

const AtomString& none()
{
    return noneAtom();
}

const AtomString& text()
{
    return textAtom();
}

const AtomString& tel()
{
    return telAtom();
}

const AtomString& url()
{
    return urlAtom();
}

const AtomString& email()
{
    return emailAtom();
}

const AtomString& numeric()
{
    return formAtomStrings().numeric;
}

const AtomString& decimal()
{
    return formAtomStrings().decimal;
}

const AtomString& search()
{
    return searchAtom();
}

} // namespace InputModeNames

} // namespace WebCore
