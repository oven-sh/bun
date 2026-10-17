/*
 * Copyright (C) 2003 Lars Knoll (knoll@kde.org)
 * Copyright (C) 2005 Allan Sandfeld Jensen (kde@carewolf.com)
 * Copyright (C) 2004-2012, 2016 Apple Inc. All rights reserved.
 * Copyright (C) 2007 Nicholas Shanks <webkit@nickshanks.com>
 * Copyright (C) 2008 Eric Seidel <eric@webkit.org>
 * Copyright (C) 2009 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
 * Copyright (C) 2012 Adobe Systems Incorporated. All rights reserved.
 * Copyright (C) 2012 Intel Corporation. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 */

#include "config.h"
#include "CSSMarkup.h"

#include <wtf/HexNumber.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/unicode/CharacterNames.h>

namespace WebCore {

static void serializeCharacter(StringBuilder& appendTo, char32_t c)
{
    appendTo.append('\\', c);
}

static void serializeCharacterAsEscapeSequence(StringBuilder& appendTo, char32_t c)
{
    appendTo.append('\\', hex(c, Lowercase), ' ');
}

void serializeIdentifier(StringBuilder& appendTo, StringView identifier)
{
    bool isFirst = true;
    bool isSecond = false;
    bool isFirstCharHyphen = false;
    unsigned index = 0;
    while (index < identifier.length()) {
        char32_t c = identifier.codePointAt(index);

        index += U16_LENGTH(c);

        if (!c)
            appendTo.append(replacementCharacter);
        else if (c <= 0x1f || c == deleteCharacter || (0x30 <= c && c <= 0x39 && (isFirst || (isSecond && isFirstCharHyphen))))
            serializeCharacterAsEscapeSequence(appendTo, c);
        else if (c == hyphenMinus && isFirst && index == identifier.length())
            serializeCharacter(appendTo, c);
        else if (0x80 <= c || c == hyphenMinus || c == lowLine || (0x30 <= c && c <= 0x39) || (0x41 <= c && c <= 0x5a) || (0x61 <= c && c <= 0x7a))
            appendTo.append(c);
        else
            serializeCharacter(appendTo, c);

        if (isFirst) {
            isFirst = false;
            isSecond = true;
            isFirstCharHyphen = (c == hyphenMinus);
        } else if (isSecond)
            isSecond = false;
    }
}

} // namespace WebCore
