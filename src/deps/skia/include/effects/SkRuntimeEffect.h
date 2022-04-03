/*
 * Copyright 2019 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkRuntimeEffect_DEFINED
#define SkRuntimeEffect_DEFINED

#include "include/core/SkBlender.h"
#include "include/core/SkColorFilter.h"
#include "include/core/SkData.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkMatrix.h"
#include "include/core/SkShader.h"
#include "include/core/SkSpan.h"
#include "include/core/SkString.h"
#include "include/private/SkOnce.h"
#include "include/private/SkSLSampleUsage.h"
#include "include/private/SkTOptional.h"

#include <string>
#include <vector>

#ifdef SK_ENABLE_SKSL

class GrRecordingContext;
class SkFilterColorProgram;
class SkImage;
class SkRuntimeImageFilter;

namespace SkSL {
class DebugTrace;
class ErrorReporter;
class FunctionDefinition;
struct Program;
enum class ProgramKind : int8_t;
struct ProgramSettings;
}  // namespace SkSL

namespace skvm {
class Program;
}  // namespace skvm

/*
 * SkRuntimeEffect supports creating custom SkShader and SkColorFilter objects using Skia's SkSL
 * shading language.
 *
 * NOTE: This API is experimental and subject to change.
 */
class SK_API SkRuntimeEffect : public SkRefCnt {
public:
    // Reflected description of a uniform variable in the effect's SkSL
    struct Uniform {
        enum class Type {
            kFloat,
            kFloat2,
            kFloat3,
            kFloat4,
            kFloat2x2,
            kFloat3x3,
            kFloat4x4,
            kInt,
            kInt2,
            kInt3,
            kInt4,
        };

        enum Flags {
            // Uniform is an declared as an array. 'count' contains array length.
            kArray_Flag = 0x1,

            // Uniform is declared with layout(color). Colors should be supplied as unpremultiplied,
            // extended-range (unclamped) sRGB (ie SkColor4f). The uniform will be automatically
            // transformed to unpremultiplied extended-range working-space colors.
            kColor_Flag = 0x2,
        };

        SkString  name;
        size_t    offset;
        Type      type;
        int       count;
        uint32_t  flags;

        bool isArray() const { return SkToBool(this->flags & kArray_Flag); }
        bool isColor() const { return SkToBool(this->flags & kColor_Flag); }
        size_t sizeInBytes() const;
    };

    // Reflected description of a uniform child (shader or colorFilter) in the effect's SkSL
    enum class ChildType {
        kShader,
        kColorFilter,
        kBlender,
    };

    struct Child {
        SkString  name;
        ChildType type;
        int       index;
    };

    class Options {
    public:
        // For testing purposes, completely disable the inliner. (Normally, Runtime Effects don't
        // run the inliner directly, but they still get an inlining pass once they are painted.)
        bool forceNoInline = false;

    private:
        friend class SkRuntimeEffect;
        friend class SkRuntimeEffectPriv;

        // This flag lifts the ES2 restrictions on Runtime Effects that are gated by the
        // `strictES2Mode` check. Be aware that the software renderer and pipeline-stage effect are
        // still largely ES3-unaware and can still fail or crash if post-ES2 features are used.
        // This is only intended for use by tests and certain internally created effects.
        bool enforceES2Restrictions = true;

        // Similarly: Public SkSL does not allow access to sk_FragCoord. The semantics of that
        // variable are confusing, and expose clients to implementation details of saveLayer and
        // image filters.
        bool allowFragCoord = false;
    };

    // If the effect is compiled successfully, `effect` will be non-null.
    // Otherwise, `errorText` will contain the reason for failure.
    struct Result {
        sk_sp<SkRuntimeEffect> effect;
        SkString errorText;
    };

    // MakeForColorFilter and MakeForShader verify that the SkSL code is valid for those stages of
    // the Skia pipeline. In all of the signatures described below, color parameters and return
    // values are flexible. They are listed as being 'vec4', but they can also be 'half4' or
    // 'float4'. ('vec4' is an alias for 'float4').

    // We can't use a default argument for `options` due to a bug in Clang.
    // https://bugs.llvm.org/show_bug.cgi?id=36684

