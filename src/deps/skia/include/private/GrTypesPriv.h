/*
 * Copyright 2013 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrTypesPriv_DEFINED
#define GrTypesPriv_DEFINED

#include <chrono>
#include "include/core/SkImage.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkPath.h"
#include "include/core/SkRefCnt.h"
#include "include/gpu/GrTypes.h"
#include "include/private/SkImageInfoPriv.h"
#include "include/private/SkMacros.h"

class GrBackendFormat;
class GrCaps;
class GrSurfaceProxy;

// The old libstdc++ uses the draft name "monotonic_clock" rather than "steady_clock". This might
// not actually be monotonic, depending on how libstdc++ was built. However, this is only currently
// used for idle resource purging so it shouldn't cause a correctness problem.
#if defined(__GLIBCXX__) && (__GLIBCXX__ < 20130000)
using GrStdSteadyClock = std::chrono::monotonic_clock;
#else
using GrStdSteadyClock = std::chrono::steady_clock;
#endif

/**
 *  divide, rounding up
 */

static inline constexpr size_t GrSizeDivRoundUp(size_t x, size_t y) { return (x + (y - 1)) / y; }

/**
 * Geometric primitives used for drawing.
 */
enum class GrPrimitiveType : uint8_t {
    kTriangles,
    kTriangleStrip,
    kPoints,
    kLines,          // 1 pix wide only
    kLineStrip,      // 1 pix wide only
    kPatches,
    kPath
};
static constexpr int kNumGrPrimitiveTypes = (int)GrPrimitiveType::kPath + 1;

static constexpr bool GrIsPrimTypeLines(GrPrimitiveType type) {
    return GrPrimitiveType::kLines == type || GrPrimitiveType::kLineStrip == type;
}

enum class GrPrimitiveRestart : bool {
    kNo = false,
    kYes = true
};

/**
 * Should a created surface be texturable?
 */
enum class GrTexturable : bool {
    kNo = false,
    kYes = true
};

// A DDL recorder has its own proxy provider and proxy cache. This enum indicates if
// a given proxy provider is one of these special ones.
enum class GrDDLProvider : bool {
    kNo = false,
    kYes = true
};

/**
 *  Formats for masks, used by the font cache. Important that these are 0-based.
 */
enum GrMaskFormat {
    kA8_GrMaskFormat,    //!< 1-byte per pixel
    kA565_GrMaskFormat,  //!< 2-bytes per pixel, RGB represent 3-channel LCD coverage
    kARGB_GrMaskFormat,  //!< 4-bytes per pixel, color format

    kLast_GrMaskFormat = kARGB_GrMaskFormat
};
static const int kMaskFormatCount = kLast_GrMaskFormat + 1;

/**
 *  Return the number of bytes-per-pixel for the specified mask format.
 */
inline constexpr int GrMaskFormatBytesPerPixel(GrMaskFormat format) {
    SkASSERT(format < kMaskFormatCount);
    // kA8   (0) -> 1
    // kA565 (1) -> 2
    // kARGB (2) -> 4
    static_assert(kA8_GrMaskFormat == 0, "enum_order_dependency");
    static_assert(kA565_GrMaskFormat == 1, "enum_order_dependency");
    static_assert(kARGB_GrMaskFormat == 2, "enum_order_dependency");

    return SkTo<int>(1u << format);
}

/** Ownership rules for external GPU resources imported into Skia. */
enum GrWrapOwnership {
    /** Skia will assume the client will keep the resource alive and Skia will not free it. */
    kBorrow_GrWrapOwnership,

    /** Skia will assume ownership of the resource and free it. */
    kAdopt_GrWrapOwnership,
};

enum class GrWrapCacheable : bool {
    /**
     * The wrapped resource will be removed from the cache as soon as it becomes purgeable. It may
     * still be assigned and found by a unique key, but the presence of the key will not be used to
     * keep the resource alive when it has no references.
     */
    kNo = false,
    /**
     * The wrapped resource is allowed to remain in the GrResourceCache when it has no references
     * but has a unique key. Such resources should only be given unique keys when it is known that
     * the key will eventually be removed from the resource or invalidated via the message bus.
     */
    kYes = true
};

enum class GrBudgetedType : uint8_t {
    /** The resource is budgeted and is subject to purging under budget pressure. */
    kBudgeted,
    /**
     * The resource is unbudgeted and is purged as soon as it has no refs regardless of whether
     * it has a unique or scratch key.
     */
    kUnbudgetedUncacheable,
    /**
     * The resource is unbudgeted and is allowed to remain in the cache with no refs if it
     * has a unique key. Scratch keys are ignored.
     */
    kUnbudgetedCacheable,
};

enum class GrScissorTest : bool {
    kDisabled = false,
    kEnabled = true
};

/*
 * Used to say whether texture is backed by memory.
 */
enum class GrMemoryless : bool {
    /**
     * The texture will be allocated normally and will affect memory budgets.
     */
    kNo = false,
    /**
     * The texture will be not use GPU memory and will not affect memory budgets.
     */
    kYes = true
};

struct GrMipLevel {
    const void* fPixels = nullptr;
    size_t fRowBytes = 0;
    // This may be used to keep fPixels from being freed while a GrMipLevel exists.
    sk_sp<SkData> fOptionalStorage;
};

enum class GrSemaphoreWrapType {
    kWillSignal,
    kWillWait,
};

/**
 * This enum is used to specify the load operation to be used when an OpsTask/GrOpsRenderPass
 * begins execution.
 */
enum class GrLoadOp {
    kLoad,
    kClear,
    kDiscard,
};

/**
 * This enum is used to specify the store operation to be used when an OpsTask/GrOpsRenderPass
 * ends execution.
 */
enum class GrStoreOp {
    kStore,
    kDiscard,
};

/**
 * Used to control antialiasing in draw calls.
 */
enum class GrAA : bool {
    kNo = false,
    kYes = true
};

enum class GrFillRule : bool {
    kNonzero,
    kEvenOdd
};

inline GrFillRule GrFillRuleForPathFillType(SkPathFillType fillType) {
    switch (fillType) {
        case SkPathFillType::kWinding:
        case SkPathFillType::kInverseWinding:
            return GrFillRule::kNonzero;
        case SkPathFillType::kEvenOdd:
        case SkPathFillType::kInverseEvenOdd:
            return GrFillRule::kEvenOdd;
    }
    SkUNREACHABLE;
}

inline GrFillRule GrFillRuleForSkPath(const SkPath& path) {
    return GrFillRuleForPathFillType(path.getFillType());
}

/** This enum indicates the type of antialiasing to be performed. */
enum class GrAAType : unsigned {
    /** No antialiasing */
    kNone,
    /** Use fragment shader code to blend with a fractional pixel coverage. */
    kCoverage,
    /** Use normal MSAA. */
    kMSAA,

    kLast = kMSAA
};
static const int kGrAATypeCount = static_cast<int>(GrAAType::kLast) + 1;

static constexpr bool GrAATypeIsHW(GrAAType type) {
    switch (type) {
        case GrAAType::kNone:
            return false;
        case GrAAType::kCoverage:
            return false;
        case GrAAType::kMSAA:
            return true;
    }
    SkUNREACHABLE;
}

