/*
 * Copyright 2015 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkFontMgr_empty_DEFINED
#define SkFontMgr_empty_DEFINED

#include "include/core/SkRefCnt.h"
#include "include/core/SkTypes.h"

class SkFontMgr;

/** Create a custom font manager that contains no built-in fonts.
 *  This font manager uses FreeType for rendering.
 */
SK_API sk_sp<SkFontMgr> SkFontMgr_New_Custom_Empty();

#endif // SkFontMgr_empty_DEFINED
