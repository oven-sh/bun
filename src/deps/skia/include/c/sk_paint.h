/*
 * Copyright 2014 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

// EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL
// DO NOT USE -- FOR INTERNAL TESTING ONLY

#ifndef sk_paint_DEFINED
#define sk_paint_DEFINED

#include "include/c/sk_types.h"

SK_C_PLUS_PLUS_BEGIN_GUARD

/**
    Create a new paint with default settings:
        antialias : false
        stroke : false
        stroke width : 0.0f (hairline)
        stroke miter : 4.0f
        stroke cap : BUTT_SK_STROKE_CAP
        stroke join : MITER_SK_STROKE_JOIN
        color : opaque black
        shader : NULL
        maskfilter : NULL
        xfermode_mode : SRCOVER_SK_XFERMODE_MODE
*/
SK_API sk_paint_t* sk_paint_new(void);
/**
    Release the memory storing the sk_paint_t and unref() all
    associated objects.
*/
SK_API void sk_paint_delete(sk_paint_t*);

/**
    Return true iff the paint has antialiasing enabled.
*/
SK_API bool sk_paint_is_antialias(const sk_paint_t*);
/**
    Set to true to enable antialiasing, false to disable it on this
    sk_paint_t.
*/
SK_API void sk_paint_set_antialias(sk_paint_t*, bool);

/**
    Return the paint's curent drawing color.
*/
SK_API sk_color_t sk_paint_get_color(const sk_paint_t*);
/**
    Set the paint's curent drawing color.
*/
SK_API void sk_paint_set_color(sk_paint_t*, sk_color_t);

/* stroke settings */

/**
    Return true iff stroking is enabled rather than filling on this
    sk_paint_t.
*/
SK_API bool sk_paint_is_stroke(const sk_paint_t*);
/**
    Set to true to enable stroking rather than filling with this
    sk_paint_t.
*/
SK_API void sk_paint_set_stroke(sk_paint_t*, bool);

/**
    Return the width for stroking.  A value of 0 strokes in hairline mode.
 */
SK_API float sk_paint_get_stroke_width(const sk_paint_t*);
/**
   Set the width for stroking.  A value of 0 strokes in hairline mode
   (always draw 1-pixel wide, regardless of the matrix).
 */
SK_API void sk_paint_set_stroke_width(sk_paint_t*, float width);

/**
    Return the paint's stroke miter value. This is used to control the
    behavior of miter joins when the joins angle is sharp.
*/
SK_API float sk_paint_get_stroke_miter(const sk_paint_t*);
/**
   Set the paint's stroke miter value. This is used to control the
   behavior of miter joins when the joins angle is sharp. This value
   must be >= 0.
*/
SK_API void sk_paint_set_stroke_miter(sk_paint_t*, float miter);

typedef enum {
    BUTT_SK_STROKE_CAP,
    ROUND_SK_STROKE_CAP,
    SQUARE_SK_STROKE_CAP
} sk_stroke_cap_t;

/**
    Return the paint's stroke cap type, controlling how the start and
    end of stroked lines and paths are treated.
*/
SK_API sk_stroke_cap_t sk_paint_get_stroke_cap(const sk_paint_t*);
/**
    Set the paint's stroke cap type, controlling how the start and
    end of stroked lines and paths are treated.
*/
SK_API void sk_paint_set_stroke_cap(sk_paint_t*, sk_stroke_cap_t);

typedef enum {
    MITER_SK_STROKE_JOIN,
    ROUND_SK_STROKE_JOIN,
    BEVEL_SK_STROKE_JOIN
} sk_stroke_join_t;

/**
    Return the paint's stroke join type, specifies the treatment that
    is applied to corners in paths and rectangles
 */
SK_API sk_stroke_join_t sk_paint_get_stroke_join(const sk_paint_t*);
/**
    Set the paint's stroke join type, specifies the treatment that
    is applied to corners in paths and rectangles
 */
SK_API void sk_paint_set_stroke_join(sk_paint_t*, sk_stroke_join_t);

/**
 *  Set the paint's shader to the specified parameter. This will automatically call unref() on
 *  any previous value, and call ref() on the new value.
 */
SK_API void sk_paint_set_shader(sk_paint_t*, sk_shader_t*);

/**
 *  Set the paint's maskfilter to the specified parameter. This will automatically call unref() on
 *  any previous value, and call ref() on the new value.
 */
SK_API void sk_paint_set_maskfilter(sk_paint_t*, sk_maskfilter_t*);

/**
 *  Set the paint's xfermode to the specified parameter.
 */
SK_API void sk_paint_set_xfermode_mode(sk_paint_t*, sk_xfermode_mode_t);

SK_C_PLUS_PLUS_END_GUARD

#endif
