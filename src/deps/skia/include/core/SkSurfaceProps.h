/*
 * Copyright 2014 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkSurfaceProps_DEFINED
#define SkSurfaceProps_DEFINED

#include "include/core/SkTypes.h"

/**
 *  Description of how the LCD strips are arranged for each pixel. If this is unknown, or the
 *  pixels are meant to be "portable" and/or transformed before showing (e.g. rotated, scaled)
 *  then use kUnknown_SkPixelGeometry.
 */
enum SkPixelGeometry {
    kUnknown_SkPixelGeometry,
    kRGB_H_SkPixelGeometry,
    kBGR_H_SkPixelGeometry,
    kRGB_V_SkPixelGeometry,
    kBGR_V_SkPixelGeometry,
};

// Returns true iff geo is a known geometry and is RGB.
static inline bool SkPixelGeometryIsRGB(SkPixelGeometry geo) {
    return kRGB_H_SkPixelGeometry == geo || kRGB_V_SkPixelGeometry == geo;
}

// Returns true iff geo is a known geometry and is BGR.
static inline bool SkPixelGeometryIsBGR(SkPixelGeometry geo) {
    return kBGR_H_SkPixelGeometry == geo || kBGR_V_SkPixelGeometry == geo;
}

// Returns true iff geo is a known geometry and is horizontal.
static inline bool SkPixelGeometryIsH(SkPixelGeometry geo) {
    return kRGB_H_SkPixelGeometry == geo || kBGR_H_SkPixelGeometry == geo;
}

// Returns true iff geo is a known geometry and is vertical.
static inline bool SkPixelGeometryIsV(SkPixelGeometry geo) {
    return kRGB_V_SkPixelGeometry == geo || kBGR_V_SkPixelGeometry == geo;
}

/**
 *  Describes properties and constraints of a given SkSurface. The rendering engine can parse these
 *  during drawing, and can sometimes optimize its performance (e.g. disabling an expensive
 *  feature).
 */
class SK_API SkSurfaceProps {
public:
    enum Flags {
        kUseDeviceIndependentFonts_Flag = 1 << 0,
        // Use internal MSAA to render to non-MSAA GPU surfaces.
        kDynamicMSAA_Flag               = 1 << 1
    };
    /** Deprecated alias used by Chromium. Will be removed. */
    static const Flags kUseDistanceFieldFonts_Flag = kUseDeviceIndependentFonts_Flag;

    /** No flags, unknown pixel geometry. */
    SkSurfaceProps();
    SkSurfaceProps(uint32_t flags, SkPixelGeometry);

    SkSurfaceProps(const SkSurfaceProps&);
    SkSurfaceProps& operator=(const SkSurfaceProps&);

    SkSurfaceProps cloneWithPixelGeometry(SkPixelGeometry newPixelGeometry) const {
        return SkSurfaceProps(fFlags, newPixelGeometry);
    }

    uint32_t flags() const { return fFlags; }
    SkPixelGeometry pixelGeometry() const { return fPixelGeometry; }

    bool isUseDeviceIndependentFonts() const {
        return SkToBool(fFlags & kUseDeviceIndependentFonts_Flag);
    }

    bool operator==(const SkSurfaceProps& that) const {
        return fFlags == that.fFlags && fPixelGeometry == that.fPixelGeometry;
    }

    bool operator!=(const SkSurfaceProps& that) const {
        return !(*this == that);
    }

private:
    uint32_t        fFlags;
    SkPixelGeometry fPixelGeometry;
};

#endif
