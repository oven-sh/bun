/*
 * Copyright 2015 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrContextOptions_DEFINED
#define GrContextOptions_DEFINED

#include "include/core/SkData.h"
#include "include/core/SkString.h"
#include "include/core/SkTypes.h"
#include "include/gpu/GrDriverBugWorkarounds.h"
#include "include/gpu/GrTypes.h"
#include "include/gpu/ShaderErrorHandler.h"
#include "include/private/GrTypesPriv.h"

#include <vector>

class SkExecutor;

#if SK_SUPPORT_GPU
struct SK_API GrContextOptions {
    enum class Enable {
        /** Forces an option to be disabled. */
        kNo,
        /** Forces an option to be enabled. */
        kYes,
        /**
         * Uses Skia's default behavior, which may use runtime properties (e.g. driver version).
         */
        kDefault
    };

    enum class ShaderCacheStrategy {
        kSkSL,
        kBackendSource,
        kBackendBinary,
    };

    /**
     * Abstract class which stores Skia data in a cache that persists between sessions. Currently,
     * Skia stores compiled shader binaries (only when glProgramBinary / glGetProgramBinary are
     * supported) when provided a persistent cache, but this may extend to other data in the future.
     */
    class SK_API PersistentCache {
    public:
        virtual ~PersistentCache() = default;

        /**
         * Returns the data for the key if it exists in the cache, otherwise returns null.
         */
        virtual sk_sp<SkData> load(const SkData& key) = 0;

        // Placeholder until all clients override the 3-parameter store(), then remove this, and
        // make that version pure virtual.
        virtual void store(const SkData& /*key*/, const SkData& /*data*/) { SkASSERT(false); }

        /**
         * Stores data in the cache, indexed by key. description provides a human-readable
         * version of the key.
         */
        virtual void store(const SkData& key, const SkData& data, const SkString& /*description*/) {
            this->store(key, data);
        }

    protected:
        PersistentCache() = default;
        PersistentCache(const PersistentCache&) = delete;
        PersistentCache& operator=(const PersistentCache&) = delete;
    };

    using ShaderErrorHandler = skgpu::ShaderErrorHandler;

    GrContextOptions() {}

    // Suppress prints for the GrContext.
    bool fSuppressPrints = false;

    /**
     * Controls whether we check for GL errors after functions that allocate resources (e.g.
     * glTexImage2D), for shader compilation success, and program link success. Ignored on
     * backends other than GL.
     */
    Enable fSkipGLErrorChecks = Enable::kDefault;

    /** Overrides: These options override feature detection using backend API queries. These
        overrides can only reduce the feature set or limits, never increase them beyond the
        detected values. */

    int  fMaxTextureSizeOverride = SK_MaxS32;

    /** the threshold in bytes above which we will use a buffer mapping API to map vertex and index
        buffers to CPU memory in order to update them.  A value of -1 means the GrContext should
        deduce the optimal value for this platform. */
    int  fBufferMapThreshold = -1;

    /**
     * Executor to handle threaded work within Ganesh. If this is nullptr, then all work will be
     * done serially on the main thread. To have worker threads assist with various tasks, set this
     * to a valid SkExecutor instance. Currently, used for software path rendering, but may be used
     * for other tasks.
     */
    SkExecutor* fExecutor = nullptr;

    /** Construct mipmaps manually, via repeated downsampling draw-calls. This is used when
        the driver's implementation (glGenerateMipmap) contains bugs. This requires mipmap
        level control (ie desktop or ES3). */
    bool fDoManualMipmapping = false;

    /**
     * Disables the use of coverage counting shortcuts to render paths. Coverage counting can cause
     * artifacts along shared edges if care isn't taken to ensure both contours wind in the same
     * direction.
     */
    // FIXME: Once this is removed from Chrome and Android, rename to fEnable"".
    bool fDisableCoverageCountingPaths = true;

    /**
     * Disables distance field rendering for paths. Distance field computation can be expensive,
     * and yields no benefit if a path is not rendered multiple times with different transforms.
     */
    bool fDisableDistanceFieldPaths = false;

    /**
     * If true this allows path mask textures to be cached. This is only really useful if paths
     * are commonly rendered at the same scale and fractional translation.
     */
    bool fAllowPathMaskCaching = true;

    /**
     * If true, the GPU will not be used to perform YUV -> RGB conversion when generating
     * textures from codec-backed images.
     */
    bool fDisableGpuYUVConversion = false;

    /**
     * The maximum size of cache textures used for Skia's Glyph cache.
     */
    size_t fGlyphCacheTextureMaximumBytes = 2048 * 1024 * 4;

    /**
     * Below this threshold size in device space distance field fonts won't be used. Distance field
     * fonts don't support hinting which is more important at smaller sizes.
     */
    float fMinDistanceFieldFontSize = 18;

    /**
     * Above this threshold size in device space glyphs are drawn as individual paths.
     */