    // Color filter SkSL requires an entry point that looks like:
    //     vec4 main(vec4 inColor) { ... }
    static Result MakeForColorFilter(SkString sksl, const Options&);
    static Result MakeForColorFilter(SkString sksl) {
        return MakeForColorFilter(std::move(sksl), Options{});
    }

    // Shader SkSL requires an entry point that looks like:
    //     vec4 main(vec2 inCoords) { ... }
    //   -or-
    //     vec4 main(vec2 inCoords, vec4 inColor) { ... }
    //
    // Most shaders don't use the input color, so that parameter is optional.
    static Result MakeForShader(SkString sksl, const Options&);
    static Result MakeForShader(SkString sksl) {
        return MakeForShader(std::move(sksl), Options{});
    }

    // Blend SkSL requires an entry point that looks like:
    //     vec4 main(vec4 srcColor, vec4 dstColor) { ... }
    static Result MakeForBlender(SkString sksl, const Options&);
    static Result MakeForBlender(SkString sksl) {
        return MakeForBlender(std::move(sksl), Options{});
    }

    // DSL entry points
    static Result MakeForColorFilter(std::unique_ptr<SkSL::Program> program, const Options&);
    static Result MakeForColorFilter(std::unique_ptr<SkSL::Program> program);

    static Result MakeForShader(std::unique_ptr<SkSL::Program> program, const Options&);
    static Result MakeForShader(std::unique_ptr<SkSL::Program> program);
    static sk_sp<SkRuntimeEffect> MakeForShader(std::unique_ptr<SkSL::Program> program,
                                                const Options&, SkSL::ErrorReporter* errors);


    static Result MakeForBlender(std::unique_ptr<SkSL::Program> program, const Options&);
    static Result MakeForBlender(std::unique_ptr<SkSL::Program> program);

    // Object that allows passing a SkShader, SkColorFilter or SkBlender as a child
    class ChildPtr {
    public:
        ChildPtr() = default;
        ChildPtr(sk_sp<SkShader> s) : fChild(std::move(s)) {}
        ChildPtr(sk_sp<SkColorFilter> cf) : fChild(std::move(cf)) {}
        ChildPtr(sk_sp<SkBlender> b) : fChild(std::move(b)) {}

        skstd::optional<ChildType> type() const;

        SkShader* shader() const;
        SkColorFilter* colorFilter() const;
        SkBlender* blender() const;
        SkFlattenable* flattenable() const { return fChild.get(); }

    private:
        sk_sp<SkFlattenable> fChild;
    };

    sk_sp<SkShader> makeShader(sk_sp<SkData> uniforms,
                               sk_sp<SkShader> children[],
                               size_t childCount,
                               const SkMatrix* localMatrix,
                               bool isOpaque) const;
    sk_sp<SkShader> makeShader(sk_sp<SkData> uniforms,
                               SkSpan<ChildPtr> children,
                               const SkMatrix* localMatrix,
                               bool isOpaque) const;

    sk_sp<SkImage> makeImage(GrRecordingContext*,
                             sk_sp<SkData> uniforms,
                             SkSpan<ChildPtr> children,
                             const SkMatrix* localMatrix,
                             SkImageInfo resultInfo,
                             bool mipmapped) const;

    sk_sp<SkColorFilter> makeColorFilter(sk_sp<SkData> uniforms) const;
    sk_sp<SkColorFilter> makeColorFilter(sk_sp<SkData> uniforms,
                                         sk_sp<SkColorFilter> children[],
                                         size_t childCount) const;
    sk_sp<SkColorFilter> makeColorFilter(sk_sp<SkData> uniforms,
                                         SkSpan<ChildPtr> children) const;

    sk_sp<SkBlender> makeBlender(sk_sp<SkData> uniforms, SkSpan<ChildPtr> children = {}) const;

