/*
 * Copyright 2010 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrTypes_DEFINED
#define GrTypes_DEFINED

#include "include/core/SkMath.h"
#include "include/core/SkTypes.h"
#include "include/gpu/GrConfig.h"

class GrBackendSemaphore;
class SkImage;
class SkSurface;

////////////////////////////////////////////////////////////////////////////////

/**
 * Wraps a C++11 enum that we use as a bitfield, and enables a limited amount of
 * masking with type safety. Instantiated with the ~ operator.
 */
template<typename TFlags> class GrTFlagsMask {
public:
    constexpr explicit GrTFlagsMask(TFlags value) : GrTFlagsMask(static_cast<int>(value)) {}
    constexpr explicit GrTFlagsMask(int value) : fValue(value) {}
    constexpr int value() const { return fValue; }
private:
    const int fValue;
};

/**
 * Defines bitwise operators that make it possible to use an enum class as a
 * basic bitfield.
 */
#define GR_MAKE_BITFIELD_CLASS_OPS(X) \
    SK_MAYBE_UNUSED constexpr GrTFlagsMask<X> operator~(X a) { \
        return GrTFlagsMask<X>(~static_cast<int>(a)); \
    } \
    SK_MAYBE_UNUSED constexpr X operator|(X a, X b) { \
        return static_cast<X>(static_cast<int>(a) | static_cast<int>(b)); \
    } \
    SK_MAYBE_UNUSED inline X& operator|=(X& a, X b) { \
        return (a = a | b); \
    } \
    SK_MAYBE_UNUSED constexpr bool operator&(X a, X b) { \
        return SkToBool(static_cast<int>(a) & static_cast<int>(b)); \
    } \
    SK_MAYBE_UNUSED constexpr GrTFlagsMask<X> operator|(GrTFlagsMask<X> a, GrTFlagsMask<X> b) { \
        return GrTFlagsMask<X>(a.value() | b.value()); \
    } \
    SK_MAYBE_UNUSED constexpr GrTFlagsMask<X> operator|(GrTFlagsMask<X> a, X b) { \
        return GrTFlagsMask<X>(a.value() | static_cast<int>(b)); \
    } \
    SK_MAYBE_UNUSED constexpr GrTFlagsMask<X> operator|(X a, GrTFlagsMask<X> b) { \
        return GrTFlagsMask<X>(static_cast<int>(a) | b.value()); \
    } \
    SK_MAYBE_UNUSED constexpr X operator&(GrTFlagsMask<X> a, GrTFlagsMask<X> b) { \
        return static_cast<X>(a.value() & b.value()); \
    } \
    SK_MAYBE_UNUSED constexpr X operator&(GrTFlagsMask<X> a, X b) { \
        return static_cast<X>(a.value() & static_cast<int>(b)); \
    } \
    SK_MAYBE_UNUSED constexpr X operator&(X a, GrTFlagsMask<X> b) { \
        return static_cast<X>(static_cast<int>(a) & b.value()); \
    } \
    SK_MAYBE_UNUSED inline X& operator&=(X& a, GrTFlagsMask<X> b) { \
        return (a = a & b); \
    } \

#define GR_DECL_BITFIELD_CLASS_OPS_FRIENDS(X) \
    friend constexpr GrTFlagsMask<X> operator ~(X); \
    friend constexpr X operator |(X, X); \
    friend X& operator |=(X&, X); \
    friend constexpr bool operator &(X, X); \
    friend constexpr GrTFlagsMask<X> operator|(GrTFlagsMask<X>, GrTFlagsMask<X>); \
    friend constexpr GrTFlagsMask<X> operator|(GrTFlagsMask<X>, X); \
    friend constexpr GrTFlagsMask<X> operator|(X, GrTFlagsMask<X>); \
    friend constexpr X operator&(GrTFlagsMask<X>, GrTFlagsMask<X>); \
    friend constexpr X operator&(GrTFlagsMask<X>, X); \
    friend constexpr X operator&(X, GrTFlagsMask<X>); \
    friend X& operator &=(X&, GrTFlagsMask<X>)

///////////////////////////////////////////////////////////////////////////////

/**
 * Possible 3D APIs that may be used by Ganesh.
 */
enum class GrBackendApi : unsigned {
    kOpenGL,
    kVulkan,
    kMetal,
    kDirect3D,
    kDawn,
    /**
     * Mock is a backend that does not draw anything. It is used for unit tests
     * and to measure CPU overhead.
     */
    kMock,

    /**
     * Added here to support the legacy GrBackend enum value and clients who referenced it using
     * GrBackend::kOpenGL_GrBackend.
     */
    kOpenGL_GrBackend = kOpenGL,
};

/**
 * Previously the above enum was not an enum class but a normal enum. To support the legacy use of
 * the enum values we define them below so that no clients break.
 */
typedef GrBackendApi GrBackend;

static constexpr GrBackendApi kMetal_GrBackend = GrBackendApi::kMetal;
static constexpr GrBackendApi kVulkan_GrBackend = GrBackendApi::kVulkan;
static constexpr GrBackendApi kMock_GrBackend = GrBackendApi::kMock;

///////////////////////////////////////////////////////////////////////////////

