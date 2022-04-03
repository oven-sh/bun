/*
 * Copyright 2021 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrDawnTypesPriv_DEFINED
#define GrDawnTypesPriv_DEFINED

#include "include/gpu/dawn/GrDawnTypes.h"

struct GrDawnTextureSpec {
    GrDawnTextureSpec() {}
    GrDawnTextureSpec(const GrDawnSurfaceInfo& info) : fFormat(info.fFormat) {}

    wgpu::TextureFormat fFormat;
};

GrDawnSurfaceInfo GrDawnTextureSpecToSurfaceInfo(const GrDawnTextureSpec& dawnSpec,
                                                 uint32_t sampleCount,
                                                 uint32_t levelCount,
                                                 GrProtected isProtected);

#endif

