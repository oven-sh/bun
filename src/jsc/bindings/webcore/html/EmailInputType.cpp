/*
 * This file is part of the WebKit project.
 *
 * Copyright (C) 2009 Michelangelo De Simone <micdesim@gmail.com>
 * Copyright (C) 2010 Google Inc. All rights reserved.
 * Copyright (C) 2018-2025 Apple Inc. All rights reserved.
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
 *
 */

#include "config.h"
#include "EmailInputType.h"

#include "HTMLInputElement.h"
#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include "InputTypeNames.h"
#include "LocalizedStrings.h"
#include <wtf/ASCIICType.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/StringBuilder.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(EmailInputType);

using namespace HTMLNames;

static bool isEmailLocalPartCharacter(char16_t character)
{
    if (isASCIIAlphanumeric(character))
        return true;

    switch (character) {
    case '.':
    case '!':
    case '#':
    case '$':
    case '%':
    case '&':
    case '\'':
    case '*':
    case '+':
    case '/':
    case '=':
    case '?':
    case '^':
    case '_':
    case '`':
    case '{':
    case '|':
    case '}':
    case '~':
    case '-':
        return true;
    }
    return false;
}

// Matches the regular expression in https://html.spec.whatwg.org/#valid-e-mail-address.
static bool isValidEmailAddress(StringView address)
{
    size_t atPosition = address.find('@');
    if (atPosition == notFound || !atPosition)
        return false;

    for (unsigned i = 0; i < atPosition; ++i) {
        if (!isEmailLocalPartCharacter(address[i]))
            return false;
    }

    // A label has 1 to 63 letters, digits and hyphens, and no hyphen at either end.
    unsigned length = address.length();
    unsigned labelLength = 0;
    for (unsigned i = atPosition + 1; i <= length; ++i) {
        if (i == length || address[i] == '.') {
            if (!labelLength || labelLength > 63 || address[i - 1] == '-')
                return false;
            labelLength = 0;
            continue;
        }
        auto character = address[i];
        if (!isASCIIAlphanumeric(character) && !(character == '-' && labelLength))
            return false;
        ++labelLength;
    }
    return true;
}

const AtomString& EmailInputType::formControlType() const
{
    return InputTypeNames::email();
}

bool EmailInputType::typeMismatchFor(StringView value) const
{
    ASSERT(element());
    if (value.isEmpty())
        return false;
    if (!element()->multiple())
        return !isValidEmailAddress(value);
    for (auto address : value.splitAllowingEmptyEntries(',')) {
        if (!isValidEmailAddress(address.trim(isASCIIWhitespace<char16_t>)))
            return true;
    }
    return false;
}

bool EmailInputType::typeMismatch() const
{
    ASSERT(element());
    return typeMismatchFor(protect(element())->value());
}

String EmailInputType::typeMismatchText() const
{
    ASSERT(element());
    return element()->multiple() ? validationMessageTypeMismatchForMultipleEmailText() : validationMessageTypeMismatchForEmailText();
}

bool EmailInputType::supportsSelectionAPI() const
{
    return false;
}

void EmailInputType::attributeChanged(const QualifiedName& name)
{
    if (name == multipleAttr) {
        Ref element = *this->element();
        element->setValueInternal(sanitizeValue(element->value()), TextFieldEventBehavior::DispatchNoEvent);
    }

    BaseTextInputType::attributeChanged(name);
}

ValueOrReference<String> EmailInputType::sanitizeValue(const String& proposedValue LIFETIME_BOUND) const
{
    // Passing a lambda instead of a function name helps the compiler inline isHTMLLineBreak.
    String noLineBreakValue = proposedValue;
    if (containsHTMLLineBreak(proposedValue)) [[unlikely]] {
        noLineBreakValue = proposedValue.removeCharacters([](auto character) {
            return isHTMLLineBreak(character);
        });
    }

    ASSERT(element());
    if (!element()->multiple())
        return noLineBreakValue.trim(isASCIIWhitespace);
    StringBuilder strippedValue;
    bool first = true;
    for (auto address : StringView(noLineBreakValue).splitAllowingEmptyEntries(',')) {
        if (!first)
            strippedValue.append(',');
        first = false;
        strippedValue.append(address.trim(isASCIIWhitespace));
    }
    return String { strippedValue.toString() };
}

} // namespace WebCore