/**
 * Some pixel configs are inherently clamped to [0,1], some are allowed to go outside that range,
 * and some are FP but manually clamped in the XP.
 */
enum class GrClampType {
    kAuto,    // Normalized, fixed-point configs
    kManual,  // Clamped FP configs
    kNone,    // Normal (unclamped) FP configs
};

/**
 * A number of rectangle/quadrilateral drawing APIs can control anti-aliasing on a per edge basis.
 * These masks specify which edges are AA'ed. The intent for this is to support tiling with seamless
 * boundaries, where the inner edges are non-AA and the outer edges are AA. Regular draws (where AA
 * is specified by GrAA) is almost equivalent to kNone or kAll, with the exception of how MSAA is
 * handled.
 *
 * When tiling and there is MSAA, mixed edge rectangles are processed with MSAA, so in order for the
 * tiled edges to remain seamless, inner tiles with kNone must also be processed with MSAA. In
 * regular drawing, however, kNone should disable MSAA (if it's supported) to match the expected
 * appearance.
 *
 * Therefore, APIs that use per-edge AA flags also take a GrAA value so that they can differentiate
 * between the regular and tiling use case behaviors. Tiling operations should always pass
 * GrAA::kYes while regular options should pass GrAA based on the SkPaint's anti-alias state.
 *
 * These values are identical to SkCanvas::QuadAAFlags.
 */
enum class GrQuadAAFlags {
    kLeft   = 0b0001,
    kTop    = 0b0010,
    kRight  = 0b0100,
    kBottom = 0b1000,

    kNone = 0b0000,
    kAll  = 0b1111,
};

GR_MAKE_BITFIELD_CLASS_OPS(GrQuadAAFlags)

static inline GrQuadAAFlags SkToGrQuadAAFlags(unsigned flags) {
    return static_cast<GrQuadAAFlags>(flags);
}

/**
 * Types of shader-language-specific boxed variables we can create.
 */
enum GrSLType {
    kVoid_GrSLType,
    kBool_GrSLType,
    kBool2_GrSLType,
    kBool3_GrSLType,
    kBool4_GrSLType,
    kShort_GrSLType,
    kShort2_GrSLType,
    kShort3_GrSLType,
    kShort4_GrSLType,
    kUShort_GrSLType,
    kUShort2_GrSLType,
    kUShort3_GrSLType,
    kUShort4_GrSLType,
    kFloat_GrSLType,
    kFloat2_GrSLType,
    kFloat3_GrSLType,
    kFloat4_GrSLType,
    kFloat2x2_GrSLType,
    kFloat3x3_GrSLType,
    kFloat4x4_GrSLType,
    kHalf_GrSLType,
    kHalf2_GrSLType,
    kHalf3_GrSLType,
    kHalf4_GrSLType,
    kHalf2x2_GrSLType,
    kHalf3x3_GrSLType,
    kHalf4x4_GrSLType,
    kInt_GrSLType,
    kInt2_GrSLType,
    kInt3_GrSLType,
    kInt4_GrSLType,
    kUInt_GrSLType,
    kUInt2_GrSLType,
    kUInt3_GrSLType,
    kUInt4_GrSLType,
    kTexture2DSampler_GrSLType,
    kTextureExternalSampler_GrSLType,
    kTexture2DRectSampler_GrSLType,
    kTexture2D_GrSLType,
    kSampler_GrSLType,
    kInput_GrSLType,

    kLast_GrSLType = kInput_GrSLType
};
static const int kGrSLTypeCount = kLast_GrSLType + 1;

/**
 * The type of texture. Backends other than GL currently only use the 2D value but the type must
 * still be known at the API-neutral layer as it used to determine whether MIP maps, renderability,
 * and sampling parameters are legal for proxies that will be instantiated with wrapped textures.
 */
enum class GrTextureType {
    kNone,
    k2D,
    /* Rectangle uses unnormalized texture coordinates. */
    kRectangle,
    kExternal
};

enum GrShaderType {
    kVertex_GrShaderType,
    kFragment_GrShaderType,

    kLastkFragment_GrShaderType = kFragment_GrShaderType
};
static const int kGrShaderTypeCount = kLastkFragment_GrShaderType + 1;

enum GrShaderFlags {
    kNone_GrShaderFlags          = 0,
    kVertex_GrShaderFlag         = 1 << 0,
    kTessControl_GrShaderFlag    = 1 << 1,
    kTessEvaluation_GrShaderFlag = 1 << 2,
    kFragment_GrShaderFlag       = 1 << 3
};
SK_MAKE_BITFIELD_OPS(GrShaderFlags)

/** Is the shading language type float (including vectors/matrices)? */
static constexpr bool GrSLTypeIsFloatType(GrSLType type) {
    switch (type) {
        case kFloat_GrSLType:
        case kFloat2_GrSLType:
        case kFloat3_GrSLType:
        case kFloat4_GrSLType:
        case kFloat2x2_GrSLType:
        case kFloat3x3_GrSLType:
        case kFloat4x4_GrSLType:
        case kHalf_GrSLType:
        case kHalf2_GrSLType:
        case kHalf3_GrSLType:
        case kHalf4_GrSLType:
        case kHalf2x2_GrSLType:
        case kHalf3x3_GrSLType:
        case kHalf4x4_GrSLType:
            return true;

        case kVoid_GrSLType:
        case kTexture2DSampler_GrSLType:
        case kTextureExternalSampler_GrSLType:
        case kTexture2DRectSampler_GrSLType:
        case kBool_GrSLType:
        case kBool2_GrSLType:
        case kBool3_GrSLType:
        case kBool4_GrSLType:
        case kShort_GrSLType:
        case kShort2_GrSLType:
        case kShort3_GrSLType:
        case kShort4_GrSLType:
        case kUShort_GrSLType:
        case kUShort2_GrSLType:
        case kUShort3_GrSLType:
        case kUShort4_GrSLType:
        case kInt_GrSLType:
        case kInt2_GrSLType:
        case kInt3_GrSLType:
        case kInt4_GrSLType:
        case kUInt_GrSLType:
        case kUInt2_GrSLType:
        case kUInt3_GrSLType:
        case kUInt4_GrSLType:
        case kTexture2D_GrSLType:
        case kSampler_GrSLType:
        case kInput_GrSLType:
            return false;
    }
    SkUNREACHABLE;
}

