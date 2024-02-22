/*
 *  Copyright (C) 1999-2001 Harri Porten (porten@kde.org)
 *  Copyright (C) 2004-2011, 2013, 2016 Apple Inc. All rights reserved.
 *  Copyright (C) 2007 Samuel Weinig <sam@webkit.org>
 *  Copyright (C) 2013 Michael Pruett <michael@68k.org>
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Lesser General Public
 *  License as published by the Free Software Foundation; either
 *  version 2 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Lesser General Public License for more details.
 *
 *  You should have received a copy of the GNU Lesser General Public
 *  License along with this library; if not, write to the Free Software
 *  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 */

#include "config.h"
#include "JSDOMConvertDate.h"

#include <JavaScriptCore/DateInstance.h>
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>

namespace WebCore {
using namespace JSC;

JSValue jsDate(JSGlobalObject& lexicalGlobalObject, WallTime value)
{
    return DateInstance::create(lexicalGlobalObject.vm(), lexicalGlobalObject.dateStructure(), value.secondsSinceEpoch().milliseconds());
}

WallTime valueToDate(JSC::JSGlobalObject& lexicalGlobalObject, JSValue value)
{
    double milliseconds = std::numeric_limits<double>::quiet_NaN();

    auto& vm = lexicalGlobalObject.vm();
    if (value.inherits<DateInstance>())
        milliseconds = jsCast<DateInstance*>(value)->internalNumber();
    else if (value.isNumber())
        milliseconds = value.asNumber();
    else if (value.isString())
        milliseconds = vm.dateCache.parseDate(&lexicalGlobalObject, vm, value.getString(&lexicalGlobalObject));

    return WallTime::fromRawSeconds(Seconds::fromMilliseconds(milliseconds).value());
}

} // namespace WebCore
