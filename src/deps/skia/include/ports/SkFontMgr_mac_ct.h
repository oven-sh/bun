/*
 * Copyright 2017 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkFontMgr_mac_ct_DEFINED
#define SkFontMgr_mac_ct_DEFINED

#include "include/core/SkRefCnt.h"
#include "include/core/SkTypes.h"

#ifdef SK_BUILD_FOR_MAC
#import <ApplicationServices/ApplicationServices.h>
#endif

#ifdef SK_BUILD_FOR_IOS
#include <CoreText/CoreText.h>
#endif

class SkFontMgr;

/** Create a font manager for CoreText. If the collection is nullptr the system default will be used. */
SK_API extern sk_sp<SkFontMgr> SkFontMgr_New_CoreText(CTFontCollectionRef);

#endif // SkFontMgr_mac_ct_DEFINED
