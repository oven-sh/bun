/*
 * Copyright (C) 2012 Apple Inc. All rights reserved.
 * Copyright (C) 2010, 2012 Google Inc. All rights reserved.
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
#include "InputTypeNames.h"

#include "CommonAtomStrings.h"
#include "FormAtomStrings.h"
#include "HTMLNames.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(FormAtomStrings);

namespace InputTypeNames {

// The type names must be lowercased because they will be the return values of
// input.type and input.type must be lowercase according to DOM Level 2.

const AtomString& button()
{
    return HTMLNames::buttonTag->localName();
}

const AtomString& checkbox()
{
    return formAtomStrings().checkbox;
}

const AtomString& color()
{
    return formAtomStrings().color;
}

const AtomString& date()
{
    return formAtomStrings().date;
}

const AtomString& datetimelocal()
{
    return formAtomStrings().datetimeLocal;
}

const AtomString& email()
{
    return emailAtom();
}

const AtomString& file()
{
    return formAtomStrings().file;
}

const AtomString& hidden()
{
    return formAtomStrings().hidden;
}

const AtomString& image()
{
    return formAtomStrings().image;
}

const AtomString& month()
{
    return formAtomStrings().month;
}

const AtomString& number()
{
    return formAtomStrings().number;
}

const AtomString& password()
{
    return formAtomStrings().password;
}

const AtomString& radio()
{
    return formAtomStrings().radio;
}

const AtomString& range()
{
    return formAtomStrings().range;
}

const AtomString& reset()
{
    return resetAtom();
}

const AtomString& search()
{
    return searchAtom();
}

const AtomString& submit()
{
    return submitAtom();
}

const AtomString& telephone()
{
    return telAtom();
}

const AtomString& text()
{
    return textAtom();
}

const AtomString& time()
{
    return formAtomStrings().time;
}

const AtomString& url()
{
    return urlAtom();
}

const AtomString& week()
{
    return formAtomStrings().week;
}

} // namespace WebCore::InputTypeNames

} // namespace WebCore
