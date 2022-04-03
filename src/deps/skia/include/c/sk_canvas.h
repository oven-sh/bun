/*
 * Copyright 2014 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

// EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL
// DO NOT USE -- FOR INTERNAL TESTING ONLY

#ifndef sk_canvas_DEFINED
#define sk_canvas_DEFINED

#include "include/c/sk_types.h"

SK_C_PLUS_PLUS_BEGIN_GUARD

/**
    Save the current matrix and clip on the canvas.  When the
    balancing call to sk_canvas_restore() is made, the previous matrix
    and clip are restored.
*/
SK_API void sk_canvas_save(sk_canvas_t*);
/**
    This behaves the same as sk_canvas_save(), but in addition it
    allocates an offscreen surface. All drawing calls are directed
    there, and only when the balancing call to sk_canvas_restore() is
    made is that offscreen transfered to the canvas (or the previous
    layer).

    @param sk_rect_t* (may be null) This rect, if non-null, is used as
                      a hint to limit the size of the offscreen, and
                      thus drawing may be clipped to it, though that
                      clipping is not guaranteed to happen. If exact
                      clipping is desired, use sk_canvas_clip_rect().
    @param sk_paint_t* (may be null) The paint is copied, and is applied
                       to the offscreen when sk_canvas_restore() is
                       called.
*/
SK_API void sk_canvas_save_layer(sk_canvas_t*, const sk_rect_t*, const sk_paint_t*);
/**
    This call balances a previous call to sk_canvas_save() or
    sk_canvas_save_layer(), and is used to remove all modifications to
    the matrix and clip state since the last save call.  It is an
    error to call sk_canvas_restore() more times than save and
    save_layer were called.
*/
SK_API void sk_canvas_restore(sk_canvas_t*);

/**
    Preconcat the current coordinate transformation matrix with the
    specified translation.
*/
SK_API void sk_canvas_translate(sk_canvas_t*, float dx, float dy);
/**
    Preconcat the current coordinate transformation matrix with the
    specified scale.
*/
SK_API void sk_canvas_scale(sk_canvas_t*, float sx, float sy);
/**
    Preconcat the current coordinate transformation matrix with the
    specified rotation in degrees.
*/
SK_API void sk_canvas_rotate_degrees(sk_canvas_t*, float degrees);
/**
    Preconcat the current coordinate transformation matrix with the
    specified rotation in radians.
*/
SK_API void sk_canvas_rotate_radians(sk_canvas_t*, float radians);
/**
    Preconcat the current coordinate transformation matrix with the
    specified skew.
*/
SK_API void sk_canvas_skew(sk_canvas_t*, float sx, float sy);
/**
    Preconcat the current coordinate transformation matrix with the
    specified matrix.
*/
SK_API void sk_canvas_concat(sk_canvas_t*, const sk_matrix_t*);

/**
    Modify the current clip with the specified rectangle.  The new
    current clip will be the intersection of the old clip and the
    rectange.
*/
SK_API void sk_canvas_clip_rect(sk_canvas_t*, const sk_rect_t*);
/**
    Modify the current clip with the specified path.  The new
    current clip will be the intersection of the old clip and the
    path.
*/
SK_API void sk_canvas_clip_path(sk_canvas_t*, const sk_path_t*);

/**
    Fill the entire canvas (restricted to the current clip) with the
    specified paint.
*/
SK_API void sk_canvas_draw_paint(sk_canvas_t*, const sk_paint_t*);
/**
    Draw the specified rectangle using the specified paint. The
    rectangle will be filled or stroked based on the style in the
    paint.
*/
SK_API void sk_canvas_draw_rect(sk_canvas_t*, const sk_rect_t*, const sk_paint_t*);
/**
 *  Draw the circle centered at (cx, cy) with radius rad using the specified paint.
 *  The circle will be filled or framed based on the style in the paint
 */
SK_API void sk_canvas_draw_circle(sk_canvas_t*, float cx, float cy, float rad, const sk_paint_t*);
/**
    Draw the specified oval using the specified paint. The oval will be
    filled or framed based on the style in the paint
*/
SK_API void sk_canvas_draw_oval(sk_canvas_t*, const sk_rect_t*, const sk_paint_t*);
/**
    Draw the specified path using the specified paint. The path will be
    filled or framed based on the style in the paint
*/
SK_API void sk_canvas_draw_path(sk_canvas_t*, const sk_path_t*, const sk_paint_t*);
/**
    Draw the specified image, with its top/left corner at (x,y), using
    the specified paint, transformed by the current matrix.

    @param sk_paint_t* (may be NULL) the paint used to draw the image.
*/
SK_API void sk_canvas_draw_image(sk_canvas_t*, const sk_image_t*, float x, float y,
                                 const sk_sampling_options_t*, const sk_paint_t*);
/**
    Draw the specified image, scaling and translating so that it fills
    the specified dst rect. If the src rect is non-null, only that
    subset of the image is transformed and drawn.

    @param sk_paint_t* (may be NULL) The paint used to draw the image.
*/
SK_API void sk_canvas_draw_image_rect(sk_canvas_t*, const sk_image_t*,
                                      const sk_rect_t* src, const sk_rect_t* dst,
                                      const sk_sampling_options_t*, const sk_paint_t*);

/**
    Draw the picture into this canvas (replay the pciture's drawing commands).

    @param sk_matrix_t* If non-null, apply that matrix to the CTM when
                        drawing this picture. This is logically
                        equivalent to: save, concat, draw_picture,
                        restore.

    @param sk_paint_t* If non-null, draw the picture into a temporary
                       buffer, and then apply the paint's alpha,
                       colorfilter, imagefilter, and xfermode to that
                       buffer as it is drawn to the canvas.  This is
                       logically equivalent to save_layer(paint),
                       draw_picture, restore.
*/
SK_API void sk_canvas_draw_picture(sk_canvas_t*, const sk_picture_t*,
                                   const sk_matrix_t*, const sk_paint_t*);

SK_C_PLUS_PLUS_END_GUARD

#endif
