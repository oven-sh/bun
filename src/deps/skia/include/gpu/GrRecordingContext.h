/*
 * Copyright 2019 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrRecordingContext_DEFINED
#define GrRecordingContext_DEFINED

#include "include/core/SkRefCnt.h"
#include "include/private/GrImageContext.h"
#include "include/private/SkTArray.h"

#if GR_GPU_STATS && GR_TEST_UTILS
#include <map>
#include <string>
#endif

class GrAuditTrail;
class GrBackendFormat;
class GrDrawingManager;
class GrOnFlushCallbackObject;
class GrMemoryPool;
class GrProgramDesc;
class GrProgramInfo;
class GrProxyProvider;
class GrRecordingContextPriv;
class GrSubRunAllocator;
class GrSurfaceProxy;
class GrTextBlobRedrawCoordinator;
class GrThreadSafeCache;
class SkArenaAlloc;
class SkJSONWriter;

#if GR_TEST_UTILS
class SkString;
#endif

class GrRecordingContext : public GrImageContext {
public:
    ~GrRecordingContext() override;

    SK_API GrBackendFormat defaultBackendFormat(SkColorType ct, GrRenderable renderable) const {
        return INHERITED::defaultBackendFormat(ct, renderable);
    }

    /**
     * Reports whether the GrDirectContext associated with this GrRecordingContext is abandoned.
     * When called on a GrDirectContext it may actively check whether the underlying 3D API
     * device/context has been disconnected before reporting the status. If so, calling this
     * method will transition the GrDirectContext to the abandoned state.
     */
    bool abandoned() override { return INHERITED::abandoned(); }

    /*
     * Can a SkSurface be created with the given color type. To check whether MSAA is supported
     * use maxSurfaceSampleCountForColorType().
     */
    SK_API bool colorTypeSupportedAsSurface(SkColorType colorType) const {
        if (kR16G16_unorm_SkColorType == colorType ||
            kA16_unorm_SkColorType == colorType ||
            kA16_float_SkColorType == colorType ||
            kR16G16_float_SkColorType == colorType ||
            kR16G16B16A16_unorm_SkColorType == colorType ||
            kGray_8_SkColorType == colorType) {
            return false;
        }

        return this->maxSurfaceSampleCountForColorType(colorType) > 0;
    }

    /**
     * Gets the maximum supported texture size.
     */
    SK_API int maxTextureSize() const;

    /**
     * Gets the maximum supported render target size.
     */
    SK_API int maxRenderTargetSize() const;

    /**
     * Can a SkImage be created with the given color type.
     */
    SK_API bool colorTypeSupportedAsImage(SkColorType) const;

    /**
     * Gets the maximum supported sample count for a color type. 1 is returned if only non-MSAA
     * rendering is supported for the color type. 0 is returned if rendering to this color type
     * is not supported at all.
     */
    SK_API int maxSurfaceSampleCountForColorType(SkColorType) const;

    // Provides access to functions that aren't part of the public API.
    GrRecordingContextPriv priv();
    const GrRecordingContextPriv priv() const;  // NOLINT(readability-const-return-type)

    // The collection of specialized memory arenas for different types of data recorded by a
    // GrRecordingContext. Arenas does not maintain ownership of the pools it groups together.
    class Arenas {
    public:
        Arenas(SkArenaAlloc*, GrSubRunAllocator*);

        // For storing pipelines and other complex data as-needed by ops
        SkArenaAlloc* recordTimeAllocator() { return fRecordTimeAllocator; }

        // For storing GrTextBlob SubRuns
        GrSubRunAllocator* recordTimeSubRunAllocator() { return fRecordTimeSubRunAllocator; }

    private:
        SkArenaAlloc* fRecordTimeAllocator;
        GrSubRunAllocator* fRecordTimeSubRunAllocator;
    };