/**
 * Used to say whether a texture has mip levels allocated or not.
 */
enum class GrMipmapped : bool {
    kNo = false,
    kYes = true
};
/** Deprecated legacy alias of GrMipmapped. */
using GrMipMapped = GrMipmapped;

/*
 * Can a GrBackendObject be rendered to?
 */
enum class GrRenderable : bool {
    kNo = false,
    kYes = true
};

/*
 * Used to say whether texture is backed by protected memory.
 */
enum class GrProtected : bool {
    kNo = false,
    kYes = true
};

///////////////////////////////////////////////////////////////////////////////

/**
 * GPU SkImage and SkSurfaces can be stored such that (0, 0) in texture space may correspond to
 * either the top-left or bottom-left content pixel.
 */
enum GrSurfaceOrigin : int {
    kTopLeft_GrSurfaceOrigin,
    kBottomLeft_GrSurfaceOrigin,
};

/**
 * A GrContext's cache of backend context state can be partially invalidated.
 * These enums are specific to the GL backend and we'd add a new set for an alternative backend.
 */
enum GrGLBackendState {
    kRenderTarget_GrGLBackendState     = 1 << 0,
    // Also includes samplers bound to texture units.
    kTextureBinding_GrGLBackendState   = 1 << 1,
    // View state stands for scissor and viewport
    kView_GrGLBackendState             = 1 << 2,
    kBlend_GrGLBackendState            = 1 << 3,
    kMSAAEnable_GrGLBackendState       = 1 << 4,
    kVertex_GrGLBackendState           = 1 << 5,
    kStencil_GrGLBackendState          = 1 << 6,
    kPixelStore_GrGLBackendState       = 1 << 7,
    kProgram_GrGLBackendState          = 1 << 8,
    kFixedFunction_GrGLBackendState    = 1 << 9,
    kMisc_GrGLBackendState             = 1 << 10,
    kALL_GrGLBackendState              = 0xffff
};

/**
 * This value translates to reseting all the context state for any backend.
 */
static const uint32_t kAll_GrBackendState = 0xffffffff;

typedef void* GrGpuFinishedContext;
typedef void (*GrGpuFinishedProc)(GrGpuFinishedContext finishedContext);

typedef void* GrGpuSubmittedContext;
typedef void (*GrGpuSubmittedProc)(GrGpuSubmittedContext submittedContext, bool success);

/**
 * Struct to supply options to flush calls.
 *
 * After issuing all commands, fNumSemaphore semaphores will be signaled by the gpu. The client
 * passes in an array of fNumSemaphores GrBackendSemaphores. In general these GrBackendSemaphore's
 * can be either initialized or not. If they are initialized, the backend uses the passed in
 * semaphore. If it is not initialized, a new semaphore is created and the GrBackendSemaphore
 * object is initialized with that semaphore. The semaphores are not sent to the GPU until the next
 * GrContext::submit call is made. See the GrContext::submit for more information.
 *
 * The client will own and be responsible for deleting the underlying semaphores that are stored
 * and returned in initialized GrBackendSemaphore objects. The GrBackendSemaphore objects
 * themselves can be deleted as soon as this function returns.
 *
 * If a finishedProc is provided, the finishedProc will be called when all work submitted to the gpu
 * from this flush call and all previous flush calls has finished on the GPU. If the flush call
 * fails due to an error and nothing ends up getting sent to the GPU, the finished proc is called
 * immediately.
 *
 * If a submittedProc is provided, the submittedProc will be called when all work from this flush
 * call is submitted to the GPU. If the flush call fails due to an error and nothing will get sent
 * to the GPU, the submitted proc is called immediately. It is possibly that when work is finally
 * submitted, that the submission actual fails. In this case we will not reattempt to do the
 * submission. Skia notifies the client of these via the success bool passed into the submittedProc.
 * The submittedProc is useful to the client to know when semaphores that were sent with the flush
 * have actually been submitted to the GPU so that they can be waited on (or deleted if the submit
 * fails).
 * Note about GL: In GL work gets sent to the driver immediately during the flush call, but we don't
 * really know when the driver sends the work to the GPU. Therefore, we treat the submitted proc as
 * we do in other backends. It will be called when the next GrContext::submit is called after the
 * flush (or possibly during the flush if there is no work to be done for the flush). The main use
 * case for the submittedProc is to know when semaphores have been sent to the GPU and even in GL
 * it is required to call GrContext::submit to flush them. So a client should be able to treat all
 * backend APIs the same in terms of how the submitted procs are treated.
 */
struct GrFlushInfo {
    size_t fNumSemaphores = 0;
    GrBackendSemaphore* fSignalSemaphores = nullptr;
    GrGpuFinishedProc fFinishedProc = nullptr;
    GrGpuFinishedContext fFinishedContext = nullptr;
    GrGpuSubmittedProc fSubmittedProc = nullptr;
    GrGpuSubmittedContext fSubmittedContext = nullptr;
};

/**
 * Enum used as return value when flush with semaphores so the client knows whether the valid
 * semaphores will be submitted on the next GrContext::submit call.
 */
enum class GrSemaphoresSubmitted : bool {
    kNo = false,
    kYes = true
};

#endif
