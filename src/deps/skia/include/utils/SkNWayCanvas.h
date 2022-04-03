
/*
 * Copyright 2011 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkNWayCanvas_DEFINED
#define SkNWayCanvas_DEFINED

#include "include/core/SkCanvasVirtualEnforcer.h"
#include "include/private/SkTDArray.h"
#include "include/utils/SkNoDrawCanvas.h"

class SK_API SkNWayCanvas : public SkCanvasVirtualEnforcer<SkNoDrawCanvas> {
public:
    SkNWayCanvas(int width, int height);
    ~SkNWayCanvas() override;

    virtual void addCanvas(SkCanvas*);
    virtual void removeCanvas(SkCanvas*);
    virtual void removeAll();

protected:
    SkTDArray<SkCanvas*> fList;

    void willSave() override;
    SaveLayerStrategy getSaveLayerStrategy(const SaveLayerRec&) override;
    bool onDoSaveBehind(const SkRect*) override;
    void willRestore() override;

    void didConcat44(const SkM44&) override;
    void didSetM44(const SkM44&) override;
    void didScale(SkScalar, SkScalar) override;
    void didTranslate(SkScalar, SkScalar) override;

    void onDrawDRRect(const SkRRect&, const SkRRect&, const SkPaint&) override;
    void onDrawGlyphRunList(const SkGlyphRunList&, const SkPaint&) override;
    void onDrawTextBlob(const SkTextBlob* blob, SkScalar x, SkScalar y,
                        const SkPaint& paint) override;
    void onDrawPatch(const SkPoint cubics[12], const SkColor colors[4],
                     const SkPoint texCoords[4], SkBlendMode, const SkPaint& paint) override;

    void onDrawPaint(const SkPaint&) override;
    void onDrawBehind(const SkPaint&) override;
    void onDrawPoints(PointMode, size_t count, const SkPoint pts[], const SkPaint&) override;
    void onDrawRect(const SkRect&, const SkPaint&) override;
    void onDrawRegion(const SkRegion&, const SkPaint&) override;
    void onDrawOval(const SkRect&, const SkPaint&) override;
    void onDrawArc(const SkRect&, SkScalar, SkScalar, bool, const SkPaint&) override;
    void onDrawRRect(const SkRRect&, const SkPaint&) override;
    void onDrawPath(const SkPath&, const SkPaint&) override;

    void onDrawImage2(const SkImage*, SkScalar, SkScalar, const SkSamplingOptions&,
                      const SkPaint*) override;
    void onDrawImageRect2(const SkImage*, const SkRect&, const SkRect&, const SkSamplingOptions&,
                          const SkPaint*, SrcRectConstraint) override;
    void onDrawImageLattice2(const SkImage*, const Lattice&, const SkRect&, SkFilterMode,
                             const SkPaint*) override;
    void onDrawAtlas2(const SkImage*, const SkRSXform[], const SkRect[], const SkColor[], int,
                  SkBlendMode, const SkSamplingOptions&, const SkRect*, const SkPaint*) override;

    void onDrawVerticesObject(const SkVertices*, SkBlendMode, const SkPaint&) override;
    void onDrawShadowRec(const SkPath&, const SkDrawShadowRec&) override;

    void onClipRect(const SkRect&, SkClipOp, ClipEdgeStyle) override;
    void onClipRRect(const SkRRect&, SkClipOp, ClipEdgeStyle) override;
    void onClipPath(const SkPath&, SkClipOp, ClipEdgeStyle) override;
    void onClipShader(sk_sp<SkShader>, SkClipOp) override;
    void onClipRegion(const SkRegion&, SkClipOp) override;
    void onResetClip() override;

    void onDrawPicture(const SkPicture*, const SkMatrix*, const SkPaint*) override;
    void onDrawDrawable(SkDrawable*, const SkMatrix*) override;
    void onDrawAnnotation(const SkRect&, const char[], SkData*) override;

    void onDrawEdgeAAQuad(const SkRect&, const SkPoint[4], QuadAAFlags, const SkColor4f&,
                          SkBlendMode) override;
    void onDrawEdgeAAImageSet2(const ImageSetEntry[], int count, const SkPoint[], const SkMatrix[],
                               const SkSamplingOptions&,const SkPaint*, SrcRectConstraint) override;

    void onFlush() override;

    class Iter;

private:
    using INHERITED = SkCanvasVirtualEnforcer<SkNoDrawCanvas>;
};


#endif
