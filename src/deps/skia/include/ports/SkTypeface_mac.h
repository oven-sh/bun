/*
 * Copyright 2011 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkTypeface_mac_DEFINED
#define SkTypeface_mac_DEFINED

#include "include/core/SkTypeface.h"

#if defined(SK_BUILD_FOR_MAC) || defined(SK_BUILD_FOR_IOS)

#include <CoreFoundation/CoreFoundation.h>

#ifdef SK_BUILD_FOR_MAC
#import <ApplicationServices/ApplicationServices.h>
#endif

#ifdef SK_BUILD_FOR_IOS
#include <CoreText/CoreText.h>
#endif

/**
 *  Like the other Typeface make methods, this returns a new reference to the
 *  corresponding typeface for the specified CTFontRef.
 */
SK_API extern sk_sp<SkTypeface> SkMakeTypefaceFromCTFont(CTFontRef);

/**
 *  Returns the platform-specific CTFontRef handle for a
 *  given SkTypeface. Note that the returned CTFontRef gets
 *  released when the source SkTypeface is destroyed.
 *
 *  This method is deprecated. It may only be used by Blink Mac
 *  legacy code in special cases related to text-shaping
 *  with AAT fonts, clipboard handling and font fallback.
 *  See https://code.google.com/p/skia/issues/detail?id=3408
 */
SK_API extern CTFontRef SkTypeface_GetCTFontRef(const SkTypeface* face);

#endif  // defined(SK_BUILD_FOR_MAC) || defined(SK_BUILD_FOR_IOS)
#endif  // SkTypeface_mac_DEFINED
