/*
 * Copyright 2020 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkCustomTypeface_DEFINED
#define SkCustomTypeface_DEFINED

#include "include/core/SkFontMetrics.h"
#include "include/core/SkFontStyle.h"
#include "include/core/SkImage.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPath.h"
#include "include/core/SkPicture.h"
#include "include/core/SkTypeface.h"

#include <vector>

class SkStream;

class SkCustomTypefaceBuilder {
public:
    SkCustomTypefaceBuilder();

    void setGlyph(SkGlyphID, float advance, const SkPath&);
    void setGlyph(SkGlyphID, float advance, const SkPath&, const SkPaint&);
    void setGlyph(SkGlyphID, float advance, sk_sp<SkImage>, float scale);
    void setGlyph(SkGlyphID, float advance, sk_sp<SkPicture>);

    void setMetrics(const SkFontMetrics& fm, float scale = 1);
    void setFontStyle(SkFontStyle);

    sk_sp<SkTypeface> detach();

private:
    std::vector<SkPath> fPaths;
    std::vector<float>  fAdvances;
    SkFontMetrics       fMetrics;
    SkFontStyle         fStyle;

    static sk_sp<SkTypeface> Deserialize(SkStream*);

    friend class SkTypeface;
};

#endif
