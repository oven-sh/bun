/*
 * Copyright 2013 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkCanvasStateUtils_DEFINED
#define SkCanvasStateUtils_DEFINED

#include "include/core/SkCanvas.h"

class SkCanvasState;

/**
 * A set of functions that are useful for copying the state of an SkCanvas
 * across a library boundary where the Skia library on the other side of the
 * boundary may be newer. The expected usage is outline below...
 *
 *                          Lib Boundary
 * CaptureCanvasState(...)      |||
 *   SkCanvas --> SkCanvasState |||
 *                              ||| CreateFromCanvasState(...)
 *                              |||   SkCanvasState --> SkCanvas`
 *                              ||| Draw into SkCanvas`
 *                              ||| Unref SkCanvas`
 * ReleaseCanvasState(...)      |||
 *
 */
class SK_API SkCanvasStateUtils {
public:
    /**
     * Captures the current state of the canvas into an opaque ptr that is safe
     * to pass to a different instance of Skia (which may be the same version,
     * or may be newer). The function will return NULL in the event that one of the
     * following conditions are true.
     *  1) the canvas device type is not supported (currently only raster is supported)
     *  2) the canvas clip type is not supported (currently only non-AA clips are supported)
     *
     * It is recommended that the original canvas also not be used until all
     * canvases that have been created using its captured state have been dereferenced.
     *
     * Finally, it is important to note that any draw filters attached to the
     * canvas are NOT currently captured.
     *
     * @param canvas The canvas you wish to capture the current state of.
     * @return NULL or an opaque ptr that can be passed to CreateFromCanvasState
     *         to reconstruct the canvas. The caller is responsible for calling
     *         ReleaseCanvasState to free the memory associated with this state.
     */
    static SkCanvasState* CaptureCanvasState(SkCanvas* canvas);

    /**
     * Create a new SkCanvas from the captured state of another SkCanvas. The
     * function will return NULL in the event that one of the
     * following conditions are true.
     *  1) the captured state is in an unrecognized format
     *  2) the captured canvas device type is not supported
     *
     * @param state Opaque object created by CaptureCanvasState.
     * @return NULL or an SkCanvas* whose devices and matrix/clip state are
     *         identical to the captured canvas. The caller is responsible for
     *         calling unref on the SkCanvas.
     */
    static std::unique_ptr<SkCanvas> MakeFromCanvasState(const SkCanvasState* state);

    /**
     * Free the memory associated with the captured canvas state.  The state
     * should not be released until all SkCanvas objects created using that
     * state have been dereferenced. Must be called from the same library
     * instance that created the state via CaptureCanvasState.
     *
     * @param state The captured state you wish to dispose of.
     */
    static void ReleaseCanvasState(SkCanvasState* state);
};

#endif