    /**
     * Creates a new Runtime Effect patterned after an already-existing one. The new shader behaves
     * like the original, but also creates a debug trace of its execution at the requested
     * coordinate. After painting with this shader, the associated DebugTrace object will contain a
     * shader execution trace. Call `writeTrace` on the debug trace object to generate a full trace
     * suitable for a debugger, or call `dump` to emit a human-readable trace.
     *
     * Debug traces are only supported on a raster (non-GPU) canvas.

     * Debug traces are currently only supported on shaders. Color filter and blender tracing is a
     * work-in-progress.
     */
    struct TracedShader {
        sk_sp<SkShader> shader;
        sk_sp<SkSL::DebugTrace> debugTrace;
    };
    static TracedShader MakeTraced(sk_sp<SkShader> shader, const SkIPoint& traceCoord);

    // Returns the SkSL source of the runtime effect shader.
    const std::string& source() const;

    // Combined size of all 'uniform' variables. When calling makeColorFilter or makeShader,
    // provide an SkData of this size, containing values for all of those variables.
    size_t uniformSize() const;

    SkSpan<const Uniform> uniforms() const { return SkMakeSpan(fUniforms); }
    SkSpan<const Child> children() const { return SkMakeSpan(fChildren); }

    // Returns pointer to the named uniform variable's description, or nullptr if not found
    const Uniform* findUniform(const char* name) const;

    // Returns pointer to the named child's description, or nullptr if not found
    const Child* findChild(const char* name) const;

    static void RegisterFlattenables();
    ~SkRuntimeEffect() override;

private:
    enum Flags {
        kUsesSampleCoords_Flag   = 0x01,
        kAllowColorFilter_Flag   = 0x02,
        kAllowShader_Flag        = 0x04,
        kAllowBlender_Flag       = 0x08,
        kSamplesOutsideMain_Flag = 0x10,
        kUsesColorTransform_Flag = 0x20,
    };

    SkRuntimeEffect(std::unique_ptr<SkSL::Program> baseProgram,
                    const Options& options,
                    const SkSL::FunctionDefinition& main,
                    std::vector<Uniform>&& uniforms,
                    std::vector<Child>&& children,
                    std::vector<SkSL::SampleUsage>&& sampleUsages,
                    uint32_t flags);

    sk_sp<SkRuntimeEffect> makeUnoptimizedClone();

    static Result MakeFromSource(SkString sksl, const Options& options, SkSL::ProgramKind kind);

    static Result MakeFromDSL(std::unique_ptr<SkSL::Program> program,
                              const Options& options,
                              SkSL::ProgramKind kind);

    static sk_sp<SkRuntimeEffect> MakeFromDSL(std::unique_ptr<SkSL::Program> program,
                                              const Options& options,
                                              SkSL::ProgramKind kind,
                                              SkSL::ErrorReporter* errors);

    static Result MakeInternal(std::unique_ptr<SkSL::Program> program,
                               const Options& options,
                               SkSL::ProgramKind kind);

    static SkSL::ProgramSettings MakeSettings(const Options& options, bool optimize);

    uint32_t hash() const { return fHash; }
    bool usesSampleCoords()   const { return (fFlags & kUsesSampleCoords_Flag);   }
    bool allowShader()        const { return (fFlags & kAllowShader_Flag);        }
    bool allowColorFilter()   const { return (fFlags & kAllowColorFilter_Flag);   }
    bool allowBlender()       const { return (fFlags & kAllowBlender_Flag);       }
    bool samplesOutsideMain() const { return (fFlags & kSamplesOutsideMain_Flag); }
    bool usesColorTransform() const { return (fFlags & kUsesColorTransform_Flag); }

    const SkFilterColorProgram* getFilterColorProgram();

#if SK_SUPPORT_GPU
    friend class GrSkSLFP;             // fBaseProgram, fSampleUsages
    friend class GrGLSLSkSLFP;         //
#endif

    friend class SkRTShader;            // fBaseProgram, fMain
    friend class SkRuntimeBlender;      //
    friend class SkRuntimeColorFilter;  //

    friend class SkFilterColorProgram;
    friend class SkRuntimeEffectPriv;

    uint32_t fHash;

    std::unique_ptr<SkSL::Program> fBaseProgram;
    const SkSL::FunctionDefinition& fMain;
    std::vector<Uniform> fUniforms;
    std::vector<Child> fChildren;
    std::vector<SkSL::SampleUsage> fSampleUsages;

