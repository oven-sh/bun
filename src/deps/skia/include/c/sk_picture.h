/*
 * Copyright 2014 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

// EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL
// DO NOT USE -- FOR INTERNAL TESTING ONLY

#ifndef sk_picture_DEFINED
#define sk_picture_DEFINED

#include "include/c/sk_types.h"

SK_C_PLUS_PLUS_BEGIN_GUARD

/**
    Create a new sk_picture_recorder_t.  Its resources should be
    released with a call to sk_picture_recorder_delete().
*/
SK_API sk_picture_recorder_t* sk_picture_recorder_new(void);
/**
    Release the memory and other resources used by this
    sk_picture_recorder_t.
*/
SK_API void sk_picture_recorder_delete(sk_picture_recorder_t*);

/**
   Returns the canvas that records the drawing commands

   @param sk_rect_t* the cull rect used when recording this
                     picture. Any drawing the falls outside of this
                     rect is undefined, and may be drawn or it may not.
*/
SK_API sk_canvas_t* sk_picture_recorder_begin_recording(sk_picture_recorder_t*, const sk_rect_t*);
/**
    Signal that the caller is done recording. This invalidates the
    canvas returned by begin_recording. Ownership of the sk_picture_t
    is passed to the caller, who must call sk_picture_unref() when
    they are done using it.  The returned picture is immutable.
*/
SK_API sk_picture_t* sk_picture_recorder_end_recording(sk_picture_recorder_t*);

/**
    Increment the reference count on the given sk_picture_t. Must be
    balanced by a call to sk_picture_unref().
*/
SK_API void sk_picture_ref(sk_picture_t*);
/**
    Decrement the reference count. If the reference count is 1 before
    the decrement, then release both the memory holding the
    sk_picture_t and any resouces it may be managing.  New
    sk_picture_t are created with a reference count of 1.
*/
SK_API void sk_picture_unref(sk_picture_t*);

/**
    Returns a non-zero value unique among all pictures.
 */
SK_API uint32_t sk_picture_get_unique_id(sk_picture_t*);

/**
    Return the cull rect specified when this picture was recorded.
*/
SK_API sk_rect_t sk_picture_get_bounds(sk_picture_t*);

SK_C_PLUS_PLUS_END_GUARD

#endif
