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
#include "BaseTextInputType.h"

#include "Document.h"
#include "ElementInlines.h"
#include "HTMLInputElement.h"
#include "HTMLNames.h"
#include <JavaScriptCore/RegularExpression.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(BaseTextInputType);

using namespace HTMLNames;

bool BaseTextInputType::patternMismatch(StringView value) const
{
    ASSERT(element());
    Ref element = *this->element();
    const AtomString& rawPattern = element->attributeWithoutSynchronization(patternAttr);
    if (rawPattern.isNull() || value.isEmpty())
        return false;

    JSC::Yarr::RegularExpression regex(rawPattern, { JSC::Yarr::Flags::UnicodeSets }, JSC::Yarr::MatchMode::EntireInput);
    if (!regex.isValid())
        return false;

    auto valuePatternMismatch = [&regex](auto value) {
        int matchLength = 0;
        int valueLength = value.length();
        int matchOffset = regex.match(value, 0, &matchLength);
        return matchOffset || matchLength != valueLength;
    };

    if (isEmailField() && element->multiple()) {
        for (auto splitValue : value.split(',')) {
            if (valuePatternMismatch(splitValue))
                return true;
        }
        return false;
    }
    return valuePatternMismatch(value);
}

bool BaseTextInputType::supportsPlaceholder() const
{
    return true;
}

bool BaseTextInputType::supportsSelectionAPI() const
{
    return true;
}

bool BaseTextInputType::dirAutoUsesValue() const
{
    return true;
}

} // namespace WebCore