/** Is the shading language type integral (including vectors)? */
static constexpr bool GrSLTypeIsIntegralType(GrSLType type) {
    switch (type) {
        case kShort_GrSLType:
        case kShort2_GrSLType:
        case kShort3_GrSLType:
        case kShort4_GrSLType:
        case kUShort_GrSLType:
        case kUShort2_GrSLType:
        case kUShort3_GrSLType:
        case kUShort4_GrSLType:
        case kInt_GrSLType:
        case kInt2_GrSLType:
        case kInt3_GrSLType:
        case kInt4_GrSLType:
        case kUInt_GrSLType:
        case kUInt2_GrSLType:
        case kUInt3_GrSLType:
        case kUInt4_GrSLType:
            return true;

        case kFloat_GrSLType:
        case kFloat2_GrSLType:
        case kFloat3_GrSLType:
        case kFloat4_GrSLType:
        case kFloat2x2_GrSLType:
        case kFloat3x3_GrSLType:
        case kFloat4x4_GrSLType:
        case kHalf_GrSLType:
        case kHalf2_GrSLType:
        case kHalf3_GrSLType:
        case kHalf4_GrSLType:
        case kHalf2x2_GrSLType:
        case kHalf3x3_GrSLType:
        case kHalf4x4_GrSLType:
        case kVoid_GrSLType:
        case kTexture2DSampler_GrSLType:
        case kTextureExternalSampler_GrSLType:
        case kTexture2DRectSampler_GrSLType:
        case kBool_GrSLType:
        case kBool2_GrSLType:
        case kBool3_GrSLType:
        case kBool4_GrSLType:
        case kTexture2D_GrSLType:
        case kSampler_GrSLType:
        case kInput_GrSLType:
            return false;
    }
    SkUNREACHABLE;
}

/**
 * Is the shading language type supported as a uniform (ie, does it have a corresponding set
 * function on GrGLSLProgramDataManager)?
 */
static constexpr bool GrSLTypeCanBeUniformValue(GrSLType type) {
    return GrSLTypeIsFloatType(type) || GrSLTypeIsIntegralType(type);
}

/** If the type represents a single value or vector return the vector length, else -1. */
static constexpr int GrSLTypeVecLength(GrSLType type) {
    switch (type) {
        case kFloat_GrSLType:
        case kHalf_GrSLType:
        case kBool_GrSLType:
        case kShort_GrSLType:
        case kUShort_GrSLType:
        case kInt_GrSLType:
        case kUInt_GrSLType:
            return 1;

        case kFloat2_GrSLType:
        case kHalf2_GrSLType:
        case kBool2_GrSLType:
        case kShort2_GrSLType:
        case kUShort2_GrSLType:
        case kInt2_GrSLType:
        case kUInt2_GrSLType:
            return 2;

        case kFloat3_GrSLType:
        case kHalf3_GrSLType:
        case kBool3_GrSLType:
        case kShort3_GrSLType:
        case kUShort3_GrSLType:
        case kInt3_GrSLType:
        case kUInt3_GrSLType:
            return 3;

        case kFloat4_GrSLType:
        case kHalf4_GrSLType:
        case kBool4_GrSLType:
        case kShort4_GrSLType:
        case kUShort4_GrSLType:
        case kInt4_GrSLType:
        case kUInt4_GrSLType:
            return 4;

        case kFloat2x2_GrSLType:
        case kFloat3x3_GrSLType:
        case kFloat4x4_GrSLType:
        case kHalf2x2_GrSLType:
        case kHalf3x3_GrSLType:
        case kHalf4x4_GrSLType:
        case kVoid_GrSLType:
        case kTexture2DSampler_GrSLType:
        case kTextureExternalSampler_GrSLType:
        case kTexture2DRectSampler_GrSLType:
        case kTexture2D_GrSLType:
        case kSampler_GrSLType:
        case kInput_GrSLType:
            return -1;
    }
    SkUNREACHABLE;
}

static inline GrSLType GrSLCombinedSamplerTypeForTextureType(GrTextureType type) {
    switch (type) {
        case GrTextureType::k2D:
            return kTexture2DSampler_GrSLType;
        case GrTextureType::kRectangle:
            return kTexture2DRectSampler_GrSLType;
        case GrTextureType::kExternal:
            return kTextureExternalSampler_GrSLType;
        default:
            SK_ABORT("Unexpected texture type");
    }
}

/** Rectangle and external textures only support the clamp wrap mode and do not support
 *  MIP maps.
 */
static inline bool GrTextureTypeHasRestrictedSampling(GrTextureType type) {
    switch (type) {
        case GrTextureType::k2D:
            return false;
        case GrTextureType::kRectangle:
            return true;
        case GrTextureType::kExternal:
            return true;
        default:
            SK_ABORT("Unexpected texture type");
    }
}

static constexpr bool GrSLTypeIsCombinedSamplerType(GrSLType type) {
    switch (type) {
        case kTexture2DSampler_GrSLType:
        case kTextureExternalSampler_GrSLType:
        case kTexture2DRectSampler_GrSLType:
            return true;

        case kVoid_GrSLType:
        case kFloat_GrSLType:
        case kFloat2_GrSLType:
        case kFloat3_GrSLType:
        case kFloat4_GrSLType:
        case kFloat2x2_GrSLType:
        case kFloat3x3_GrSLType:
        case kFloat4x4_GrSLType:
        case kHalf_GrSLType:
        case kHalf2_GrSLType:
        case kHalf3_GrSLType:
        case kHalf4_GrSLType:
        case kHalf2x2_GrSLType:
        case kHalf3x3_GrSLType:
        case kHalf4x4_GrSLType:
        case kInt_GrSLType:
        case kInt2_GrSLType:
        case kInt3_GrSLType:
        case kInt4_GrSLType:
        case kUInt_GrSLType:
        case kUInt2_GrSLType:
        case kUInt3_GrSLType:
        case kUInt4_GrSLType:
        case kBool_GrSLType:
        case kBool2_GrSLType:
        case kBool3_GrSLType:
        case kBool4_GrSLType:
        case kShort_GrSLType:
        case kShort2_GrSLType:
        case kShort3_GrSLType:
        case kShort4_GrSLType:
        case kUShort_GrSLType:
        case kUShort2_GrSLType:
        case kUShort3_GrSLType:
        case kUShort4_GrSLType:
        case kTexture2D_GrSLType:
        case kSampler_GrSLType:
        case kInput_GrSLType:
            return false;
    }
    SkUNREACHABLE;
}

//////////////////////////////////////////////////////////////////////////////

/**
 * Types used to describe format of vertices in arrays.
 */
enum GrVertexAttribType {
    kFloat_GrVertexAttribType = 0,
    kFloat2_GrVertexAttribType,
    kFloat3_GrVertexAttribType,
    kFloat4_GrVertexAttribType,
    kHalf_GrVertexAttribType,
    kHalf2_GrVertexAttribType,
    kHalf4_GrVertexAttribType,

    kInt2_GrVertexAttribType,   // vector of 2 32-bit ints
    kInt3_GrVertexAttribType,   // vector of 3 32-bit ints
    kInt4_GrVertexAttribType,   // vector of 4 32-bit ints


    kByte_GrVertexAttribType,  // signed byte
    kByte2_GrVertexAttribType, // vector of 2 8-bit signed bytes
    kByte4_GrVertexAttribType, // vector of 4 8-bit signed bytes
    kUByte_GrVertexAttribType,  // unsigned byte
    kUByte2_GrVertexAttribType, // vector of 2 8-bit unsigned bytes
    kUByte4_GrVertexAttribType, // vector of 4 8-bit unsigned bytes

