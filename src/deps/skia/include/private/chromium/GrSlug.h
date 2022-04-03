/*
 * Copyright 2021 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrSlug_DEFINED
#define GrSlug_DEFINED

#include "include/core/SkRect.h"
#include "include/core/SkRefCnt.h"

class SkCanvas;
class SkPaint;
class SkTextBlob;

// You can use GrSlug to simulate drawTextBlob by defining the following at compile time.
//    SK_EXPERIMENTAL_SIMULATE_DRAWGLYPHRUNLIST_WITH_SLUG
// For Skia, add this to your args.gn file.
//    extra_cflags = ["-D", "SK_EXPERIMENTAL_SIMULATE_DRAWGLYPHRUNLIST_WITH_SLUG"]

// GrSlug encapsulates an SkTextBlob at a specific origin, using a specific paint. It can be
// manipulated using matrix and clip changes to the canvas. If the canvas is transformed, then
// the GrSlug will also transform with smaller glyphs using bi-linear interpolation to render. You
// can think of a GrSlug as making a rubber stamp out of a SkTextBlob.
class SK_API GrSlug : public SkRefCnt {
public:
    ~GrSlug() override;
    // Return nullptr if the blob would not draw. This is not because of clipping, but because of
    // some paint optimization. The GrSlug is captured as if drawn using drawTextBlob.
    static sk_sp<GrSlug> ConvertBlob(
            SkCanvas* canvas, const SkTextBlob& blob, SkPoint origin, const SkPaint& paint);

    // Draw the GrSlug obeying the canvas's mapping and clipping.
    void draw(SkCanvas* canvas);

    virtual SkRect sourceBounds() const = 0;
    virtual const SkPaint& paint() const = 0;
};
#endif  // GrSlug_DEFINED
