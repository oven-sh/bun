/*
 * Copyright 2020 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrD3DBackendContext_DEFINED
#define GrD3DBackendContext_DEFINED

// GrD3DTypes.h includes d3d12.h, which in turn includes windows.h, which redefines many
// common identifiers such as:
// * interface
// * small
// * near
// * far
// * CreateSemaphore
// * MemoryBarrier
//
// You should only include GrD3DBackendContext.h if you are prepared to rename those identifiers.
#include "include/gpu/d3d/GrD3DTypes.h"

#include "include/gpu/GrTypes.h"

// The BackendContext contains all of the base D3D objects needed by the GrD3DGpu. The assumption
// is that the client will set these up and pass them to the GrD3DGpu constructor.
struct SK_API GrD3DBackendContext {
    gr_cp<IDXGIAdapter1> fAdapter;
    gr_cp<ID3D12Device> fDevice;
    gr_cp<ID3D12CommandQueue> fQueue;
    sk_sp<GrD3DMemoryAllocator> fMemoryAllocator;
    GrProtected fProtectedContext = GrProtected::kNo;
};

#endif