protected:
    friend class GrRecordingContextPriv;    // for hidden functions
    friend class SkDeferredDisplayList;     // for OwnedArenas
    friend class SkDeferredDisplayListPriv; // for ProgramData

    // Like Arenas, but preserves ownership of the underlying pools.
    class OwnedArenas {
    public:
        OwnedArenas(bool ddlRecording);
        ~OwnedArenas();

        Arenas get();

        OwnedArenas& operator=(OwnedArenas&&);

    private:
        bool fDDLRecording;
        std::unique_ptr<SkArenaAlloc> fRecordTimeAllocator;
        std::unique_ptr<GrSubRunAllocator> fRecordTimeSubRunAllocator;
    };

    GrRecordingContext(sk_sp<GrContextThreadSafeProxy>, bool ddlRecording);

    bool init() override;

    void abandonContext() override;

    GrDrawingManager* drawingManager();

    // There is no going back from this method. It should only be called to control the timing
    // during abandon or destruction of the context.
    void destroyDrawingManager();

    Arenas arenas() { return fArenas.get(); }
    // This entry point should only be used for DDL creation where we want the ops' lifetime to
    // match that of the DDL.
    OwnedArenas&& detachArenas();

    GrProxyProvider* proxyProvider() { return fProxyProvider.get(); }
    const GrProxyProvider* proxyProvider() const { return fProxyProvider.get(); }

    struct ProgramData {
        ProgramData(std::unique_ptr<const GrProgramDesc>, const GrProgramInfo*);
        ProgramData(ProgramData&&);                     // for SkTArray
        ProgramData(const ProgramData&) = delete;
        ~ProgramData();

        const GrProgramDesc& desc() const { return *fDesc; }
        const GrProgramInfo& info() const { return *fInfo; }

    private:
        // TODO: store the GrProgramDescs in the 'fRecordTimeData' arena
        std::unique_ptr<const GrProgramDesc> fDesc;
        // The program infos should be stored in 'fRecordTimeData' so do not need to be ref
        // counted or deleted in the destructor.
        const GrProgramInfo* fInfo = nullptr;
    };

    // This entry point gives the recording context a chance to cache the provided
    // programInfo. The DDL context takes this opportunity to store programInfos as a sidecar
    // to the DDL.
    virtual void recordProgramInfo(const GrProgramInfo*) {}
    // This asks the recording context to return any programInfos it may have collected
    // via the 'recordProgramInfo' call. It is up to the caller to ensure that the lifetime
    // of the programInfos matches the intended use. For example, in DDL-record mode it
    // is known that all the programInfos will have been allocated in an arena with the
    // same lifetime at the DDL itself.
    virtual void detachProgramData(SkTArray<ProgramData>*) {}

    GrTextBlobRedrawCoordinator* getTextBlobRedrawCoordinator();
    const GrTextBlobRedrawCoordinator* getTextBlobRedrawCoordinator() const;

    GrThreadSafeCache* threadSafeCache();
    const GrThreadSafeCache* threadSafeCache() const;

    /**
     * Registers an object for flush-related callbacks. (See GrOnFlushCallbackObject.)
     *
     * NOTE: the drawing manager tracks this object as a raw pointer; it is up to the caller to
     * ensure its lifetime is tied to that of the context.
     */
    void addOnFlushCallbackObject(GrOnFlushCallbackObject*);

    GrRecordingContext* asRecordingContext() override { return this; }

    class Stats {
    public:
        Stats() = default;

#if GR_GPU_STATS
        void reset() { *this = {}; }

        int numPathMasksGenerated() const { return fNumPathMasksGenerated; }
        void incNumPathMasksGenerated() { fNumPathMasksGenerated++; }

        int numPathMaskCacheHits() const { return fNumPathMaskCacheHits; }
        void incNumPathMasksCacheHits() { fNumPathMaskCacheHits++; }

#if GR_TEST_UTILS
        void dump(SkString* out) const;
        void dumpKeyValuePairs(SkTArray<SkString>* keys, SkTArray<double>* values) const;
#endif

    private:
        int fNumPathMasksGenerated{0};
        int fNumPathMaskCacheHits{0};

#else // GR_GPU_STATS
        void incNumPathMasksGenerated() {}
        void incNumPathMasksCacheHits() {}

#if GR_TEST_UTILS
        void dump(SkString*) const {}
        void dumpKeyValuePairs(SkTArray<SkString>* keys, SkTArray<double>* values) const {}
#endif
#endif // GR_GPU_STATS
    } fStats;

#if GR_GPU_STATS && GR_TEST_UTILS
    struct DMSAAStats {
        void dumpKeyValuePairs(SkTArray<SkString>* keys, SkTArray<double>* values) const;
        void dump() const;
        void merge(const DMSAAStats&);
        int fNumRenderPasses = 0;
        int fNumMultisampleRenderPasses = 0;
        std::map<std::string, int> fTriggerCounts;
    };

    DMSAAStats fDMSAAStats;
#endif

    Stats* stats() { return &fStats; }
    const Stats* stats() const { return &fStats; }
    void dumpJSON(SkJSONWriter*) const;

protected:
    // Delete last in case other objects call it during destruction.
    std::unique_ptr<GrAuditTrail>     fAuditTrail;

private:
    OwnedArenas                       fArenas;

    std::unique_ptr<GrDrawingManager> fDrawingManager;
    std::unique_ptr<GrProxyProvider>  fProxyProvider;

#if GR_TEST_UTILS
    int fSuppressWarningMessages = 0;
#endif

    using INHERITED = GrImageContext;
};

/**
 * Safely cast a possibly-null base context to direct context.
 */
static inline GrDirectContext* GrAsDirectContext(GrContext_Base* base) {
    return base ? base->asDirectContext() : nullptr;
}

#endif