    std::unique_ptr<SkFilterColorProgram> fFilterColorProgram;

    uint32_t fFlags;  // Flags
};

/** Base class for SkRuntimeShaderBuilder, defined below. */
class SkRuntimeEffectBuilder {
public:
    struct BuilderUniform {
        // Copy 'val' to this variable. No type conversion is performed - 'val' must be same
        // size as expected by the effect. Information about the variable can be queried by
        // looking at fVar. If the size is incorrect, no copy will be performed, and debug
        // builds will abort. If this is the result of querying a missing variable, fVar will
        // be nullptr, and assigning will also do nothing (and abort in debug builds).
        template <typename T>
        std::enable_if_t<std::is_trivially_copyable<T>::value, BuilderUniform&> operator=(
                const T& val) {
            if (!fVar) {
                SkDEBUGFAIL("Assigning to missing variable");
            } else if (sizeof(val) != fVar->sizeInBytes()) {
                SkDEBUGFAIL("Incorrect value size");
            } else {
                memcpy(SkTAddOffset<void>(fOwner->writableUniformData(), fVar->offset),
                       &val, sizeof(val));
            }
            return *this;
        }

        BuilderUniform& operator=(const SkMatrix& val) {
            if (!fVar) {
                SkDEBUGFAIL("Assigning to missing variable");
            } else if (fVar->sizeInBytes() != 9 * sizeof(float)) {
                SkDEBUGFAIL("Incorrect value size");
            } else {
                float* data = SkTAddOffset<float>(fOwner->writableUniformData(),
                                                  (ptrdiff_t)fVar->offset);
                data[0] = val.get(0); data[1] = val.get(3); data[2] = val.get(6);
                data[3] = val.get(1); data[4] = val.get(4); data[5] = val.get(7);
                data[6] = val.get(2); data[7] = val.get(5); data[8] = val.get(8);
            }
            return *this;
        }

        template <typename T>
        bool set(const T val[], const int count) {
            static_assert(std::is_trivially_copyable<T>::value, "Value must be trivial copyable");
            if (!fVar) {
                SkDEBUGFAIL("Assigning to missing variable");
                return false;
            } else if (sizeof(T) * count != fVar->sizeInBytes()) {
                SkDEBUGFAIL("Incorrect value size");
                return false;
            } else {
                memcpy(SkTAddOffset<void>(fOwner->writableUniformData(), fVar->offset),
                       val, sizeof(T) * count);
            }
            return true;
        }

        SkRuntimeEffectBuilder*         fOwner;
        const SkRuntimeEffect::Uniform* fVar;    // nullptr if the variable was not found
    };

    struct BuilderChild {
        template <typename T> BuilderChild& operator=(sk_sp<T> val) {
            if (!fChild) {
                SkDEBUGFAIL("Assigning to missing child");
            } else {
                fOwner->fChildren[(size_t)fChild->index] = std::move(val);
            }
            return *this;
        }

        BuilderChild& operator=(std::nullptr_t) {
            if (!fChild) {
                SkDEBUGFAIL("Assigning to missing child");
            } else {
                fOwner->fChildren[(size_t)fChild->index] = SkRuntimeEffect::ChildPtr{};
            }
            return *this;
        }

        SkRuntimeEffectBuilder*       fOwner;
        const SkRuntimeEffect::Child* fChild;  // nullptr if the child was not found
    };

    const SkRuntimeEffect* effect() const { return fEffect.get(); }

    BuilderUniform uniform(const char* name) { return { this, fEffect->findUniform(name) }; }
    BuilderChild child(const char* name) {
        const SkRuntimeEffect::Child* child = fEffect->findChild(name);
        return { this, child };
    }

protected:
    SkRuntimeEffectBuilder() = delete;
    explicit SkRuntimeEffectBuilder(sk_sp<SkRuntimeEffect> effect)
            : fEffect(std::move(effect))
            , fUniforms(SkData::MakeZeroInitialized(fEffect->uniformSize()))
            , fChildren(fEffect->children().size()) {}
    explicit SkRuntimeEffectBuilder(sk_sp<SkRuntimeEffect> effect, sk_sp<SkData> uniforms)
            : fEffect(std::move(effect))
            , fUniforms(std::move(uniforms))
            , fChildren(fEffect->children().size()) {}

