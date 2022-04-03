/*
 * Copyright 2019 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrImageContext_DEFINED
#define GrImageContext_DEFINED

#include "include/private/GrContext_Base.h"
#include "include/private/GrSingleOwner.h"

class GrImageContextPriv;

// This is now just a view on a ThreadSafeProxy, that SkImages can attempt to
// downcast to a GrDirectContext as a backdoor to some operations. Once we remove the backdoors,
// this goes away and SkImages just hold ThreadSafeProxies.
class GrImageContext : public GrContext_Base {
public:
    ~GrImageContext() override;

    // Provides access to functions that aren't part of the public API.
    GrImageContextPriv priv();
    const GrImageContextPriv priv() const;  // NOLINT(readability-const-return-type)

protected:
    friend class GrImageContextPriv; // for hidden functions

    GrImageContext(sk_sp<GrContextThreadSafeProxy>);

    SK_API virtual void abandonContext();
    SK_API virtual bool abandoned();

    /** This is only useful for debug purposes */
    GrSingleOwner* singleOwner() const { return &fSingleOwner; }

    GrImageContext* asImageContext() override { return this; }

private:
    // When making promise images, we currently need a placeholder GrImageContext instance to give
    // to the SkImage that has no real power, just a wrapper around the ThreadSafeProxy.
    // TODO: De-power SkImage to ThreadSafeProxy or at least figure out a way to share one instance.
    static sk_sp<GrImageContext> MakeForPromiseImage(sk_sp<GrContextThreadSafeProxy>);

    // In debug builds we guard against improper thread handling
    // This guard is passed to the GrDrawingManager and, from there to all the
    // GrSurfaceDrawContexts.  It is also passed to the GrResourceProvider and SkGpuDevice.
    // TODO: Move this down to GrRecordingContext.
    mutable GrSingleOwner            fSingleOwner;

    using INHERITED = GrContext_Base;
};

#endif
