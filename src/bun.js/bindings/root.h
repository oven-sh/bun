#pragma once

#ifndef BUN__ROOT__H
#define BUN__ROOT__H

/*
 * Copyright (C) 2006-2021 Apple Inc. All rights reserved.
 * Copyright (C) 2006 Samuel Weinig "sam.weinig@gmail.com"
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

#define HAVE_CONFIG_H 1
#define BUILDING_WITH_CMAKE 1

#if defined(HAVE_CONFIG_H) && HAVE_CONFIG_H && defined(BUILDING_WITH_CMAKE)
#include "cmakeconfig.h"
#endif

#define JSC_API_AVAILABLE(...)
#define JSC_CLASS_AVAILABLE(...) JS_EXPORT
#define JSC_API_DEPRECATED(...)
// Use zero since it will be less than any possible version number.
#define JSC_MAC_VERSION_TBA 0
#define JSC_IOS_VERSION_TBA 0

#include <wtf/ExportMacros.h>

#define JS_EXPORT_PRIVATE 

#ifdef __cplusplus
#undef new
#undef delete
#include <wtf/FastMalloc.h>
#endif

#include <wtf/DisallowCType.h>

/* Disabling warning C4206: nonstandard extension used: translation unit is empty.
   By design, we rely on #define flags to make some translation units empty.
   Make sure this warning does not turn into an error.
*/
#if COMPILER(MSVC)
#pragma warning(disable : 4206)

// __builtin_unreachable() polyfill
static __declspec(noreturn) void __builtin_unreachable() { __assume(0); }
#endif

#ifndef WEBCORE_EXPORT
#define WEBCORE_EXPORT JS_EXPORT_PRIVATE
#endif

#include <wtf/PlatformCallingConventions.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/IsoMalloc.h>
#include <wtf/IsoMallocInlines.h>
#include <JavaScriptCore/HandleSet.h>

#define ENABLE_WEB_CRYPTO 1
#define USE_OPENSSL 1
#define HAVE_RSA_PSS 1

#endif