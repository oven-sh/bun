/*
 * Copyright 2018 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkShaderMaskFilter_DEFINED
#define SkShaderMaskFilter_DEFINED

#include "include/core/SkMaskFilter.h"

class SkShader;

class SK_API SkShaderMaskFilter {
public:
    static sk_sp<SkMaskFilter> Make(sk_sp<SkShader> shader);

private:
    static void RegisterFlattenables();
    friend class SkFlattenable;
};

#endif
