/*
 * Copyright 2014 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

// EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL
// DO NOT USE -- FOR INTERNAL TESTING ONLY

#ifndef sk_matrix_DEFINED
#define sk_matrix_DEFINED

#include "include/c/sk_types.h"

SK_C_PLUS_PLUS_BEGIN_GUARD

/** Set the matrix to identity */
void sk_matrix_set_identity(sk_matrix_t*);

/** Set the matrix to translate by (tx, ty). */
void sk_matrix_set_translate(sk_matrix_t*, float tx, float ty);
/**
    Preconcats the matrix with the specified translation.
        M' = M * T(dx, dy)
*/
void sk_matrix_pre_translate(sk_matrix_t*, float tx, float ty);
/**
    Postconcats the matrix with the specified translation.
        M' = T(dx, dy) * M
*/
void sk_matrix_post_translate(sk_matrix_t*, float tx, float ty);

/** Set the matrix to scale by sx and sy. */
void sk_matrix_set_scale(sk_matrix_t*, float sx, float sy);
/**
    Preconcats the matrix with the specified scale.
        M' = M * S(sx, sy)
*/
void sk_matrix_pre_scale(sk_matrix_t*, float sx, float sy);
/**
    Postconcats the matrix with the specified scale.
        M' = S(sx, sy) * M
*/
void sk_matrix_post_scale(sk_matrix_t*, float sx, float sy);

SK_C_PLUS_PLUS_END_GUARD

#endif
