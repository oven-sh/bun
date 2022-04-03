/*
 * Copyright 2006 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkTableMaskFilter_DEFINED
#define SkTableMaskFilter_DEFINED

#include "include/core/SkMaskFilter.h"
#include "include/core/SkScalar.h"

/** \class SkTableMaskFilter

    Applies a table lookup on each of the alpha values in the mask.
    Helper methods create some common tables (e.g. gamma, clipping)
 */
class SK_API SkTableMaskFilter {
public:
    /** Utility that sets the gamma table
     */
    static void MakeGammaTable(uint8_t table[256], SkScalar gamma);

    /** Utility that creates a clipping table: clamps values below min to 0
        and above max to 255, and rescales the remaining into 0..255
     */
    static void MakeClipTable(uint8_t table[256], uint8_t min, uint8_t max);

    static SkMaskFilter* Create(const uint8_t table[256]);
    static SkMaskFilter* CreateGamma(SkScalar gamma);
    static SkMaskFilter* CreateClip(uint8_t min, uint8_t max);

    SkTableMaskFilter() = delete;
};

#endif
