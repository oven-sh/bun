/*
 * Copyright 2018 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkFontMgr_fuchsia_DEFINED
#define SkFontMgr_fuchsia_DEFINED

#include <fuchsia/fonts/cpp/fidl.h>

#include "include/core/SkRefCnt.h"

class SkFontMgr;

SK_API sk_sp<SkFontMgr> SkFontMgr_New_Fuchsia(fuchsia::fonts::ProviderSyncPtr provider);

#endif  // SkFontMgr_fuchsia_DEFINED
