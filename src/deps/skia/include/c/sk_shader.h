/*
 * Copyright 2014 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

// EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL
// DO NOT USE -- FOR INTERNAL TESTING ONLY

#ifndef sk_shader_DEFINED
#define sk_shader_DEFINED

#include "include/c/sk_types.h"

SK_C_PLUS_PLUS_BEGIN_GUARD

SK_API void sk_shader_ref(sk_shader_t*);
SK_API void sk_shader_unref(sk_shader_t*);

typedef enum {
    CLAMP_SK_SHADER_TILEMODE,
    REPEAT_SK_SHADER_TILEMODE,
    MIRROR_SK_SHADER_TILEMODE,
} sk_shader_tilemode_t;

/**
    Returns a shader that generates a linear gradient between the two
    specified points.

    @param points The start and end points for the gradient.
    @param colors The array[count] of colors, to be distributed between
                  the two points
    @param colorPos May be NULL. array[count] of SkScalars, or NULL, of
                    the relative position of each corresponding color
                    in the colors array. If this is NULL, the the
                    colors are distributed evenly between the start
                    and end point.  If this is not null, the values
                    must begin with 0, end with 1.0, and intermediate
                    values must be strictly increasing.
    @param colorCount Must be >=2. The number of colors (and pos if not
                      NULL) entries.
    @param mode The tiling mode
*/
SK_API sk_shader_t* sk_shader_new_linear_gradient(const sk_point_t points[2],
                                           const sk_color_t colors[],
                                           const float colorPos[],
                                           int colorCount,
                                           sk_shader_tilemode_t tileMode,
                                           const sk_matrix_t* localMatrix);


/**
    Returns a shader that generates a radial gradient given the center
    and radius.

    @param center The center of the circle for this gradient
    @param radius Must be positive. The radius of the circle for this
                  gradient
    @param colors The array[count] of colors, to be distributed
                  between the center and edge of the circle
    @param colorPos May be NULL. The array[count] of the relative
                    position of each corresponding color in the colors
                    array. If this is NULL, the the colors are
                    distributed evenly between the center and edge of
                    the circle.  If this is not null, the values must
                    begin with 0, end with 1.0, and intermediate
                    values must be strictly increasing.
    @param count Must be >= 2. The number of colors (and pos if not
                 NULL) entries
    @param tileMode The tiling mode
    @param localMatrix May be NULL
*/
SK_API sk_shader_t* sk_shader_new_radial_gradient(const sk_point_t* center,
                                           float radius,
                                           const sk_color_t colors[],
                                           const float colorPos[],
                                           int colorCount,
                                           sk_shader_tilemode_t tileMode,
                                           const sk_matrix_t* localMatrix);

/**
    Returns a shader that generates a sweep gradient given a center.

    @param center The coordinates of the center of the sweep
    @param colors The array[count] of colors, to be distributed around
                  the center.
    @param colorPos May be NULL. The array[count] of the relative
                    position of each corresponding color in the colors
                    array. If this is NULL, the the colors are
                    distributed evenly between the center and edge of
                    the circle.  If this is not null, the values must
                    begin with 0, end with 1.0, and intermediate
                    values must be strictly increasing.
    @param colorCount Must be >= 2. The number of colors (and pos if
                      not NULL) entries
    @param localMatrix May be NULL
*/
SK_API sk_shader_t* sk_shader_new_sweep_gradient(const sk_point_t* center,
                                          const sk_color_t colors[],
                                          const float colorPos[],
                                          int colorCount,
                                          const sk_matrix_t* localMatrix);

/**
    Returns a shader that generates a conical gradient given two circles, or
    returns NULL if the inputs are invalid. The gradient interprets the
    two circles according to the following HTML spec.
    http://dev.w3.org/html5/2dcontext/#dom-context-2d-createradialgradient

    Returns a shader that generates a sweep gradient given a center.

    @param start, startRadius Defines the first circle.
    @param end, endRadius Defines the first circle.
    @param colors The array[count] of colors, to be distributed between
                  the two circles.
    @param colorPos May be NULL. The array[count] of the relative
                    position of each corresponding color in the colors
                    array. If this is NULL, the the colors are
                    distributed evenly between the two circles.  If
                    this is not null, the values must begin with 0,
                    end with 1.0, and intermediate values must be
                    strictly increasing.
    @param colorCount Must be >= 2. The number of colors (and pos if
                      not NULL) entries
    @param tileMode The tiling mode
    @param localMatrix May be NULL

*/
SK_API sk_shader_t* sk_shader_new_two_point_conical_gradient(
        const sk_point_t* start,
        float startRadius,
        const sk_point_t* end,
        float endRadius,
        const sk_color_t colors[],
        const float colorPos[],
        int colorCount,
        sk_shader_tilemode_t tileMode,
        const sk_matrix_t* localMatrix);

SK_C_PLUS_PLUS_END_GUARD

#endif
