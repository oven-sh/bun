/*
 * Copyright 2020 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrD3DTypesMinimal_DEFINED
#define GrD3DTypesMinimal_DEFINED

// Minimal definitions of Direct3D types, without including d3d12.h

#include "include/core/SkRefCnt.h"

#include <dxgiformat.h>

#include "include/gpu/GrTypes.h"

struct ID3D12Resource;
class GrD3DResourceState;
typedef int GrD3DResourceStateEnum;
struct GrD3DSurfaceInfo;
struct GrD3DTextureResourceInfo;
struct GrD3DTextureResourceSpec;
struct GrD3DFenceInfo;

// This struct is to used to store the the actual information about the Direct3D backend image on
// GrBackendTexture and GrBackendRenderTarget. When a client calls getD3DTextureInfo on a
// GrBackendTexture/RenderTarget, we use the GrD3DBackendSurfaceInfo to create a snapshot
// GrD3DTextureResourceInfo object. Internally, this uses a ref count GrD3DResourceState object to
// track the current D3D12_RESOURCE_STATES which can be shared with an internal GrD3DTextureResource
// so that state updates can be seen by all users of the texture.
struct GrD3DBackendSurfaceInfo {
    GrD3DBackendSurfaceInfo(const GrD3DTextureResourceInfo& info, GrD3DResourceState* state);

    void cleanup();

    GrD3DBackendSurfaceInfo& operator=(const GrD3DBackendSurfaceInfo&) = delete;

    // Assigns the passed in GrD3DBackendSurfaceInfo to this object. if isValid is true we will also
    // attempt to unref the old fLayout on this object.
    void assign(const GrD3DBackendSurfaceInfo&, bool isValid);

    void setResourceState(GrD3DResourceStateEnum state);

    sk_sp<GrD3DResourceState> getGrD3DResourceState() const;

    GrD3DTextureResourceInfo snapTextureResourceInfo() const;

    bool isProtected() const;
#if GR_TEST_UTILS
    bool operator==(const GrD3DBackendSurfaceInfo& that) const;
#endif

private:
    GrD3DTextureResourceInfo* fTextureResourceInfo;
    GrD3DResourceState* fResourceState;
};

struct GrD3DTextureResourceSpecHolder {
public:
    GrD3DTextureResourceSpecHolder(const GrD3DSurfaceInfo&);

    void cleanup();

    GrD3DSurfaceInfo getSurfaceInfo(uint32_t sampleCount,
                                    uint32_t levelCount,
                                    GrProtected isProtected) const;

private:
    GrD3DTextureResourceSpec* fSpec;
};

#endif