    kUByte_norm_GrVertexAttribType,  // unsigned byte, e.g. coverage, 0 -> 0.0f, 255 -> 1.0f.
    kUByte4_norm_GrVertexAttribType, // vector of 4 unsigned bytes, e.g. colors, 0 -> 0.0f,
                                     // 255 -> 1.0f.

    kShort2_GrVertexAttribType,       // vector of 2 16-bit shorts.
    kShort4_GrVertexAttribType,       // vector of 4 16-bit shorts.

    kUShort2_GrVertexAttribType,      // vector of 2 unsigned shorts. 0 -> 0, 65535 -> 65535.
    kUShort2_norm_GrVertexAttribType, // vector of 2 unsigned shorts. 0 -> 0.0f, 65535 -> 1.0f.

    kInt_GrVertexAttribType,
    kUInt_GrVertexAttribType,

    kUShort_norm_GrVertexAttribType,

    kUShort4_norm_GrVertexAttribType, // vector of 4 unsigned shorts. 0 -> 0.0f, 65535 -> 1.0f.

    kLast_GrVertexAttribType = kUShort4_norm_GrVertexAttribType
};
static const int kGrVertexAttribTypeCount = kLast_GrVertexAttribType + 1;

//////////////////////////////////////////////////////////////////////////////

/**
 * We have coverage effects that clip rendering to the edge of some geometric primitive.
 * This enum specifies how that clipping is performed. Not all factories that take a
 * GrClipEdgeType will succeed with all values and it is up to the caller to verify success.
 */
enum class GrClipEdgeType {
    kFillBW,
    kFillAA,
    kInverseFillBW,
    kInverseFillAA,

    kLast = kInverseFillAA
};
static const int kGrClipEdgeTypeCnt = (int) GrClipEdgeType::kLast + 1;

static constexpr bool GrClipEdgeTypeIsFill(const GrClipEdgeType edgeType) {
    return (GrClipEdgeType::kFillAA == edgeType || GrClipEdgeType::kFillBW == edgeType);
}

static constexpr bool GrClipEdgeTypeIsInverseFill(const GrClipEdgeType edgeType) {
    return (GrClipEdgeType::kInverseFillAA == edgeType ||
            GrClipEdgeType::kInverseFillBW == edgeType);
}

static constexpr bool GrClipEdgeTypeIsAA(const GrClipEdgeType edgeType) {
    return (GrClipEdgeType::kFillBW != edgeType &&
            GrClipEdgeType::kInverseFillBW != edgeType);
}

static inline GrClipEdgeType GrInvertClipEdgeType(const GrClipEdgeType edgeType) {
    switch (edgeType) {
        case GrClipEdgeType::kFillBW:
            return GrClipEdgeType::kInverseFillBW;
        case GrClipEdgeType::kFillAA:
            return GrClipEdgeType::kInverseFillAA;
        case GrClipEdgeType::kInverseFillBW:
            return GrClipEdgeType::kFillBW;
        case GrClipEdgeType::kInverseFillAA:
            return GrClipEdgeType::kFillAA;
    }
    SkUNREACHABLE;
}

/**
 * Indicates the type of pending IO operations that can be recorded for gpu resources.
 */
enum GrIOType {
    kRead_GrIOType,
    kWrite_GrIOType,
    kRW_GrIOType
};

/**
 * Indicates the type of data that a GPU buffer will be used for.
 */
enum class GrGpuBufferType {
    kVertex,
    kIndex,
    kDrawIndirect,
    kXferCpuToGpu,
    kXferGpuToCpu,
    kUniform,
};
static const int kGrGpuBufferTypeCount = static_cast<int>(GrGpuBufferType::kUniform) + 1;

/**
 * Provides a performance hint regarding the frequency at which a data store will be accessed.
 */
enum GrAccessPattern {
    /** Data store will be respecified repeatedly and used many times. */
    kDynamic_GrAccessPattern,
    /** Data store will be specified once and used many times. (Thus disqualified from caching.) */
    kStatic_GrAccessPattern,
    /** Data store will be specified once and used at most a few times. (Also can't be cached.) */
    kStream_GrAccessPattern,

    kLast_GrAccessPattern = kStream_GrAccessPattern
};

// Flags shared between the GrSurface & GrSurfaceProxy class hierarchies
enum class GrInternalSurfaceFlags {
    kNone                           = 0,

    // Texture-level

    // Means the pixels in the texture are read-only. Cannot also be a GrRenderTarget[Proxy].
    kReadOnly                       = 1 << 0,

    // RT-level

    // This flag is for use with GL only. It tells us that the internal render target wraps FBO 0.
    kGLRTFBOIDIs0                   = 1 << 1,

    // This means the render target is multisampled, and internally holds a non-msaa texture for
    // resolving into. The render target resolves itself by blitting into this internal texture.
    // (asTexture() might or might not return the internal texture, but if it does, we always
    // resolve the render target before accessing this texture's data.)
    kRequiresManualMSAAResolve      = 1 << 2,

    // This means the pixels in the render target are write-only. This is used for Dawn and Metal
    // swap chain targets which can be rendered to, but not read or copied.
    kFramebufferOnly                = 1 << 3,

    // This is a Vulkan only flag. If set the surface can be used as an input attachment in a
    // shader. This is used for doing in shader blending where we want to sample from the same
    // image we are drawing to.
    kVkRTSupportsInputAttachment    = 1 << 4,
};

GR_MAKE_BITFIELD_CLASS_OPS(GrInternalSurfaceFlags)

// 'GR_MAKE_BITFIELD_CLASS_OPS' defines the & operator on GrInternalSurfaceFlags to return bool.
// We want to find the bitwise & with these masks, so we declare them as ints.
constexpr static int kGrInternalTextureFlagsMask = static_cast<int>(
        GrInternalSurfaceFlags::kReadOnly);

// We don't include kVkRTSupportsInputAttachment in this mask since we check it manually. We don't
// require that both the surface and proxy have matching values for this flag. Instead we require
// if the proxy has it set then the surface must also have it set. All other flags listed here must
// match on the proxy and surface.
// TODO: Add back kFramebufferOnly flag here once we update SkSurfaceCharacterization to take it
// as a flag. skbug.com/10672
constexpr static int kGrInternalRenderTargetFlagsMask = static_cast<int>(
        GrInternalSurfaceFlags::kGLRTFBOIDIs0 |
        GrInternalSurfaceFlags::kRequiresManualMSAAResolve/* |
        GrInternalSurfaceFlags::kFramebufferOnly*/);

constexpr static int kGrInternalTextureRenderTargetFlagsMask =
        kGrInternalTextureFlagsMask | kGrInternalRenderTargetFlagsMask;

#ifdef SK_DEBUG
// Takes a pointer to a GrCaps, and will suppress prints if required
#define GrCapsDebugf(caps, ...)  if (!(caps)->suppressPrints()) SkDebugf(__VA_ARGS__)
#else
#define GrCapsDebugf(caps, ...) do {} while (0)
#endif

/**
 * Specifies if the holder owns the backend, OpenGL or Vulkan, object.
 */
