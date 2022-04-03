/*
 * Copyright 2015 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkFontMgr_directory_DEFINED
#define SkFontMgr_directory_DEFINED

#include "include/core/SkRefCnt.h"
#include "include/core/SkTypes.h"

class SkFontMgr;

/** Create a custom font manager which scans a given directory for font files.
 *  This font manager uses FreeType for rendering.
 */
SK_API sk_sp<SkFontMgr> SkFontMgr_New_Custom_Directory(const char* dir);

#endif // SkFontMgr_directory_DEFINED
