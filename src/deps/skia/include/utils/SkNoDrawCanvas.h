/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkNoDrawCanvas_DEFINED
#define SkNoDrawCanvas_DEFINED

#include "include/core/SkCanvas.h"
#include "include/core/SkCanvasVirtualEnforcer.h"

struct SkIRect;

// SkNoDrawCanvas is a helper for SkCanvas subclasses which do not need to
// actually rasterize (e.g., analysis of the draw calls).
//
// It provides the following simplifications:
//
//   * not backed by any device/pixels
//   * conservative clipping (clipping calls only use rectangles)
//
class SK_API SkNoDrawCanvas : public SkCanvasVirtualEnforcer<SkCanvas> {
public:
    SkNoDrawCanvas(int width, int height);
    SkNoDrawCanvas(const SkIRect&);

    explicit SkNoDrawCanvas(sk_sp<SkBaseDevice> device);

    // Optimization to reset state to be the same as after construction.
    void resetCanvas(int w, int h)        { this->resetForNextPicture(SkIRect::MakeWH(w, h)); }
    void resetCanvas(const SkIRect& rect) { this->resetForNextPicture(rect); }

protected:
    SaveLayerStrategy getSaveLayerStrategy(const SaveLayerRec& rec) override;
    bool onDoSaveBehind(const SkRect*) override;

    // No-op overrides for aborting rasterization earlier than SkNullBlitter.
    void onDrawAnnotation(const SkRect&, const char[], SkData*) override {}
    void onDrawDRRect(const SkRRect&, const SkRRect&, const SkPaint&) override {}
    void onDrawDrawable(SkDrawable*, const SkMatrix*) override {}
    void onDrawTextBlob(const SkTextBlob*, SkScalar, SkScalar, const SkPaint&) override {}
    void onDrawPatch(const SkPoint[12], const SkColor[4], const SkPoint[4], SkBlendMode,
                     const SkPaint&) override {}

    void onDrawPaint(const SkPaint&) override {}
    void onDrawBehind(const SkPaint&) override {}
    void onDrawPoints(PointMode, size_t, const SkPoint[], const SkPaint&) override {}
    void onDrawRect(const SkRect&, const SkPaint&) override {}
    void onDrawRegion(const SkRegion&, const SkPaint&) override {}
    void onDrawOval(const SkRect&, const SkPaint&) override {}
    void onDrawArc(const SkRect&, SkScalar, SkScalar, bool, const SkPaint&) override {}
    void onDrawRRect(const SkRRect&, const SkPaint&) override {}
    void onDrawPath(const SkPath&, const SkPaint&) override {}

    void onDrawImage2(const SkImage*, SkScalar, SkScalar, const SkSamplingOptions&,
                      const SkPaint*) override {}
    void onDrawImageRect2(const SkImage*, const SkRect&, const SkRect&, const SkSamplingOptions&,
                          const SkPaint*, SrcRectConstraint) override {}
    void onDrawImageLattice2(const SkImage*, const Lattice&, const SkRect&, SkFilterMode,
                             const SkPaint*) override {}
    void onDrawAtlas2(const SkImage*, const SkRSXform[], const SkRect[], const SkColor[], int,
                  SkBlendMode, const SkSamplingOptions&, const SkRect*, const SkPaint*) override {}

    void onDrawVerticesObject(const SkVertices*, SkBlendMode, const SkPaint&) override {}
    void onDrawShadowRec(const SkPath&, const SkDrawShadowRec&) override {}
    void onDrawPicture(const SkPicture*, const SkMatrix*, const SkPaint*) override {}

    void onDrawEdgeAAQuad(const SkRect&, const SkPoint[4], QuadAAFlags, const SkColor4f&,
                          SkBlendMode) override {}
    void onDrawEdgeAAImageSet2(const ImageSetEntry[], int, const SkPoint[], const SkMatrix[],
                               const SkSamplingOptions&, const SkPaint*,
                               SrcRectConstraint) override {}

private:
    using INHERITED = SkCanvasVirtualEnforcer<SkCanvas>;
};

#endif // SkNoDrawCanvas_DEFINED
