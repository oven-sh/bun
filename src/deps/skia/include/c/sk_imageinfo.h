/*
 * Copyright 2018 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

// EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL
// DO NOT USE -- FOR INTERNAL TESTING ONLY

#ifndef sk_imageinfo_DEFINED
#define sk_imageinfo_DEFINED

#include "include/c/sk_types.h"

SK_C_PLUS_PLUS_BEGIN_GUARD

typedef enum {
    UNKNOWN_SK_COLORTYPE,
    RGBA_8888_SK_COLORTYPE,
    BGRA_8888_SK_COLORTYPE,
    ALPHA_8_SK_COLORTYPE,
    GRAY_8_SK_COLORTYPE,
    RGBA_F16_SK_COLORTYPE,
    RGBA_F32_SK_COLORTYPE,
} sk_colortype_t;

typedef enum {
    OPAQUE_SK_ALPHATYPE,
    PREMUL_SK_ALPHATYPE,
    UNPREMUL_SK_ALPHATYPE,
} sk_alphatype_t;

/**
 *  Allocate a new imageinfo object. If colorspace is not null, it's owner-count will be
 *  incremented automatically.
 */
SK_API sk_imageinfo_t* sk_imageinfo_new(int width, int height, sk_colortype_t ct, sk_alphatype_t at,
                                 sk_colorspace_t* cs);

/**
 *  Free the imageinfo object. If it contains a reference to a colorspace, its owner-count will
 *  be decremented automatically.
 */
SK_API void sk_imageinfo_delete(sk_imageinfo_t*);

SK_API int32_t          sk_imageinfo_get_width(const sk_imageinfo_t*);
SK_API int32_t          sk_imageinfo_get_height(const sk_imageinfo_t*);
SK_API sk_colortype_t   sk_imageinfo_get_colortype(const sk_imageinfo_t*);
SK_API sk_alphatype_t   sk_imageinfo_get_alphatype(const sk_imageinfo_t*);

/**
 *  Return the colorspace object reference contained in the imageinfo, or null if there is none.
 *  Note: this does not modify the owner-count on the colorspace object. If the caller needs to
 *  use the colorspace beyond the lifetime of the imageinfo, it should manually call
 *  sk_colorspace_ref() (and then call unref() when it is done).
 */
SK_API sk_colorspace_t* sk_imageinfo_get_colorspace(const sk_imageinfo_t*);

SK_C_PLUS_PLUS_END_GUARD

#endif