enum class GrBackendObjectOwnership : bool {
    /** Holder does not destroy the backend object. */
    kBorrowed = false,
    /** Holder destroys the backend object. */
    kOwned = true
};

/*
 * Object for CPU-GPU synchronization
 */
typedef uint64_t GrFence;

/**
 * Used to include or exclude specific GPU path renderers for testing purposes.
 */
enum class GpuPathRenderers {
    kNone              =   0,  // Always use software masks and/or DefaultPathRenderer.
    kDashLine          =   1 << 0,
    kAtlas             =   1 << 1,
    kTessellation      =   1 << 2,
    kCoverageCounting  =   1 << 3,
    kAAHairline        =   1 << 4,
    kAAConvex          =   1 << 5,
    kAALinearizing     =   1 << 6,
    kSmall             =   1 << 7,
    kTriangulating     =   1 << 8,
    kDefault           = ((1 << 9) - 1)  // All path renderers.
};

/**
 * Used to describe the current state of Mips on a GrTexture
 */
enum class GrMipmapStatus {
    kNotAllocated, // Mips have not been allocated
    kDirty,        // Mips are allocated but the full mip tree does not have valid data
    kValid,        // All levels fully allocated and have valid data in them
};

GR_MAKE_BITFIELD_CLASS_OPS(GpuPathRenderers)

/**
 * Like SkColorType this describes a layout of pixel data in CPU memory. It specifies the channels,
 * their type, and width. This exists so that the GPU backend can have private types that have no
 * analog in the public facing SkColorType enum and omit types not implemented in the GPU backend.
 * It does not refer to a texture format and the mapping to texture formats may be many-to-many.
 * It does not specify the sRGB encoding of the stored values. The components are listed in order of
 * where they appear in memory. In other words the first component listed is in the low bits and
 * the last component in the high bits.
 */
enum class GrColorType {
    kUnknown,
    kAlpha_8,
    kBGR_565,
    kABGR_4444,  // This name differs from SkColorType. kARGB_4444_SkColorType is misnamed.
    kRGBA_8888,
    kRGBA_8888_SRGB,
    kRGB_888x,
    kRG_88,
    kBGRA_8888,
    kRGBA_1010102,
    kBGRA_1010102,
    kGray_8,
    kGrayAlpha_88,
    kAlpha_F16,
    kRGBA_F16,
    kRGBA_F16_Clamped,
    kRGBA_F32,

    kAlpha_16,
    kRG_1616,
    kRG_F16,
    kRGBA_16161616,

    // Unusual types that come up after reading back in cases where we are reassigning the meaning
    // of a texture format's channels to use for a particular color format but have to read back the
    // data to a full RGBA quadruple. (e.g. using a R8 texture format as A8 color type but the API
    // only supports reading to RGBA8.) None of these have SkColorType equivalents.
    kAlpha_8xxx,
    kAlpha_F32xxx,
    kGray_8xxx,

    // Types used to initialize backend textures.
    kRGB_888,
    kR_8,
    kR_16,
    kR_F16,
    kGray_F16,
    kBGRA_4444,
    kARGB_4444,

    kLast = kARGB_4444
};

static const int kGrColorTypeCnt = static_cast<int>(GrColorType::kLast) + 1;

static constexpr SkColorType GrColorTypeToSkColorType(GrColorType ct) {
    switch (ct) {
        case GrColorType::kUnknown:          return kUnknown_SkColorType;
        case GrColorType::kAlpha_8:          return kAlpha_8_SkColorType;
        case GrColorType::kBGR_565:          return kRGB_565_SkColorType;
        case GrColorType::kABGR_4444:        return kARGB_4444_SkColorType;
        case GrColorType::kRGBA_8888:        return kRGBA_8888_SkColorType;
        case GrColorType::kRGBA_8888_SRGB:   return kSRGBA_8888_SkColorType;
        case GrColorType::kRGB_888x:         return kRGB_888x_SkColorType;
        case GrColorType::kRG_88:            return kR8G8_unorm_SkColorType;
        case GrColorType::kBGRA_8888:        return kBGRA_8888_SkColorType;
        case GrColorType::kRGBA_1010102:     return kRGBA_1010102_SkColorType;
        case GrColorType::kBGRA_1010102:     return kBGRA_1010102_SkColorType;
        case GrColorType::kGray_8:           return kGray_8_SkColorType;
        case GrColorType::kGrayAlpha_88:     return kUnknown_SkColorType;
        case GrColorType::kAlpha_F16:        return kA16_float_SkColorType;
        case GrColorType::kRGBA_F16:         return kRGBA_F16_SkColorType;
        case GrColorType::kRGBA_F16_Clamped: return kRGBA_F16Norm_SkColorType;
        case GrColorType::kRGBA_F32:         return kRGBA_F32_SkColorType;
        case GrColorType::kAlpha_8xxx:       return kUnknown_SkColorType;
        case GrColorType::kAlpha_F32xxx:     return kUnknown_SkColorType;
        case GrColorType::kGray_8xxx:        return kUnknown_SkColorType;
        case GrColorType::kAlpha_16:         return kA16_unorm_SkColorType;
        case GrColorType::kRG_1616:          return kR16G16_unorm_SkColorType;
        case GrColorType::kRGBA_16161616:    return kR16G16B16A16_unorm_SkColorType;
        case GrColorType::kRG_F16:           return kR16G16_float_SkColorType;
        case GrColorType::kRGB_888:          return kUnknown_SkColorType;
        case GrColorType::kR_8:              return kUnknown_SkColorType;
        case GrColorType::kR_16:             return kUnknown_SkColorType;
        case GrColorType::kR_F16:            return kUnknown_SkColorType;
        case GrColorType::kGray_F16:         return kUnknown_SkColorType;
        case GrColorType::kARGB_4444:        return kUnknown_SkColorType;
        case GrColorType::kBGRA_4444:        return kUnknown_SkColorType;
    }
    SkUNREACHABLE;
}

static constexpr GrColorType SkColorTypeToGrColorType(SkColorType ct) {
    switch (ct) {
        case kUnknown_SkColorType:            return GrColorType::kUnknown;
        case kAlpha_8_SkColorType:            return GrColorType::kAlpha_8;
        case kRGB_565_SkColorType:            return GrColorType::kBGR_565;
        case kARGB_4444_SkColorType:          return GrColorType::kABGR_4444;
        case kRGBA_8888_SkColorType:          return GrColorType::kRGBA_8888;
        case kSRGBA_8888_SkColorType:         return GrColorType::kRGBA_8888_SRGB;
        case kRGB_888x_SkColorType:           return GrColorType::kRGB_888x;
        case kBGRA_8888_SkColorType:          return GrColorType::kBGRA_8888;
        case kGray_8_SkColorType:             return GrColorType::kGray_8;
        case kRGBA_F16Norm_SkColorType:       return GrColorType::kRGBA_F16_Clamped;
        case kRGBA_F16_SkColorType:           return GrColorType::kRGBA_F16;
        case kRGBA_1010102_SkColorType:       return GrColorType::kRGBA_1010102;
        case kRGB_101010x_SkColorType:        return GrColorType::kUnknown;
        case kBGRA_1010102_SkColorType:       return GrColorType::kBGRA_1010102;
        case kBGR_101010x_SkColorType:        return GrColorType::kUnknown;
        case kRGBA_F32_SkColorType:           return GrColorType::kRGBA_F32;
        case kR8G8_unorm_SkColorType:         return GrColorType::kRG_88;
        case kA16_unorm_SkColorType:          return GrColorType::kAlpha_16;
        case kR16G16_unorm_SkColorType:       return GrColorType::kRG_1616;
        case kA16_float_SkColorType:          return GrColorType::kAlpha_F16;
        case kR16G16_float_SkColorType:       return GrColorType::kRG_F16;
        case kR16G16B16A16_unorm_SkColorType: return GrColorType::kRGBA_16161616;
    }
    SkUNREACHABLE;
}

