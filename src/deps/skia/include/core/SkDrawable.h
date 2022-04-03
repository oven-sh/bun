/*
 * Copyright 2014 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkDrawable_DEFINED
#define SkDrawable_DEFINED

#include "include/core/SkFlattenable.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkScalar.h"

class GrBackendDrawableInfo;
class SkCanvas;
class SkMatrix;
class SkPicture;
enum class GrBackendApi : unsigned;
struct SkRect;

/**
 *  Base-class for objects that draw into SkCanvas.
 *
 *  The object has a generation ID, which is guaranteed to be unique across all drawables. To
 *  allow for clients of the drawable that may want to cache the results, the drawable must
 *  change its generation ID whenever its internal state changes such that it will draw differently.
 */
class SK_API SkDrawable : public SkFlattenable {
public:
    /**
     *  Draws into the specified content. The drawing sequence will be balanced upon return
     *  (i.e. the saveLevel() on the canvas will match what it was when draw() was called,
     *  and the current matrix and clip settings will not be changed.
     */
    void draw(SkCanvas*, const SkMatrix* = nullptr);
    void draw(SkCanvas*, SkScalar x, SkScalar y);

    /**
     *  When using the GPU backend it is possible for a drawable to execute using the underlying 3D
     *  API rather than the SkCanvas API. It does so by creating a GpuDrawHandler. The GPU backend
     *  is deferred so the handler will be given access to the 3D API at the correct point in the
     *  drawing stream as the GPU backend flushes. Since the drawable may mutate, each time it is
     *  drawn to a GPU-backed canvas a new handler is snapped, representing the drawable's state at
     *  the time of the snap.
     *
     *  When the GPU backend flushes to the 3D API it will call the draw method on the
     *  GpuDrawHandler. At this time the drawable may add commands to the stream of GPU commands for
     *  the unerlying 3D API. The draw function takes a GrBackendDrawableInfo which contains
     *  information about the current state of 3D API which the caller must respect. See
     *  GrBackendDrawableInfo for more specific details on what information is sent and the
     *  requirements for different 3D APIs.
     *
     *  Additionaly there may be a slight delay from when the drawable adds its commands to when
     *  those commands are actually submitted to the GPU. Thus the drawable or GpuDrawHandler is
     *  required to keep any resources that are used by its added commands alive and valid until
     *  those commands are submitted to the GPU. The GpuDrawHandler will be kept alive and then
     *  deleted once the commands are submitted to the GPU. The dtor of the GpuDrawHandler is the
     *  signal to the drawable that the commands have all been submitted. Different 3D APIs may have
     *  additional requirements for certain resources which require waiting for the GPU to finish
     *  all work on those resources before reusing or deleting them. In this case, the drawable can
     *  use the dtor call of the GpuDrawHandler to add a fence to the GPU to track when the GPU work
     *  has completed.
     *
     *  Currently this is only supported for the GPU Vulkan backend.
     */

    class GpuDrawHandler {
    public:
        virtual ~GpuDrawHandler() {}

        virtual void draw(const GrBackendDrawableInfo&) {}
    };

    /**
     * Snaps off a GpuDrawHandler to represent the state of the SkDrawable at the time the snap is
     * called. This is used for executing GPU backend specific draws intermixed with normal Skia GPU
     * draws. The GPU API, which will be used for the draw, as well as the full matrix, device clip
     * bounds and imageInfo of the target buffer are passed in as inputs.
     */
    std::unique_ptr<GpuDrawHandler> snapGpuDrawHandler(GrBackendApi backendApi,
                                                       const SkMatrix& matrix,
                                                       const SkIRect& clipBounds,
                                                       const SkImageInfo& bufferInfo) {
        return this->onSnapGpuDrawHandler(backendApi, matrix, clipBounds, bufferInfo);
    }

    SkPicture* newPictureSnapshot();

    /**
     *  Return a unique value for this instance. If two calls to this return the same value,
     *  it is presumed that calling the draw() method will render the same thing as well.
     *
     *  Subclasses that change their state should call notifyDrawingChanged() to ensure that
     *  a new value will be returned the next time it is called.
     */
    uint32_t getGenerationID();

    /**
     *  Return the (conservative) bounds of what the drawable will draw. If the drawable can
     *  change what it draws (e.g. animation or in response to some external change), then this
     *  must return a bounds that is always valid for all possible states.
     */
    SkRect getBounds();

    /**
     *  Calling this invalidates the previous generation ID, and causes a new one to be computed
     *  the next time getGenerationID() is called. Typically this is called by the object itself,
     *  in response to its internal state changing.
     */
    void notifyDrawingChanged();

    static SkFlattenable::Type GetFlattenableType() {
        return kSkDrawable_Type;
    }

    SkFlattenable::Type getFlattenableType() const override {
        return kSkDrawable_Type;
    }

    static sk_sp<SkDrawable> Deserialize(const void* data, size_t size,
                                          const SkDeserialProcs* procs = nullptr) {
        return sk_sp<SkDrawable>(static_cast<SkDrawable*>(
                                  SkFlattenable::Deserialize(
                                  kSkDrawable_Type, data, size, procs).release()));
    }

    Factory getFactory() const override { return nullptr; }
    const char* getTypeName() const override { return nullptr; }

protected:
    SkDrawable();

    virtual SkRect onGetBounds() = 0;
    virtual void onDraw(SkCanvas*) = 0;

    virtual std::unique_ptr<GpuDrawHandler> onSnapGpuDrawHandler(GrBackendApi, const SkMatrix&,
                                                                 const SkIRect& /*clipBounds*/,
                                                                 const SkImageInfo&) {
        return nullptr;
    }

    // TODO: Delete this once Android gets updated to take the clipBounds version above.
    virtual std::unique_ptr<GpuDrawHandler> onSnapGpuDrawHandler(GrBackendApi, const SkMatrix&) {
        return nullptr;
    }

    /**
     *  Default implementation calls onDraw() with a canvas that records into a picture. Subclasses
     *  may override if they have a more efficient way to return a picture for the current state
     *  of their drawable. Note: this picture must draw the same as what would be drawn from
     *  onDraw().
     */
    virtual SkPicture* onNewPictureSnapshot();

private:
    int32_t fGenerationID;
};

#endif
