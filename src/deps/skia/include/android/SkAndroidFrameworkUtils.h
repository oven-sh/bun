/*
 * Copyright 2017 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkAndroidFrameworkUtils_DEFINED
#define SkAndroidFrameworkUtils_DEFINED

#include "include/core/SkRefCnt.h"
#include "include/core/SkTypes.h"

#ifdef SK_BUILD_FOR_ANDROID_FRAMEWORK

class SkCanvas;
struct SkIRect;
struct SkRect;
class SkSurface;

/**
 *  SkAndroidFrameworkUtils expose private APIs used only by Android framework.
 */
class SkAndroidFrameworkUtils {
public:

#if SK_SUPPORT_GPU
    /**
     *  clipWithStencil draws the current clip into a stencil buffer with reference value and mask
     *  set to 0x1. This function works only on a GPU canvas.
     *
     *  @param  canvas A GPU canvas that has a non-empty clip.
     *
     *  @return true on success or false if clip is empty or not a GPU canvas.
     */
    static bool clipWithStencil(SkCanvas* canvas);
#endif //SK_SUPPORT_GPU

    static void SafetyNetLog(const char*);

    static sk_sp<SkSurface> getSurfaceFromCanvas(SkCanvas* canvas);

    static int SaveBehind(SkCanvas* canvas, const SkRect* subset);

    // Operating within the canvas' clip stack, this resets the geometry of the clip to be wide
    // open modula any device clip restriction that was set outside of the clip stack.
    static void ResetClip(SkCanvas* canvas);

    /**
     * Unrolls a chain of nested SkPaintFilterCanvas to return the base wrapped canvas.
     *
     *  @param  canvas A SkPaintFilterCanvas or any other SkCanvas subclass.
     *
     *  @return SkCanvas that was found in the innermost SkPaintFilterCanvas.
     */
    static SkCanvas* getBaseWrappedCanvas(SkCanvas* canvas);
};

#endif // SK_BUILD_FOR_ANDROID_ANDROID

#endif // SkAndroidFrameworkUtils_DEFINED