#if defined(SK_BUILD_FOR_ANDROID)
    float fGlyphsAsPathsFontSize = 384;
#elif defined(SK_BUILD_FOR_MAC)
    float fGlyphsAsPathsFontSize = 256;
#else
    float fGlyphsAsPathsFontSize = 324;
#endif

    /**
     * Can the glyph atlas use multiple textures. If allowed, the each texture's size is bound by
     * fGlypheCacheTextureMaximumBytes.
     */
    Enable fAllowMultipleGlyphCacheTextures = Enable::kDefault;

    /**
     * Bugs on certain drivers cause stencil buffers to leak. This flag causes Skia to avoid
     * allocating stencil buffers and use alternate rasterization paths, avoiding the leak.
     */
    bool fAvoidStencilBuffers = false;

    /**
     * If true, texture fetches from mip-mapped textures will be biased to read larger MIP levels.
     * This has the effect of sharpening those textures, at the cost of some aliasing, and possible
     * performance impact.
     */
    bool fSharpenMipmappedTextures = false;

    /**
     * Enables driver workaround to use draws instead of HW clears, e.g. glClear on the GL backend.
     */
    Enable fUseDrawInsteadOfClear = Enable::kDefault;

    /**
     * Allow Ganesh to more aggressively reorder operations to reduce the number of render passes.
     * Offscreen draws will be done upfront instead of interrupting the main render pass when
     * possible. May increase VRAM usage, but still observes the resource cache limit.
     * Enabled by default.
     */
    Enable fReduceOpsTaskSplitting = Enable::kDefault;

    /**
     * Some ES3 contexts report the ES2 external image extension, but not the ES3 version.
     * If support for external images is critical, enabling this option will cause Ganesh to limit
     * shaders to the ES2 shading language in that situation.
     */
    bool fPreferExternalImagesOverES3 = false;

    /**
     * Disables correctness workarounds that are enabled for particular GPUs, OSes, or drivers.
     * This does not affect code path choices that are made for perfomance reasons nor does it
     * override other GrContextOption settings.
     */
    bool fDisableDriverCorrectnessWorkarounds = false;

    /**
     * Maximum number of GPU programs or pipelines to keep active in the runtime cache.
     */
    int fRuntimeProgramCacheSize = 256;

    /**
     * Cache in which to store compiled shader binaries between runs.
     */
    PersistentCache* fPersistentCache = nullptr;

    /**
     * This affects the usage of the PersistentCache. We can cache SkSL, backend source (GLSL), or
     * backend binaries (GL program binaries). By default we cache binaries, but if the driver's
     * binary loading/storing is believed to have bugs, this can be limited to caching GLSL.
     * Caching GLSL strings still saves CPU work when a GL program is created.
     */
    ShaderCacheStrategy fShaderCacheStrategy = ShaderCacheStrategy::kBackendBinary;

    /**
     * If present, use this object to report shader compilation failures. If not, report failures
     * via SkDebugf and assert.
     */
    ShaderErrorHandler* fShaderErrorHandler = nullptr;

    /**
     * Specifies the number of samples Ganesh should use when performing internal draws with MSAA
     * (hardware capabilities permitting).
     *
     * If 0, Ganesh will disable internal code paths that use multisampling.
     */
    int  fInternalMultisampleCount = 4;

    /**
     * In Skia's vulkan backend a single GrContext submit equates to the submission of a single
     * primary command buffer to the VkQueue. This value specifies how many vulkan secondary command
     * buffers we will cache for reuse on a given primary command buffer. A single submit may use
     * more than this many secondary command buffers, but after the primary command buffer is
     * finished on the GPU it will only hold on to this many secondary command buffers for reuse.
     *
     * A value of -1 means we will pick a limit value internally.
     */
    int fMaxCachedVulkanSecondaryCommandBuffers = -1;

    /**
     * If true, the caps will never support mipmaps.
     */
    bool fSuppressMipmapSupport = false;

    /**
     * If true, and if supported, enables hardware tessellation in the caps.
     */
    bool fEnableExperimentalHardwareTessellation = false;

    /**
     * If true, then add 1 pixel padding to all glyph masks in the atlas to support bi-lerp
     * rendering of all glyphs. This must be set to true to use GrSlug.
     */
    #if defined(SK_EXPERIMENTAL_SIMULATE_DRAWGLYPHRUNLIST_WITH_SLUG)
    bool fSupportBilerpFromGlyphAtlas = true;
    #else
    bool fSupportBilerpFromGlyphAtlas = false;
    #endif

    /**
     * Uses a reduced variety of shaders. May perform less optimally in steady state but can reduce
     * jank due to shader compilations.
     */
    bool fReducedShaderVariations = false;

    /**
     * If true, then allow to enable MSAA on new Intel GPUs.
     */
    bool fAllowMSAAOnNewIntel = false;

