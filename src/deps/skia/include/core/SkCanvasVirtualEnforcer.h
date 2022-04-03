/*
 * Copyright 2018 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkCanvasVirtualEnforcer_DEFINED
#define SkCanvasVirtualEnforcer_DEFINED

#include "include/core/SkCanvas.h"

// If you would ordinarily want to inherit from Base (eg SkCanvas, SkNWayCanvas), instead
// inherit from SkCanvasVirtualEnforcer<Base>, which will make the build fail if you forget
// to override one of SkCanvas' key virtual hooks.
template <typename Base>
class SkCanvasVirtualEnforcer : public Base {
public:
    using Base::Base;

protected:
    void onDrawPaint(const SkPaint& paint) override = 0;
    void onDrawBehind(const SkPaint&) override {} // make zero after android updates
    void onDrawRect(const SkRect& rect, const SkPaint& paint) override = 0;
    void onDrawRRect(const SkRRect& rrect, const SkPaint& paint) override = 0;
    void onDrawDRRect(const SkRRect& outer, const SkRRect& inner,
                      const SkPaint& paint) override = 0;
    void onDrawOval(const SkRect& rect, const SkPaint& paint) override = 0;
    void onDrawArc(const SkRect& rect, SkScalar startAngle, SkScalar sweepAngle, bool useCenter,
                   const SkPaint& paint) override = 0;
    void onDrawPath(const SkPath& path, const SkPaint& paint) override = 0;
    void onDrawRegion(const SkRegion& region, const SkPaint& paint) override = 0;

    void onDrawTextBlob(const SkTextBlob* blob, SkScalar x, SkScalar y,
                        const SkPaint& paint) override = 0;

    void onDrawPatch(const SkPoint cubics[12], const SkColor colors[4],
                     const SkPoint texCoords[4], SkBlendMode mode,
                     const SkPaint& paint) override = 0;
    void onDrawPoints(SkCanvas::PointMode mode, size_t count, const SkPoint pts[],
                      const SkPaint& paint) override = 0;

#ifdef SK_BUILD_FOR_ANDROID_FRAMEWORK
    // This is under active development for Chrome and not used in Android. Hold off on adding
    // implementations in Android's SkCanvas subclasses until this stabilizes.
    void onDrawEdgeAAQuad(const SkRect& rect, const SkPoint clip[4],
            SkCanvas::QuadAAFlags aaFlags, const SkColor4f& color, SkBlendMode mode) override {}
#else
    void onDrawEdgeAAQuad(const SkRect& rect, const SkPoint clip[4],
            SkCanvas::QuadAAFlags aaFlags, const SkColor4f& color, SkBlendMode mode) override = 0;
#endif

    void onDrawAnnotation(const SkRect& rect, const char key[], SkData* value) override = 0;
    void onDrawShadowRec(const SkPath&, const SkDrawShadowRec&) override = 0;

    void onDrawDrawable(SkDrawable* drawable, const SkMatrix* matrix) override = 0;
    void onDrawPicture(const SkPicture* picture, const SkMatrix* matrix,
                       const SkPaint* paint) override = 0;
};

#endif