static constexpr uint32_t GrColorTypeChannelFlags(GrColorType ct) {
    switch (ct) {
        case GrColorType::kUnknown:          return 0;
        case GrColorType::kAlpha_8:          return kAlpha_SkColorChannelFlag;
        case GrColorType::kBGR_565:          return kRGB_SkColorChannelFlags;
        case GrColorType::kABGR_4444:        return kRGBA_SkColorChannelFlags;
        case GrColorType::kRGBA_8888:        return kRGBA_SkColorChannelFlags;
        case GrColorType::kRGBA_8888_SRGB:   return kRGBA_SkColorChannelFlags;
        case GrColorType::kRGB_888x:         return kRGB_SkColorChannelFlags;
        case GrColorType::kRG_88:            return kRG_SkColorChannelFlags;
        case GrColorType::kBGRA_8888:        return kRGBA_SkColorChannelFlags;
        case GrColorType::kRGBA_1010102:     return kRGBA_SkColorChannelFlags;
        case GrColorType::kBGRA_1010102:     return kRGBA_SkColorChannelFlags;
        case GrColorType::kGray_8:           return kGray_SkColorChannelFlag;
        case GrColorType::kGrayAlpha_88:     return kGrayAlpha_SkColorChannelFlags;
        case GrColorType::kAlpha_F16:        return kAlpha_SkColorChannelFlag;
        case GrColorType::kRGBA_F16:         return kRGBA_SkColorChannelFlags;
        case GrColorType::kRGBA_F16_Clamped: return kRGBA_SkColorChannelFlags;
        case GrColorType::kRGBA_F32:         return kRGBA_SkColorChannelFlags;
        case GrColorType::kAlpha_8xxx:       return kAlpha_SkColorChannelFlag;
        case GrColorType::kAlpha_F32xxx:     return kAlpha_SkColorChannelFlag;
        case GrColorType::kGray_8xxx:        return kGray_SkColorChannelFlag;
        case GrColorType::kAlpha_16:         return kAlpha_SkColorChannelFlag;
        case GrColorType::kRG_1616:          return kRG_SkColorChannelFlags;
        case GrColorType::kRGBA_16161616:    return kRGBA_SkColorChannelFlags;
        case GrColorType::kRG_F16:           return kRG_SkColorChannelFlags;
        case GrColorType::kRGB_888:          return kRGB_SkColorChannelFlags;
        case GrColorType::kR_8:              return kRed_SkColorChannelFlag;
        case GrColorType::kR_16:             return kRed_SkColorChannelFlag;
        case GrColorType::kR_F16:            return kRed_SkColorChannelFlag;
        case GrColorType::kGray_F16:         return kGray_SkColorChannelFlag;
        case GrColorType::kARGB_4444:        return kRGBA_SkColorChannelFlags;
        case GrColorType::kBGRA_4444:        return kRGBA_SkColorChannelFlags;
    }
    SkUNREACHABLE;
}

/**
 * Describes the encoding of channel data in a GrColorType.
 */
enum class GrColorTypeEncoding {
    kUnorm,
    kSRGBUnorm,
    // kSnorm,
    kFloat,
    // kSint
    // kUint
};

/**
 * Describes a GrColorType by how many bits are used for each color component and how they are
 * encoded. Currently all the non-zero channels share a single GrColorTypeEncoding. This could be
 * expanded to store separate encodings and to indicate which bits belong to which components.
 */
class GrColorFormatDesc {
public:
    static constexpr GrColorFormatDesc MakeRGBA(int rgba, GrColorTypeEncoding e) {
        return {rgba, rgba, rgba, rgba, 0, e};
    }

    static constexpr GrColorFormatDesc MakeRGBA(int rgb, int a, GrColorTypeEncoding e) {
        return {rgb, rgb, rgb, a, 0, e};
    }

    static constexpr GrColorFormatDesc MakeRGB(int rgb, GrColorTypeEncoding e) {
        return {rgb, rgb, rgb, 0, 0, e};
    }

    static constexpr GrColorFormatDesc MakeRGB(int r, int g, int b, GrColorTypeEncoding e) {
        return {r, g, b, 0, 0, e};
    }

    static constexpr GrColorFormatDesc MakeAlpha(int a, GrColorTypeEncoding e) {
        return {0, 0, 0, a, 0, e};
    }

    static constexpr GrColorFormatDesc MakeR(int r, GrColorTypeEncoding e) {
        return {r, 0, 0, 0, 0, e};
    }

    static constexpr GrColorFormatDesc MakeRG(int rg, GrColorTypeEncoding e) {
        return {rg, rg, 0, 0, 0, e};
    }

    static constexpr GrColorFormatDesc MakeGray(int grayBits, GrColorTypeEncoding e) {
        return {0, 0, 0, 0, grayBits, e};
    }

    static constexpr GrColorFormatDesc MakeGrayAlpha(int grayAlpha, GrColorTypeEncoding e) {
        return {0, 0, 0, 0, grayAlpha, e};
    }

    static constexpr GrColorFormatDesc MakeInvalid() { return {}; }

    constexpr int r() const { return fRBits; }
    constexpr int g() const { return fGBits; }
    constexpr int b() const { return fBBits; }
    constexpr int a() const { return fABits; }
    constexpr int operator[](int c) const {
        switch (c) {
            case 0: return this->r();
            case 1: return this->g();
            case 2: return this->b();
            case 3: return this->a();
        }
        SkUNREACHABLE;
    }

    constexpr int gray() const { return fGrayBits; }

    constexpr GrColorTypeEncoding encoding() const { return fEncoding; }

private:
    int fRBits = 0;
    int fGBits = 0;
    int fBBits = 0;
    int fABits = 0;
    int fGrayBits = 0;
    GrColorTypeEncoding fEncoding = GrColorTypeEncoding::kUnorm;

    constexpr GrColorFormatDesc() = default;

    constexpr GrColorFormatDesc(int r, int g, int b, int a, int gray, GrColorTypeEncoding encoding)
            : fRBits(r), fGBits(g), fBBits(b), fABits(a), fGrayBits(gray), fEncoding(encoding) {
        SkASSERT(r >= 0 && g >= 0 && b >= 0 && a >= 0 && gray >= 0);
        SkASSERT(!gray || (!r && !g && !b));
        SkASSERT(r || g || b || a || gray);
    }
};

