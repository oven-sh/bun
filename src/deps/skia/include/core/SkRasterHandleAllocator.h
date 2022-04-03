/*
 * Copyright 2016 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkRasterHandleAllocator_DEFINED
#define SkRasterHandleAllocator_DEFINED

#include "include/core/SkImageInfo.h"

class SkBitmap;
class SkCanvas;
class SkMatrix;

/**
 *  If a client wants to control the allocation of raster layers in a canvas, it should subclass
 *  SkRasterHandleAllocator. This allocator performs two tasks:
 *      1. controls how the memory for the pixels is allocated
 *      2. associates a "handle" to a private object that can track the matrix/clip of the SkCanvas
 *
 *  This example allocates a canvas, and defers to the allocator to create the base layer.
 *
 *      std::unique_ptr<SkCanvas> canvas = SkRasterHandleAllocator::MakeCanvas(
 *              SkImageInfo::Make(...),
 *              std::make_unique<MySubclassRasterHandleAllocator>(...),
 *              nullptr);
 *
 *  If you have already allocated the base layer (and its handle, release-proc etc.) then you
 *  can pass those in using the last parameter to MakeCanvas().
 *
 *  Regardless of how the base layer is allocated, each time canvas->saveLayer() is called,
 *  your allocator's allocHandle() will be called.
 */
class SK_API SkRasterHandleAllocator {
public:
    virtual ~SkRasterHandleAllocator() = default;

    // The value that is returned to clients of the canvas that has this allocator installed.
    typedef void* Handle;

    struct Rec {
        // When the allocation goes out of scope, this proc is called to free everything associated
        // with it: the pixels, the "handle", etc. This is passed the pixel address and fReleaseCtx.
        void    (*fReleaseProc)(void* pixels, void* ctx);
        void*   fReleaseCtx;    // context passed to fReleaseProc
        void*   fPixels;        // pixels for this allocation
        size_t  fRowBytes;      // rowbytes for these pixels
        Handle  fHandle;        // public handle returned by SkCanvas::accessTopRasterHandle()
    };

    /**
     *  Given a requested info, allocate the corresponding pixels/rowbytes, and whatever handle
     *  is desired to give clients access to those pixels. The rec also contains a proc and context
     *  which will be called when this allocation goes out of scope.
     *
     *  e.g.
     *      when canvas->saveLayer() is called, the allocator will be called to allocate the pixels
     *      for the layer. When canvas->restore() is called, the fReleaseProc will be called.
     */
    virtual bool allocHandle(const SkImageInfo&, Rec*) = 0;

    /**
     *  Clients access the handle for a given layer by calling SkCanvas::accessTopRasterHandle().
     *  To allow the handle to reflect the current matrix/clip in the canvs, updateHandle() is
     *  is called. The subclass is responsible to update the handle as it sees fit.
     */
    virtual void updateHandle(Handle, const SkMatrix&, const SkIRect&) = 0;

    /**
     *  This creates a canvas which will use the allocator to manage pixel allocations, including
     *  all calls to saveLayer().
     *
     *  If rec is non-null, then it will be used as the base-layer of pixels/handle.
     *  If rec is null, then the allocator will be called for the base-layer as well.
     */
    static std::unique_ptr<SkCanvas> MakeCanvas(std::unique_ptr<SkRasterHandleAllocator>,
                                                const SkImageInfo&, const Rec* rec = nullptr);

protected:
    SkRasterHandleAllocator() = default;
    SkRasterHandleAllocator(const SkRasterHandleAllocator&) = delete;
    SkRasterHandleAllocator& operator=(const SkRasterHandleAllocator&) = delete;

private:
    friend class SkBitmapDevice;

    Handle allocBitmap(const SkImageInfo&, SkBitmap*);
};

#endif
