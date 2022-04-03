/*
 * Copyright 2007 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkColorMatrix_DEFINED
#define SkColorMatrix_DEFINED

#include "include/core/SkImageInfo.h"

#include <algorithm>
#include <array>

class SK_API SkColorMatrix {
public:
    constexpr SkColorMatrix() : SkColorMatrix(1, 0, 0, 0, 0,
                                              0, 1, 0, 0, 0,
                                              0, 0, 1, 0, 0,
                                              0, 0, 0, 1, 0) {}

    constexpr SkColorMatrix(float m00, float m01, float m02, float m03, float m04,
                            float m10, float m11, float m12, float m13, float m14,
                            float m20, float m21, float m22, float m23, float m24,
                            float m30, float m31, float m32, float m33, float m34)
        : fMat { m00, m01, m02, m03, m04,
                 m10, m11, m12, m13, m14,
                 m20, m21, m22, m23, m24,
                 m30, m31, m32, m33, m34 } {}

    static SkColorMatrix RGBtoYUV(SkYUVColorSpace);
    static SkColorMatrix YUVtoRGB(SkYUVColorSpace);

    void setIdentity();
    void setScale(float rScale, float gScale, float bScale, float aScale = 1.0f);

    void postTranslate(float dr, float dg, float db, float da);

    void setConcat(const SkColorMatrix& a, const SkColorMatrix& b);
    void preConcat(const SkColorMatrix& mat) { this->setConcat(*this, mat); }
    void postConcat(const SkColorMatrix& mat) { this->setConcat(mat, *this); }

    void setSaturation(float sat);

    void setRowMajor(const float src[20]) { std::copy_n(src, 20, fMat.begin()); }
    void getRowMajor(float dst[20]) const { std::copy_n(fMat.begin(), 20, dst); }

private:
    std::array<float, 20> fMat;

    friend class SkColorFilters;
};

#endif