static constexpr GrColorFormatDesc GrGetColorTypeDesc(GrColorType ct) {
    switch (ct) {
        case GrColorType::kUnknown:
            return GrColorFormatDesc::MakeInvalid();
        case GrColorType::kAlpha_8:
            return GrColorFormatDesc::MakeAlpha(8, GrColorTypeEncoding::kUnorm);
        case GrColorType::kBGR_565:
            return GrColorFormatDesc::MakeRGB(5, 6, 5, GrColorTypeEncoding::kUnorm);
        case GrColorType::kABGR_4444:
            return GrColorFormatDesc::MakeRGBA(4, GrColorTypeEncoding::kUnorm);
        case GrColorType::kRGBA_8888:
            return GrColorFormatDesc::MakeRGBA(8, GrColorTypeEncoding::kUnorm);
        case GrColorType::kRGBA_8888_SRGB:
            return GrColorFormatDesc::MakeRGBA(8, GrColorTypeEncoding::kSRGBUnorm);
        case GrColorType::kRGB_888x:
            return GrColorFormatDesc::MakeRGB(8, GrColorTypeEncoding::kUnorm);
        case GrColorType::kRG_88:
            return GrColorFormatDesc::MakeRG(8, GrColorTypeEncoding::kUnorm);
        case GrColorType::kBGRA_8888:
            return GrColorFormatDesc::MakeRGBA(8, GrColorTypeEncoding::kUnorm);
        case GrColorType::kRGBA_1010102:
            return GrColorFormatDesc::MakeRGBA(10, 2, GrColorTypeEncoding::kUnorm);
        case GrColorType::kBGRA_1010102:
            return GrColorFormatDesc::MakeRGBA(10, 2, GrColorTypeEncoding::kUnorm);
        case GrColorType::kGray_8:
            return GrColorFormatDesc::MakeGray(8, GrColorTypeEncoding::kUnorm);
        case GrColorType::kGrayAlpha_88:
            return GrColorFormatDesc::MakeGrayAlpha(8, GrColorTypeEncoding::kUnorm);
        case GrColorType::kAlpha_F16:
            return GrColorFormatDesc::MakeAlpha(16, GrColorTypeEncoding::kFloat);
        case GrColorType::kRGBA_F16:
            return GrColorFormatDesc::MakeRGBA(16, GrColorTypeEncoding::kFloat);
        case GrColorType::kRGBA_F16_Clamped:
            return GrColorFormatDesc::MakeRGBA(16, GrColorTypeEncoding::kFloat);
        case GrColorType::kRGBA_F32:
            return GrColorFormatDesc::MakeRGBA(32, GrColorTypeEncoding::kFloat);
        case GrColorType::kAlpha_8xxx:
            return GrColorFormatDesc::MakeAlpha(8, GrColorTypeEncoding::kUnorm);
        case GrColorType::kAlpha_F32xxx:
            return GrColorFormatDesc::MakeAlpha(32, GrColorTypeEncoding::kFloat);
        case GrColorType::kGray_8xxx:
            return GrColorFormatDesc::MakeGray(8, GrColorTypeEncoding::kUnorm);
        case GrColorType::kAlpha_16:
            return GrColorFormatDesc::MakeAlpha(16, GrColorTypeEncoding::kUnorm);
        case GrColorType::kRG_1616:
            return GrColorFormatDesc::MakeRG(16, GrColorTypeEncoding::kUnorm);
        case GrColorType::kRGBA_16161616:
            return GrColorFormatDesc::MakeRGBA(16, GrColorTypeEncoding::kUnorm);
        case GrColorType::kRG_F16:
            return GrColorFormatDesc::MakeRG(16, GrColorTypeEncoding::kFloat);
        case GrColorType::kRGB_888:
            return GrColorFormatDesc::MakeRGB(8, GrColorTypeEncoding::kUnorm);
        case GrColorType::kR_8:
            return GrColorFormatDesc::MakeR(8, GrColorTypeEncoding::kUnorm);
        case GrColorType::kR_16:
            return GrColorFormatDesc::MakeR(16, GrColorTypeEncoding::kUnorm);
        case GrColorType::kR_F16:
            return GrColorFormatDesc::MakeR(16, GrColorTypeEncoding::kFloat);
        case GrColorType::kGray_F16:
            return GrColorFormatDesc::MakeGray(16, GrColorTypeEncoding::kFloat);
        case GrColorType::kARGB_4444:
            return GrColorFormatDesc::MakeRGBA(4, GrColorTypeEncoding::kUnorm);
        case GrColorType::kBGRA_4444:
            return GrColorFormatDesc::MakeRGBA(4, GrColorTypeEncoding::kUnorm);
    }
    SkUNREACHABLE;
}

static constexpr GrClampType GrColorTypeClampType(GrColorType colorType) {
    if (GrGetColorTypeDesc(colorType).encoding() == GrColorTypeEncoding::kUnorm ||
        GrGetColorTypeDesc(colorType).encoding() == GrColorTypeEncoding::kSRGBUnorm) {
        return GrClampType::kAuto;
    }
    return GrColorType::kRGBA_F16_Clamped == colorType ? GrClampType::kManual : GrClampType::kNone;
}

// Consider a color type "wider" than n if it has more than n bits for any its representable
// channels.
static constexpr bool GrColorTypeIsWiderThan(GrColorType colorType, int n) {
    SkASSERT(n > 0);
    auto desc = GrGetColorTypeDesc(colorType);
    return (desc.r() && desc.r() > n )||
           (desc.g() && desc.g() > n) ||
           (desc.b() && desc.b() > n) ||
           (desc.a() && desc.a() > n) ||
           (desc.gray() && desc.gray() > n);
}

static constexpr bool GrColorTypeIsAlphaOnly(GrColorType ct) {
    return GrColorTypeChannelFlags(ct) == kAlpha_SkColorChannelFlag;
}

static constexpr bool GrColorTypeHasAlpha(GrColorType ct) {
    return GrColorTypeChannelFlags(ct) & kAlpha_SkColorChannelFlag;
}

static constexpr size_t GrColorTypeBytesPerPixel(GrColorType ct) {
    switch (ct) {
        case GrColorType::kUnknown:          return 0;
        case GrColorType::kAlpha_8:          return 1;
        case GrColorType::kBGR_565:          return 2;
        case GrColorType::kABGR_4444:        return 2;
        case GrColorType::kRGBA_8888:        return 4;
        case GrColorType::kRGBA_8888_SRGB:   return 4;
        case GrColorType::kRGB_888x:         return 4;
        case GrColorType::kRG_88:            return 2;
        case GrColorType::kBGRA_8888:        return 4;
        case GrColorType::kRGBA_1010102:     return 4;
        case GrColorType::kBGRA_1010102:     return 4;
        case GrColorType::kGray_8:           return 1;
        case GrColorType::kGrayAlpha_88:     return 2;
        case GrColorType::kAlpha_F16:        return 2;
        case GrColorType::kRGBA_F16:         return 8;
        case GrColorType::kRGBA_F16_Clamped: return 8;
        case GrColorType::kRGBA_F32:         return 16;
        case GrColorType::kAlpha_8xxx:       return 4;
        case GrColorType::kAlpha_F32xxx:     return 16;
        case GrColorType::kGray_8xxx:        return 4;
        case GrColorType::kAlpha_16:         return 2;
        case GrColorType::kRG_1616:          return 4;
        case GrColorType::kRGBA_16161616:    return 8;
        case GrColorType::kRG_F16:           return 4;
        case GrColorType::kRGB_888:          return 3;
        case GrColorType::kR_8:              return 1;
        case GrColorType::kR_16:             return 2;
        case GrColorType::kR_F16:            return 2;
        case GrColorType::kGray_F16:         return 2;
        case GrColorType::kARGB_4444:        return 2;
        case GrColorType::kBGRA_4444:        return 2;
    }
    SkUNREACHABLE;
}

