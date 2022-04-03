/*
 * Copyright 2014 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

// EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL EXPERIMENTAL
// DO NOT USE -- FOR INTERNAL TESTING ONLY

#ifndef sk_surface_DEFINED
#define sk_surface_DEFINED

#include "include/c/sk_types.h"

SK_C_PLUS_PLUS_BEGIN_GUARD

/**
    Return a new surface, with the memory for the pixels automatically
    allocated.  If the requested surface cannot be created, or the
    request is not a supported configuration, NULL will be returned.

    @param sk_imageinfo_t* Specify the width, height, color type, and
                           alpha type for the surface.

    @param sk_surfaceprops_t* If not NULL, specify additional non-default
                              properties of the surface.
*/
SK_API sk_surface_t* sk_surface_new_raster(const sk_imageinfo_t*, const sk_surfaceprops_t*);

/**
    Create a new surface which will draw into the specified pixels
    with the specified rowbytes.  If the requested surface cannot be
    created, or the request is not a supported configuration, NULL
    will be returned.

    @param sk_imageinfo_t* Specify the width, height, color type, and
                           alpha type for the surface.
    @param void* pixels Specify the location in memory where the
                        destination pixels are.  This memory must
                        outlast this surface.
     @param size_t rowBytes Specify the difference, in bytes, between
                           each adjacent row.  Should be at least
                           (width * sizeof(one pixel)).
    @param sk_surfaceprops_t* If not NULL, specify additional non-default
                              properties of the surface.
*/
SK_API sk_surface_t* sk_surface_new_raster_direct(const sk_imageinfo_t*,
                                                  void* pixels, size_t rowBytes,
                                                  const sk_surfaceprops_t* props);

/**
    Decrement the reference count. If the reference count is 1 before
    the decrement, then release both the memory holding the
    sk_surface_t and any pixel memory it may be managing.  New
    sk_surface_t are created with a reference count of 1.
*/
SK_API void sk_surface_unref(sk_surface_t*);

/**
 *  Return the canvas associated with this surface. Note: the canvas is owned by the surface,
 *  so the returned object is only valid while the owning surface is valid.
 */
SK_API sk_canvas_t* sk_surface_get_canvas(sk_surface_t*);

/**
 *  Call sk_image_unref() when the returned image is no longer used.
 */
SK_API sk_image_t* sk_surface_new_image_snapshot(sk_surface_t*);

SK_C_PLUS_PLUS_END_GUARD

#endif
