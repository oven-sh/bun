/*
 * Copyright 2014 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

// EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL
// DO NOT USE -- FOR INTERNAL TESTING ONLY

#ifndef sk_path_DEFINED
#define sk_path_DEFINED

#include "include/c/sk_types.h"

SK_C_PLUS_PLUS_BEGIN_GUARD

typedef enum {
    CW_SK_PATH_DIRECTION,
    CCW_SK_PATH_DIRECTION,
} sk_path_direction_t;

typedef struct sk_pathbuilder_t sk_pathbuilder_t;

/** Create a new, empty path. */
SK_API sk_pathbuilder_t* sk_pathbuilder_new(void);

/** Release the memory used by a sk_pathbuilder_t. */
SK_API void sk_pathbuilder_delete(sk_pathbuilder_t*);

/** Set the beginning of the next contour to the point (x,y). */
SK_API void sk_pathbuilder_move_to(sk_pathbuilder_t*, float x, float y);
/**
    Add a line from the last point to the specified point (x,y). If no
    sk_pathbuilder_move_to() call has been made for this contour, the first
    point is automatically set to (0,0).
*/
SK_API void sk_pathbuilder_line_to(sk_pathbuilder_t*, float x, float y);
/**
    Add a quadratic bezier from the last point, approaching control
    point (x0,y0), and ending at (x1,y1). If no sk_pathbuilder_move_to() call
    has been made for this contour, the first point is automatically
    set to (0,0).
*/
SK_API void sk_pathbuilder_quad_to(sk_pathbuilder_t*, float x0, float y0, float x1, float y1);
/**
    Add a conic curve from the last point, approaching control point
    (x0,y01), and ending at (x1,y1) with weight w.  If no
    sk_pathbuilder_move_to() call has been made for this contour, the first
    point is automatically set to (0,0).
*/
SK_API void sk_pathbuilder_conic_to(sk_pathbuilder_t*, float x0, float y0, float x1, float y1, float w);
/**
    Add a cubic bezier from the last point, approaching control points
    (x0,y0) and (x1,y1), and ending at (x2,y2). If no
    sk_pathbuilder_move_to() call has been made for this contour, the first
    point is automatically set to (0,0).
*/
SK_API void sk_pathbuilder_cubic_to(sk_pathbuilder_t*,
                             float x0, float y0,
                             float x1, float y1,
                             float x2, float y2);
/**
   Close the current contour. If the current point is not equal to the
   first point of the contour, a line segment is automatically added.
*/
SK_API void sk_pathbuilder_close(sk_pathbuilder_t*);

/**
    Add a closed rectangle contour to the path.
*/
SK_API void sk_pathbuilder_add_rect(sk_pathbuilder_t*, const sk_rect_t*, sk_path_direction_t);
/**
    Add a closed oval contour to the path
*/
SK_API void sk_pathbuilder_add_oval(sk_pathbuilder_t*, const sk_rect_t*, sk_path_direction_t);

/**** path *****/

/**
*  Return a Path from the builder, resetting the builder to its original empty state.
*/
SK_API sk_path_t* sk_pathbuilder_detach_path(sk_pathbuilder_t*);

/**
 *  Return a Path from the builder. The builder reamins in its current state.
 */
SK_API sk_path_t* sk_pathbuilder_snapshot_path(sk_pathbuilder_t*);

/** Release the memory used by a sk_path_t. */
SK_API void sk_path_delete(sk_path_t*);

/**
 *  If the path is empty, return false and set the rect parameter to [0, 0, 0, 0].
 *  else return true and set the rect parameter to the bounds of the control-points
 *  of the path.
 */
SK_API bool sk_path_get_bounds(const sk_path_t*, sk_rect_t*);

SK_C_PLUS_PLUS_END_GUARD

#endif
