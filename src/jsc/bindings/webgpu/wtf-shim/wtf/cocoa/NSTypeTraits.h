/*
 *  Copyright (C) 2026 Fady Farag.
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Library General Public
 *  License as published by the Free Software Foundation; either
 *  version 2 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Library General Public License for more details.
 *
 *  You should have received a copy of the GNU Library General Public License
 *  along with this library; see the file COPYING.LIB.  If not, write to
 *  the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 *  Boston, MA 02110-1301, USA.
 */

// Copied from WebKit's Source/WTF/wtf/cocoa/NSTypeTraits.h; see ../../README.md.
#pragma once

#include <concepts>
#include <wtf/Forward.h>
#include <wtf/Platform.h>

#ifdef __OBJC__
#import <Foundation/Foundation.h>
#elif USE(CF)
#include <CoreFoundation/CoreFoundation.h>
#endif

namespace WTF {

template<typename T> inline constexpr bool IsNSType = std::convertible_to<T, id>;
template<typename T> concept NSType = IsNSType<T>;

} // namespace WTF

using WTF::IsNSType;
using WTF::NSType;
