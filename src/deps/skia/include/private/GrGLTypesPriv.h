/*
 * Copyright 2019 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#include "include/core/SkRefCnt.h"
#include "include/gpu/gl/GrGLTypes.h"

#ifndef GrGLTypesPriv_DEFINED
#define GrGLTypesPriv_DEFINED

static constexpr int kGrGLColorFormatCount = static_cast<int>(GrGLFormat::kLastColorFormat) + 1;

class GrGLTextureParameters : public SkNVRefCnt<GrGLTextureParameters> {
public:
    // We currently consider texture parameters invalid on all textures
    // GrContext::resetContext(). We use this type to track whether instances of
    // GrGLTextureParameters were updated before or after the most recent resetContext(). At 10
    // resets / frame and 60fps a 64bit timestamp will overflow in about a billion years.
    // TODO: Require clients to use GrBackendTexture::glTextureParametersModified() to invalidate
    // texture parameters and get rid of timestamp checking.
    using ResetTimestamp = uint64_t;

    // This initializes the params to have an expired timestamp. They'll be considered invalid the
    // first time the texture is used unless set() is called.
    GrGLTextureParameters() = default;

    // This is texture parameter state that is overridden when a non-zero sampler object is bound.
    struct SamplerOverriddenState {
        SamplerOverriddenState();
        void invalidate();

        GrGLenum fMinFilter;
        GrGLenum fMagFilter;
        GrGLenum fWrapS;
        GrGLenum fWrapT;
        GrGLfloat fMinLOD;
        GrGLfloat fMaxLOD;
        // We always want the border color to be transparent black, so no need to store 4 floats.
        // Just track if it's been invalidated and no longer the default
        bool fBorderColorInvalid;
    };

    // Texture parameter state that is not overridden by a bound sampler object.
    struct NonsamplerState {
        NonsamplerState();
        void invalidate();

        GrGLint fBaseMipMapLevel;
        GrGLint fMaxMipmapLevel;
        bool    fSwizzleIsRGBA;
    };

    void invalidate();

    ResetTimestamp resetTimestamp() const { return fResetTimestamp; }
    const SamplerOverriddenState& samplerOverriddenState() const { return fSamplerOverriddenState; }
    const NonsamplerState& nonsamplerState() const { return fNonsamplerState; }

    // SamplerOverriddenState is optional because we don't track it when we're using sampler
    // objects.
    void set(const SamplerOverriddenState* samplerState,
             const NonsamplerState& nonsamplerState,
             ResetTimestamp currTimestamp);

private:
    static constexpr ResetTimestamp kExpiredTimestamp = 0;

    SamplerOverriddenState fSamplerOverriddenState;
    NonsamplerState fNonsamplerState;
    ResetTimestamp fResetTimestamp = kExpiredTimestamp;
};

class GrGLBackendTextureInfo {
public:
    GrGLBackendTextureInfo(const GrGLTextureInfo& info, GrGLTextureParameters* params)
            : fInfo(info), fParams(params) {}
    GrGLBackendTextureInfo(const GrGLBackendTextureInfo&) = delete;
    GrGLBackendTextureInfo& operator=(const GrGLBackendTextureInfo&) = delete;
    const GrGLTextureInfo& info() const { return fInfo; }
    GrGLTextureParameters* parameters() const { return fParams; }
    sk_sp<GrGLTextureParameters> refParameters() const { return sk_ref_sp(fParams); }

    void cleanup();
    void assign(const GrGLBackendTextureInfo&, bool thisIsValid);

private:
    GrGLTextureInfo fInfo;
    GrGLTextureParameters* fParams;
};

struct GrGLTextureSpec {
    GrGLTextureSpec() : fTarget(0), fFormat(0) {}
    GrGLTextureSpec(const GrGLSurfaceInfo& info) : fTarget(info.fTarget), fFormat(info.fFormat) {}

    GrGLenum fTarget;
    GrGLenum fFormat;
};

GrGLSurfaceInfo GrGLTextureSpecToSurfaceInfo(const GrGLTextureSpec& glSpec,
                                             uint32_t sampleCount,
                                             uint32_t levelCount,
                                             GrProtected isProtected);

#endif
