/*
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

#pragma once

#include <wtf/text/AtomString.h>

namespace WebCore {

namespace InputTypeNames {

const AtomString& LEGACY_NODELETE button();
const AtomString& checkbox();
const AtomString& color();
const AtomString& date();
const AtomString& datetimelocal();
const AtomString& LEGACY_NODELETE email();
const AtomString& file();
const AtomString& hidden();
const AtomString& image();
const AtomString& month();
const AtomString& number();
const AtomString& password();
const AtomString& radio();
const AtomString& range();
const AtomString& LEGACY_NODELETE reset();
const AtomString& LEGACY_NODELETE search();
const AtomString& LEGACY_NODELETE submit();
const AtomString& LEGACY_NODELETE telephone();
const AtomString& LEGACY_NODELETE text();
const AtomString& time();
const AtomString& LEGACY_NODELETE url();
const AtomString& week();

}

} // namespace WebCore
