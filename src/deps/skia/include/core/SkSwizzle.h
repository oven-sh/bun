/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkSwizzle_DEFINED
#define SkSwizzle_DEFINED

#include "include/core/SkTypes.h"

/**
  Swizzles byte order of |count| 32-bit pixels, swapping R and B.
  (RGBA <-> BGRA)
*/
SK_API void SkSwapRB(uint32_t* dest, const uint32_t* src, int count);

#endif
