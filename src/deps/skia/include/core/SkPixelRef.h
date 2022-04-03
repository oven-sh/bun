/*
 * Copyright 2008 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkPixelRef_DEFINED
#define SkPixelRef_DEFINED

#include "include/core/SkBitmap.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkPixmap.h"
#include "include/core/SkRefCnt.h"
#include "include/core/SkSize.h"
#include "include/private/SkIDChangeListener.h"
#include "include/private/SkMutex.h"
#include "include/private/SkTDArray.h"

#include <atomic>

struct SkIRect;

class GrTexture;
class SkDiscardableMemory;

/** \class SkPixelRef

    This class is the smart container for pixel memory, and is used with SkBitmap.
    This class can be shared/accessed between multiple threads.
*/
class SK_API SkPixelRef : public SkRefCnt {
public:
    SkPixelRef(int width, int height, void* addr, size_t rowBytes);
    ~SkPixelRef() override;

    SkISize dimensions() const { return {fWidth, fHeight}; }
    int width() const { return fWidth; }
    int height() const { return fHeight; }
    void* pixels() const { return fPixels; }
    size_t rowBytes() const { return fRowBytes; }

    /** Returns a non-zero, unique value corresponding to the pixels in this
        pixelref. Each time the pixels are changed (and notifyPixelsChanged is
        called), a different generation ID will be returned.
    */
    uint32_t getGenerationID() const;

    /**
     *  Call this if you have changed the contents of the pixels. This will in-
     *  turn cause a different generation ID value to be returned from
     *  getGenerationID().
     */
    void notifyPixelsChanged();

    /** Returns true if this pixelref is marked as immutable, meaning that the
        contents of its pixels will not change for the lifetime of the pixelref.
    */
    bool isImmutable() const { return fMutability != kMutable; }

    /** Marks this pixelref is immutable, meaning that the contents of its
        pixels will not change for the lifetime of the pixelref. This state can
        be set on a pixelref, but it cannot be cleared once it is set.
    */
    void setImmutable();

    // Register a listener that may be called the next time our generation ID changes.
    //
    // We'll only call the listener if we're confident that we are the only SkPixelRef with this
    // generation ID.  If our generation ID changes and we decide not to call the listener, we'll
    // never call it: you must add a new listener for each generation ID change.  We also won't call
    // the listener when we're certain no one knows what our generation ID is.
    //
    // This can be used to invalidate caches keyed by SkPixelRef generation ID.
    // Takes ownership of listener.  Threadsafe.
    void addGenIDChangeListener(sk_sp<SkIDChangeListener> listener);

    // Call when this pixelref is part of the key to a resourcecache entry. This allows the cache
    // to know automatically those entries can be purged when this pixelref is changed or deleted.
    void notifyAddedToCache() {
        fAddedToCache.store(true);
    }

    virtual SkDiscardableMemory* diagnostic_only_getDiscardable() const { return nullptr; }

protected:
    void android_only_reset(int width, int height, size_t rowBytes);

private:
    int                 fWidth;
    int                 fHeight;
    void*               fPixels;
    size_t              fRowBytes;

    // Bottom bit indicates the Gen ID is unique.
    bool genIDIsUnique() const { return SkToBool(fTaggedGenID.load() & 1); }
    mutable std::atomic<uint32_t> fTaggedGenID;

    SkIDChangeListener::List fGenIDChangeListeners;

    // Set true by caches when they cache content that's derived from the current pixels.
    std::atomic<bool> fAddedToCache;

    enum Mutability {
        kMutable,               // PixelRefs begin mutable.
        kTemporarilyImmutable,  // Considered immutable, but can revert to mutable.
        kImmutable,             // Once set to this state, it never leaves.
    } fMutability : 8;          // easily fits inside a byte

    void needsNewGenID();
    void callGenIDChangeListeners();

    void setTemporarilyImmutable();
    void restoreMutability();
    friend class SkSurface_Raster;   // For the two methods above.

    void setImmutableWithID(uint32_t genID);
    friend void SkBitmapCache_setImmutableWithID(SkPixelRef*, uint32_t);

    using INHERITED = SkRefCnt;
};

#endif
