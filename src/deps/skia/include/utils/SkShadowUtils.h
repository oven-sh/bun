
/*
 * Copyright 2017 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */
#ifndef SkShadowUtils_DEFINED
#define SkShadowUtils_DEFINED

#include "include/core/SkColor.h"
#include "include/core/SkPoint3.h"
#include "include/core/SkScalar.h"
#include "include/private/SkShadowFlags.h"

class SkCanvas;
class SkMatrix;
class SkPath;
class SkResourceCache;

class SK_API SkShadowUtils {
public:
    /**
     * Draw an offset spot shadow and outlining ambient shadow for the given path using a disc
     * light. The shadow may be cached, depending on the path type and canvas matrix. If the
     * matrix is perspective or the path is volatile, it will not be cached.
     *
     * @param canvas  The canvas on which to draw the shadows.
     * @param path  The occluder used to generate the shadows.
     * @param zPlaneParams  Values for the plane function which returns the Z offset of the
     *  occluder from the canvas based on local x and y values (the current matrix is not applied).
     * @param lightPos  Generally, the 3D position of the light relative to the canvas plane.
     *                  If kDirectionalLight_ShadowFlag is set, this specifies a vector pointing
     *                  towards the light.
     * @param lightRadius  Generally, the radius of the disc light.
     *                     If DirectionalLight_ShadowFlag is set, this specifies the amount of
     *                     blur when the occluder is at Z offset == 1. The blur will grow linearly
     *                     as the Z value increases.
     * @param ambientColor  The color of the ambient shadow.
     * @param spotColor  The color of the spot shadow.
     * @param flags  Options controlling opaque occluder optimizations, shadow appearance,
     *               and light position. See SkShadowFlags.
     */
    static void DrawShadow(SkCanvas* canvas, const SkPath& path, const SkPoint3& zPlaneParams,
                           const SkPoint3& lightPos, SkScalar lightRadius,
                           SkColor ambientColor, SkColor spotColor,
                           uint32_t flags = SkShadowFlags::kNone_ShadowFlag);

    /**
     * Generate bounding box for shadows relative to path. Includes both the ambient and spot
     * shadow bounds.
     *
     * @param ctm  Current transformation matrix to device space.
     * @param path  The occluder used to generate the shadows.
     * @param zPlaneParams  Values for the plane function which returns the Z offset of the
     *  occluder from the canvas based on local x and y values (the current matrix is not applied).
     * @param lightPos  Generally, the 3D position of the light relative to the canvas plane.
     *                  If kDirectionalLight_ShadowFlag is set, this specifies a vector pointing
     *                  towards the light.
     * @param lightRadius  Generally, the radius of the disc light.
     *                     If DirectionalLight_ShadowFlag is set, this specifies the amount of
     *                     blur when the occluder is at Z offset == 1. The blur will grow linearly
     *                     as the Z value increases.
     * @param flags  Options controlling opaque occluder optimizations, shadow appearance,
     *               and light position. See SkShadowFlags.
     * @param bounds Return value for shadow bounding box.
     * @return Returns true if successful, false otherwise.
     */
    static bool GetLocalBounds(const SkMatrix& ctm, const SkPath& path,
                               const SkPoint3& zPlaneParams, const SkPoint3& lightPos,
                               SkScalar lightRadius, uint32_t flags, SkRect* bounds);

    /**
     * Helper routine to compute color values for one-pass tonal alpha.
     *
     * @param inAmbientColor  Original ambient color
     * @param inSpotColor  Original spot color
     * @param outAmbientColor  Modified ambient color
     * @param outSpotColor  Modified spot color
     */
    static void ComputeTonalColors(SkColor inAmbientColor, SkColor inSpotColor,
                                   SkColor* outAmbientColor, SkColor* outSpotColor);
};

#endif
