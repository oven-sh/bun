/*
 * Copyright 2014 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

// EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL
// DO NOT USE -- FOR INTERNAL TESTING ONLY

#ifndef sk_maskfilter_DEFINED
#define sk_maskfilter_DEFINED

#include "include/c/sk_types.h"

typedef enum {
    NORMAL_SK_BLUR_STYLE,   //!< fuzzy inside and outside
    SOLID_SK_BLUR_STYLE,    //!< solid inside, fuzzy outside
    OUTER_SK_BLUR_STYLE,    //!< nothing inside, fuzzy outside
    INNER_SK_BLUR_STYLE,    //!< fuzzy inside, nothing outside
} sk_blurstyle_t;

SK_C_PLUS_PLUS_BEGIN_GUARD

/**
    Increment the reference count on the given sk_maskfilter_t. Must be
    balanced by a call to sk_maskfilter_unref().
*/
SK_API void sk_maskfilter_ref(sk_maskfilter_t*);
/**
    Decrement the reference count. If the reference count is 1 before
    the decrement, then release both the memory holding the
    sk_maskfilter_t and any other associated resources.  New
    sk_maskfilter_t are created with a reference count of 1.
*/
SK_API void sk_maskfilter_unref(sk_maskfilter_t*);

/**
    Create a blur maskfilter.
    @param sk_blurstyle_t The SkBlurStyle to use
    @param sigma Standard deviation of the Gaussian blur to apply. Must be > 0.
*/
SK_API sk_maskfilter_t* sk_maskfilter_new_blur(sk_blurstyle_t, float sigma);

SK_C_PLUS_PLUS_END_GUARD

#endif