    SkRuntimeEffectBuilder(SkRuntimeEffectBuilder&&) = default;
    SkRuntimeEffectBuilder(const SkRuntimeEffectBuilder&) = default;

    SkRuntimeEffectBuilder& operator=(SkRuntimeEffectBuilder&&) = delete;
    SkRuntimeEffectBuilder& operator=(const SkRuntimeEffectBuilder&) = delete;

    sk_sp<SkData> uniforms() { return fUniforms; }
    SkRuntimeEffect::ChildPtr* children() { return fChildren.data(); }
    size_t numChildren() { return fChildren.size(); }

private:
    void* writableUniformData() {
        if (!fUniforms->unique()) {
            fUniforms = SkData::MakeWithCopy(fUniforms->data(), fUniforms->size());
        }
        return fUniforms->writable_data();
    }

    sk_sp<SkRuntimeEffect>                 fEffect;
    sk_sp<SkData>                          fUniforms;
    std::vector<SkRuntimeEffect::ChildPtr> fChildren;
};

/**
 * SkRuntimeShaderBuilder is a utility to simplify creating SkShader objects from SkRuntimeEffects.
 *
 * NOTE: Like SkRuntimeEffect, this API is experimental and subject to change!
 *
 * Given an SkRuntimeEffect, the SkRuntimeShaderBuilder manages creating an input data block and
 * provides named access to the 'uniform' variables in that block, as well as named access
 * to a list of child shader slots. Usage:
 *
 *   sk_sp<SkRuntimeEffect> effect = ...;
 *   SkRuntimeShaderBuilder builder(effect);
 *   builder.uniform("some_uniform_float")  = 3.14f;
 *   builder.uniform("some_uniform_matrix") = SkM44::Rotate(...);
 *   builder.child("some_child_effect")     = mySkImage->makeShader(...);
 *   ...
 *   sk_sp<SkShader> shader = builder.makeShader(nullptr, false);
 *
 * Note that SkRuntimeShaderBuilder is built entirely on the public API of SkRuntimeEffect,
 * so can be used as-is or serve as inspiration for other interfaces or binding techniques.
 */
class SK_API SkRuntimeShaderBuilder : public SkRuntimeEffectBuilder {
public:
    explicit SkRuntimeShaderBuilder(sk_sp<SkRuntimeEffect>);
    // This is currently required by Android Framework but may go away if that dependency
    // can be removed.
    SkRuntimeShaderBuilder(const SkRuntimeShaderBuilder&) = default;
    ~SkRuntimeShaderBuilder();

    sk_sp<SkShader> makeShader(const SkMatrix* localMatrix, bool isOpaque);
    sk_sp<SkImage> makeImage(GrRecordingContext*,
                             const SkMatrix* localMatrix,
                             SkImageInfo resultInfo,
                             bool mipmapped);

private:
    using INHERITED = SkRuntimeEffectBuilder;

    explicit SkRuntimeShaderBuilder(sk_sp<SkRuntimeEffect> effect, sk_sp<SkData> uniforms)
            : INHERITED(std::move(effect), std::move(uniforms)) {}

    friend class SkRuntimeImageFilter;
};

/**
 * SkRuntimeBlendBuilder is a utility to simplify creation and uniform setup of runtime blenders.
 */
class SK_API SkRuntimeBlendBuilder : public SkRuntimeEffectBuilder {
public:
    explicit SkRuntimeBlendBuilder(sk_sp<SkRuntimeEffect>);
    ~SkRuntimeBlendBuilder();

    SkRuntimeBlendBuilder(const SkRuntimeBlendBuilder&) = delete;
    SkRuntimeBlendBuilder& operator=(const SkRuntimeBlendBuilder&) = delete;

    sk_sp<SkBlender> makeBlender();

private:
    using INHERITED = SkRuntimeEffectBuilder;
};

#endif  // SK_ENABLE_SKSL

#endif  // SkRuntimeEffect_DEFINED
