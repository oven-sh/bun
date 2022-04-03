/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkICC_DEFINED
#define SkICC_DEFINED

#include "include/core/SkData.h"

struct skcms_Matrix3x3;
struct skcms_TransferFunction;

SK_API sk_sp<SkData> SkWriteICCProfile(const skcms_TransferFunction&,
                                       const skcms_Matrix3x3& toXYZD50);

#endif//SkICC_DEFINED
