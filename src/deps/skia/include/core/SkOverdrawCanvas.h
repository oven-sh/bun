/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkOverdrawCanvas_DEFINED
#define SkOverdrawCanvas_DEFINED

#include "include/core/SkCanvasVirtualEnforcer.h"
#include "include/utils/SkNWayCanvas.h"

/**
 *  Captures all drawing commands.  Rather than draw the actual content, this device
 *  increments the alpha channel of each pixel every time it would have been touched
 *  by a draw call.  This is useful for detecting overdraw.
 */
class SK_API SkOverdrawCanvas : public SkCanvasVirtualEnforcer<SkNWayCanvas> {
public:
    /* Does not take ownership of canvas */
    SkOverdrawCanvas(SkCanvas*);

    void onDrawTextBlob(const SkTextBlob*, SkScalar, SkScalar, const SkPaint&) override;
    void onDrawGlyphRunList(const SkGlyphRunList& glyphRunList, const SkPaint& paint) override;
    void onDrawPatch(const SkPoint[12], const SkColor[4], const SkPoint[4], SkBlendMode,
                     const SkPaint&) override;
    void onDrawPaint(const SkPaint&) override;
    void onDrawBehind(const SkPaint& paint) override;
    void onDrawRect(const SkRect&, const SkPaint&) override;
    void onDrawRegion(const SkRegion&, const SkPaint&) override;
    void onDrawOval(const SkRect&, const SkPaint&) override;
    void onDrawArc(const SkRect&, SkScalar, SkScalar, bool, const SkPaint&) override;
    void onDrawDRRect(const SkRRect&, const SkRRect&, const SkPaint&) override;
    void onDrawRRect(const SkRRect&, const SkPaint&) override;
    void onDrawPoints(PointMode, size_t, const SkPoint[], const SkPaint&) override;
    void onDrawVerticesObject(const SkVertices*, SkBlendMode, const SkPaint&) override;
    void onDrawPath(const SkPath&, const SkPaint&) override;

    void onDrawImage2(const SkImage*, SkScalar, SkScalar, const SkSamplingOptions&,
                      const SkPaint*) override;
    void onDrawImageRect2(const SkImage*, const SkRect&, const SkRect&, const SkSamplingOptions&,
                          const SkPaint*, SrcRectConstraint) override;
    void onDrawImageLattice2(const SkImage*, const Lattice&, const SkRect&, SkFilterMode,
                             const SkPaint*) override;
    void onDrawAtlas2(const SkImage*, const SkRSXform[], const SkRect[], const SkColor[], int,
                     SkBlendMode, const SkSamplingOptions&, const SkRect*, const SkPaint*) override;

    void onDrawDrawable(SkDrawable*, const SkMatrix*) override;
    void onDrawPicture(const SkPicture*, const SkMatrix*, const SkPaint*) override;

    void onDrawAnnotation(const SkRect&, const char key[], SkData* value) override;
    void onDrawShadowRec(const SkPath&, const SkDrawShadowRec&) override;

    void onDrawEdgeAAQuad(const SkRect&, const SkPoint[4], SkCanvas::QuadAAFlags, const SkColor4f&,
                          SkBlendMode) override;
    void onDrawEdgeAAImageSet2(const ImageSetEntry[], int count, const SkPoint[], const SkMatrix[],
                               const SkSamplingOptions&,const SkPaint*, SrcRectConstraint) override;

private:
    inline SkPaint overdrawPaint(const SkPaint& paint);

    SkPaint   fPaint;

    using INHERITED = SkCanvasVirtualEnforcer<SkNWayCanvas>;
};

#endif
