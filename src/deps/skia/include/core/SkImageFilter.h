/*
 * Copyright 2011 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkImageFilter_DEFINED
#define SkImageFilter_DEFINED

#include "include/core/SkFlattenable.h"
#include "include/core/SkMatrix.h"
#include "include/core/SkRect.h"

class SkColorFilter;

/**
 *  Base class for image filters. If one is installed in the paint, then all drawing occurs as
 *  usual, but it is as if the drawing happened into an offscreen (before the xfermode is applied).
 *  This offscreen bitmap will then be handed to the imagefilter, who in turn creates a new bitmap
 *  which is what will finally be drawn to the device (using the original xfermode).
 *
 *  The local space of image filters matches the local space of the drawn geometry. For instance if
 *  there is rotation on the canvas, the blur will be computed along those rotated axes and not in
 *  the device space. In order to achieve this result, the actual drawing of the geometry may happen
 *  in an unrotated coordinate system so that the filtered image can be computed more easily, and
 *  then it will be post transformed to match what would have been produced if the geometry were
 *  drawn with the total canvas matrix to begin with.
 */
class SK_API SkImageFilter : public SkFlattenable {
public:
    enum MapDirection {
        kForward_MapDirection,
        kReverse_MapDirection,
    };
    /**
     * Map a device-space rect recursively forward or backward through the filter DAG.
     * kForward_MapDirection is used to determine which pixels of the destination canvas a source
     * image rect would touch after filtering. kReverse_MapDirection is used to determine which rect
     * of the source image would be required to fill the given rect (typically, clip bounds). Used
     * for clipping and temp-buffer allocations, so the result need not be exact, but should never
     * be smaller than the real answer. The default implementation recursively unions all input
     * bounds, or returns the source rect if no inputs.
     *
     * In kReverse mode, 'inputRect' is the device-space bounds of the input pixels. In kForward
     * mode it should always be null. If 'inputRect' is null in kReverse mode the resulting answer
     * may be incorrect.
     */
    SkIRect filterBounds(const SkIRect& src, const SkMatrix& ctm,
                         MapDirection, const SkIRect* inputRect = nullptr) const;

    /**
     *  Returns whether this image filter is a color filter and puts the color filter into the
     *  "filterPtr" parameter if it can. Does nothing otherwise.
     *  If this returns false, then the filterPtr is unchanged.
     *  If this returns true, then if filterPtr is not null, it must be set to a ref'd colorfitler
     *  (i.e. it may not be set to NULL).
     */
    bool isColorFilterNode(SkColorFilter** filterPtr) const;

    // DEPRECATED : use isColorFilterNode() instead
    bool asColorFilter(SkColorFilter** filterPtr) const {
        return this->isColorFilterNode(filterPtr);
    }

    /**
     *  Returns true (and optionally returns a ref'd filter) if this imagefilter can be completely
     *  replaced by the returned colorfilter. i.e. the two effects will affect drawing in the same
     *  way.
     */
    bool asAColorFilter(SkColorFilter** filterPtr) const;

    /**
     *  Returns the number of inputs this filter will accept (some inputs can be NULL).
     */
    int countInputs() const;

    /**
     *  Returns the input filter at a given index, or NULL if no input is connected.  The indices
     *  used are filter-specific.
     */
    const SkImageFilter* getInput(int i) const;

    // Default impl returns union of all input bounds.
    virtual SkRect computeFastBounds(const SkRect& bounds) const;

    // Can this filter DAG compute the resulting bounds of an object-space rectangle?
    bool canComputeFastBounds() const;

    /**
     *  If this filter can be represented by another filter + a localMatrix, return that filter,
     *  else return null.
     */
    sk_sp<SkImageFilter> makeWithLocalMatrix(const SkMatrix& matrix) const;

    static sk_sp<SkImageFilter> Deserialize(const void* data, size_t size,
                                          const SkDeserialProcs* procs = nullptr) {
        return sk_sp<SkImageFilter>(static_cast<SkImageFilter*>(
                SkFlattenable::Deserialize(kSkImageFilter_Type, data, size, procs).release()));
    }

protected:

    sk_sp<SkImageFilter> refMe() const {
        return sk_ref_sp(const_cast<SkImageFilter*>(this));
    }

private:
    friend class SkImageFilter_Base;

    using INHERITED = SkFlattenable;
};

#endif