#if GR_TEST_UTILS
    /**
     * Private options that are only meant for testing within Skia's tools.
     */

    /**
     * Prevents use of dual source blending, to test that all xfer modes work correctly without it.
     */
    bool fSuppressDualSourceBlending = false;

    /**
     * Prevents the use of non-coefficient-based blend equations, for testing dst reads, barriers,
     * and in-shader blending.
     */
    bool fSuppressAdvancedBlendEquations = false;

    /**
     * Prevents the use of framebuffer fetches, for testing dst reads and texture barriers.
     */
    bool fSuppressFramebufferFetch = false;

    /**
     * If greater than zero and less than the actual hardware limit, overrides the maximum number of
     * tessellation segments supported by the caps.
     */
    int  fMaxTessellationSegmentsOverride = 0;

    /**
     * If true, then all paths are processed as if "setIsVolatile" had been called.
     */
    bool fAllPathsVolatile = false;

    /**
     * Render everything in wireframe
     */
    bool fWireframeMode = false;

    /**
     * Enforces clearing of all textures when they're created.
     */
    bool fClearAllTextures = false;

    /**
     * Randomly generate a (false) GL_OUT_OF_MEMORY error
     */
    bool fRandomGLOOM = false;

    /**
     * Force off support for write/transfer pixels row bytes in caps.
     */
    bool fDisallowWriteAndTransferPixelRowBytes = false;

    /**
     * Include or exclude specific GPU path renderers.
     */
    GpuPathRenderers fGpuPathRenderers = GpuPathRenderers::kDefault;

    /**
     * Specify the GPU resource cache limit. Equivalent to calling `setResourceCacheLimit` on the
     * context at construction time.
     *
     * A value of -1 means use the default limit value.
     */
    int fResourceCacheLimitOverride = -1;

    /**
     * If true, then always try to use hardware tessellation, regardless of how small a path may be.
     */
    bool fAlwaysPreferHardwareTessellation = false;

    /**
     * Maximum width and height of internal texture atlases.
     */
    int  fMaxTextureAtlasSize = 2048;
#endif

    GrDriverBugWorkarounds fDriverBugWorkarounds;
};
#else
struct GrContextOptions {
    struct PersistentCache {};
};
#endif

#endif