// In general we try to not mix CompressionType and ColorType, but currently SkImage still requires
// an SkColorType even for CompressedTypes so we need some conversion.
static constexpr SkColorType GrCompressionTypeToSkColorType(SkImage::CompressionType compression) {
    switch (compression) {
        case SkImage::CompressionType::kNone:            return kUnknown_SkColorType;
        case SkImage::CompressionType::kETC2_RGB8_UNORM: return kRGB_888x_SkColorType;
        case SkImage::CompressionType::kBC1_RGB8_UNORM:  return kRGB_888x_SkColorType;
        case SkImage::CompressionType::kBC1_RGBA8_UNORM: return kRGBA_8888_SkColorType;
    }

    SkUNREACHABLE;
}

static constexpr GrColorType GrMaskFormatToColorType(GrMaskFormat format) {
    switch (format) {
        case kA8_GrMaskFormat:
            return GrColorType::kAlpha_8;
        case kA565_GrMaskFormat:
            return GrColorType::kBGR_565;
        case kARGB_GrMaskFormat:
            return GrColorType::kRGBA_8888;
    }
    SkUNREACHABLE;
}

/**
 * Ref-counted object that calls a callback from its destructor.
 */
class GrRefCntedCallback : public SkNVRefCnt<GrRefCntedCallback> {
public:
    using Context = void*;
    using Callback = void (*)(Context);

    static sk_sp<GrRefCntedCallback> Make(Callback proc, Context ctx) {
        if (!proc) {
            return nullptr;
        }
        return sk_sp<GrRefCntedCallback>(new GrRefCntedCallback(proc, ctx));
    }

    ~GrRefCntedCallback() { fReleaseProc(fReleaseCtx); }

    Context context() const { return fReleaseCtx; }

private:
    GrRefCntedCallback(Callback proc, Context ctx) : fReleaseProc(proc), fReleaseCtx(ctx) {}
    GrRefCntedCallback(const GrRefCntedCallback&) = delete;
    GrRefCntedCallback(GrRefCntedCallback&&) = delete;
    GrRefCntedCallback& operator=(const GrRefCntedCallback&) = delete;
    GrRefCntedCallback& operator=(GrRefCntedCallback&&) = delete;

    Callback fReleaseProc;
    Context fReleaseCtx;
};

enum class GrDstSampleFlags {
    kNone = 0,
    kRequiresTextureBarrier =   1 << 0,
    kAsInputAttachment = 1 << 1,
};
GR_MAKE_BITFIELD_CLASS_OPS(GrDstSampleFlags)

using GrVisitProxyFunc = std::function<void(GrSurfaceProxy*, GrMipmapped)>;

#if defined(SK_DEBUG) || GR_TEST_UTILS || defined(SK_ENABLE_DUMP_GPU)
static constexpr const char* GrBackendApiToStr(GrBackendApi api) {
    switch (api) {
        case GrBackendApi::kOpenGL:   return "OpenGL";
        case GrBackendApi::kVulkan:   return "Vulkan";
        case GrBackendApi::kMetal:    return "Metal";
        case GrBackendApi::kDirect3D: return "Direct3D";
        case GrBackendApi::kDawn:     return "Dawn";
        case GrBackendApi::kMock:     return "Mock";
    }
    SkUNREACHABLE;
}

static constexpr const char* GrColorTypeToStr(GrColorType ct) {
    switch (ct) {
        case GrColorType::kUnknown:          return "kUnknown";
        case GrColorType::kAlpha_8:          return "kAlpha_8";
        case GrColorType::kBGR_565:          return "kRGB_565";
        case GrColorType::kABGR_4444:        return "kABGR_4444";
        case GrColorType::kRGBA_8888:        return "kRGBA_8888";
        case GrColorType::kRGBA_8888_SRGB:   return "kRGBA_8888_SRGB";
        case GrColorType::kRGB_888x:         return "kRGB_888x";
        case GrColorType::kRG_88:            return "kRG_88";
        case GrColorType::kBGRA_8888:        return "kBGRA_8888";
        case GrColorType::kRGBA_1010102:     return "kRGBA_1010102";
        case GrColorType::kBGRA_1010102:     return "kBGRA_1010102";
        case GrColorType::kGray_8:           return "kGray_8";
        case GrColorType::kGrayAlpha_88:     return "kGrayAlpha_88";
        case GrColorType::kAlpha_F16:        return "kAlpha_F16";
        case GrColorType::kRGBA_F16:         return "kRGBA_F16";
        case GrColorType::kRGBA_F16_Clamped: return "kRGBA_F16_Clamped";
        case GrColorType::kRGBA_F32:         return "kRGBA_F32";
        case GrColorType::kAlpha_8xxx:       return "kAlpha_8xxx";
        case GrColorType::kAlpha_F32xxx:     return "kAlpha_F32xxx";
        case GrColorType::kGray_8xxx:        return "kGray_8xxx";
        case GrColorType::kAlpha_16:         return "kAlpha_16";
        case GrColorType::kRG_1616:          return "kRG_1616";
        case GrColorType::kRGBA_16161616:    return "kRGBA_16161616";
        case GrColorType::kRG_F16:           return "kRG_F16";
        case GrColorType::kRGB_888:          return "kRGB_888";
        case GrColorType::kR_8:              return "kR_8";
        case GrColorType::kR_16:             return "kR_16";
        case GrColorType::kR_F16:            return "kR_F16";
        case GrColorType::kGray_F16:         return "kGray_F16";
        case GrColorType::kARGB_4444:        return "kARGB_4444";
        case GrColorType::kBGRA_4444:        return "kBGRA_4444";
    }
    SkUNREACHABLE;
}

static constexpr const char* GrCompressionTypeToStr(SkImage::CompressionType compression) {
    switch (compression) {
        case SkImage::CompressionType::kNone:            return "kNone";
        case SkImage::CompressionType::kETC2_RGB8_UNORM: return "kETC2_RGB8_UNORM";
        case SkImage::CompressionType::kBC1_RGB8_UNORM:  return "kBC1_RGB8_UNORM";
        case SkImage::CompressionType::kBC1_RGBA8_UNORM: return "kBC1_RGBA8_UNORM";
    }
    SkUNREACHABLE;
}
#endif

#endif
