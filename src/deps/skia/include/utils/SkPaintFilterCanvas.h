/*
 * Copyright 2015 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkPaintFilterCanvas_DEFINED
#define SkPaintFilterCanvas_DEFINED

#include "include/core/SkCanvasVirtualEnforcer.h"
#include "include/utils/SkNWayCanvas.h"

class SkAndroidFrameworkUtils;

/** \class SkPaintFilterCanvas

    A utility proxy base class for implementing draw/paint filters.
*/
class SK_API SkPaintFilterCanvas : public SkCanvasVirtualEnforcer<SkNWayCanvas> {
public:
    /**
     * The new SkPaintFilterCanvas is configured for forwarding to the
     * specified canvas.  Also copies the target canvas matrix and clip bounds.
     */
    SkPaintFilterCanvas(SkCanvas* canvas);

    enum Type {
        kPicture_Type,
    };

    // Forwarded to the wrapped canvas.
    SkISize getBaseLayerSize() const override { return proxy()->getBaseLayerSize(); }
    GrRecordingContext* recordingContext() override { return proxy()->recordingContext(); }

protected:
    /**
     *  Called with the paint that will be used to draw the specified type.
     *  The implementation may modify the paint as they wish.
     *
     *  The result bool is used to determine whether the draw op is to be
     *  executed (true) or skipped (false).
     *
     *  Note: The base implementation calls onFilter() for top-level/explicit paints only.
     *        To also filter encapsulated paints (e.g. SkPicture, SkTextBlob), clients may need to
     *        override the relevant methods (i.e. drawPicture, drawTextBlob).
     */
    virtual bool onFilter(SkPaint& paint) const = 0;

    void onDrawPaint(const SkPaint&) override;
    void onDrawBehind(const SkPaint&) override;
    void onDrawPoints(PointMode, size_t count, const SkPoint pts[], const SkPaint&) override;
    void onDrawRect(const SkRect&, const SkPaint&) override;
    void onDrawRRect(const SkRRect&, const SkPaint&) override;
    void onDrawDRRect(const SkRRect&, const SkRRect&, const SkPaint&) override;
    void onDrawRegion(const SkRegion&, const SkPaint&) override;
    void onDrawOval(const SkRect&, const SkPaint&) override;
    void onDrawArc(const SkRect&, SkScalar, SkScalar, bool, const SkPaint&) override;
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
    void onDrawPatch(const SkPoint cubics[12], const SkColor colors[4],
                             const SkPoint texCoords[4], SkBlendMode,
                             const SkPaint& paint) override;
    void onDrawPicture(const SkPicture*, const SkMatrix*, const SkPaint*) override;
    void onDrawDrawable(SkDrawable*, const SkMatrix*) override;

    void onDrawGlyphRunList(const SkGlyphRunList&, const SkPaint&) override;
    void onDrawTextBlob(const SkTextBlob* blob, SkScalar x, SkScalar y,
                        const SkPaint& paint) override;
    void onDrawAnnotation(const SkRect& rect, const char key[], SkData* value) override;
    void onDrawShadowRec(const SkPath& path, const SkDrawShadowRec& rec) override;

    void onDrawEdgeAAQuad(const SkRect&, const SkPoint[4], QuadAAFlags, const SkColor4f&,
                          SkBlendMode) override;
    void onDrawEdgeAAImageSet2(const ImageSetEntry[], int count, const SkPoint[], const SkMatrix[],
                               const SkSamplingOptions&,const SkPaint*, SrcRectConstraint) override;

    // Forwarded to the wrapped canvas.
    sk_sp<SkSurface> onNewSurface(const SkImageInfo&, const SkSurfaceProps&) override;
    bool onPeekPixels(SkPixmap* pixmap) override;
    bool onAccessTopLayerPixels(SkPixmap* pixmap) override;
    SkImageInfo onImageInfo() const override;
    bool onGetProps(SkSurfaceProps* props) const override;

private:
    class AutoPaintFilter;

    SkCanvas* proxy() const { SkASSERT(fList.count() == 1); return fList[0]; }

    SkPaintFilterCanvas* internal_private_asPaintFilterCanvas() const override {
        return const_cast<SkPaintFilterCanvas*>(this);
    }

    friend class SkAndroidFrameworkUtils;
};

#endif
