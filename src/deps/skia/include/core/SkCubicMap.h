/*
 * Copyright 2018 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkCubicMap_DEFINED
#define SkCubicMap_DEFINED

#include "include/core/SkPoint.h"

/**
 *  Fast evaluation of a cubic ease-in / ease-out curve. This is defined as a parametric cubic
 *  curve inside the unit square.
 *
 *  pt[0] is implicitly { 0, 0 }
 *  pt[3] is implicitly { 1, 1 }
 *  pts[1,2].X are inside the unit [0..1]
 */
class SK_API SkCubicMap {
public:
    SkCubicMap(SkPoint p1, SkPoint p2);

    static bool IsLinear(SkPoint p1, SkPoint p2) {
        return SkScalarNearlyEqual(p1.fX, p1.fY) && SkScalarNearlyEqual(p2.fX, p2.fY);
    }

    float computeYFromX(float x) const;

    SkPoint computeFromT(float t) const;

private:
    enum Type {
        kLine_Type,     // x == y
        kCubeRoot_Type, // At^3 == x
        kSolver_Type,   // general monotonic cubic solver
    };

    SkPoint fCoeff[3];
    Type    fType;
};

#endif

