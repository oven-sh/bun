/*
 * Copyright 2021 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkCustomMesh_DEFINED
#define SkCustomMesh_DEFINED

#include "include/core/SkTypes.h"

#ifdef SK_ENABLE_SKSL
#include "include/core/SkColorSpace.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkRect.h"
#include "include/core/SkRefCnt.h"
#include "include/core/SkSpan.h"
#include "include/core/SkString.h"

#include <vector>

namespace SkSL { struct Program; }

/**
 * A specification for custom meshes. Specifies the vertex buffer attributes and stride, the
 * vertex program that produces a user-defined set of varyings, a fragment program that ingests
 * the interpolated varyings and produces local coordinates and optionally a color.
 *
 * The signature of the vertex program must be:
 *   float2 main(Attributes, out Varyings)
 * where the return value is a local position that will be transformed by SkCanvas's matrix.
 *
 * The signature of the fragment program must be either:
 *   (float2|void) main(Varyings)
 * or
 *   (float2|void) main(Varyings, out (half4|float4) color)
 *
 * where the return value is the local coordinates that will be used to access SkShader. If the
 * return type is void then the interpolated position from vertex shader return is used as the local
 * coordinate. If the color variant is used it will be blended with SkShader (or SkPaint color in
 * absence of a shader) using the SkBlender provided to the SkCanvas draw call.
 */
class SkCustomMeshSpecification : public SkNVRefCnt<SkCustomMeshSpecification> {
public:
    /** These values are enforced when creating a specification. */
    static constexpr size_t kMaxStride       = 1024;
    static constexpr size_t kMaxAttributes   = 8;
    static constexpr size_t kStrideAlignment = 4;
    static constexpr size_t kOffsetAlignment = 4;
    static constexpr size_t kMaxVaryings     = 6;

    struct Attribute {
        enum class Type : uint32_t {  // CPU representation     Shader Type
            kFloat,                   // float                  float
            kFloat2,                  // two floats             float2
            kFloat3,                  // three floats           float3
            kFloat4,                  // four floats            float4
            kUByte4_unorm,            // four bytes             half4

            kLast = kUByte4_unorm
        };
        Type     type;
        size_t   offset;
        SkString name;
    };

    struct Varying {
        enum class Type : uint32_t {
            kFloat,   // "float"
            kFloat2,  // "float2"
            kFloat3,  // "float3"
            kFloat4,  // "float4"
            kHalf,    // "half"
            kHalf2,   // "half2"
            kHalf3,   // "half3"
            kHalf4,   // "half4"

            kLast = kHalf4
        };
        Type     type;
        SkString name;
    };

    ~SkCustomMeshSpecification();

    struct Result {
        sk_sp<SkCustomMeshSpecification> specification;
        SkString                         error;
    };

    /**
     * If successful the return is a specification and an empty error string. Otherwise, it is a
     * null specification a non-empty error string.
     *
     * @param attributes     The vertex attributes that will be consumed by 'vs'. Attributes need
     *                       not be tightly packed but attribute offsets must be aligned to
     *                       kOffsetAlignment and offset + size may not be greater than
     *                       'vertexStride'. At least one attribute is required.
     * @param vertexStride   The offset between successive attribute values. This must be aligned to
     *                       kStrideAlignment.
     * @param varyings       The varyings that will be written by 'vs' and read by 'fs'. This may
     *                       be empty.
     * @param vs             The vertex shader code that computes a vertex position and the varyings
     *                       from the attributes.
     * @param fs             The fragment code that computes a local coordinate and optionally a
     *                       color from the varyings. The local coordinate is used to sample
     *                       SkShader.
     * @param cs             The colorspace of the color produced by 'fs'. Ignored if 'fs's main()
     *                       function does not have a color out param.
     * @param at             The alpha type of the color produced by 'fs'. Ignored if 'fs's main()
     *                       function does not have a color out param. Cannot be kUnknown.
     */
    static Result Make(SkSpan<const Attribute> attributes,
                       size_t                  vertexStride,
                       SkSpan<const Varying>   varyings,
                       const SkString&         vs,
                       const SkString&         fs,
                       sk_sp<SkColorSpace>     cs = SkColorSpace::MakeSRGB(),
                       SkAlphaType             at = kPremul_SkAlphaType);

    SkSpan<const Attribute> attributes() const { return SkMakeSpan(fAttributes); }

    size_t stride() const { return fStride; }

private:
    friend struct SkCustomMeshSpecificationPriv;

    enum class ColorType {
        kNone,
        kHalf4,
        kFloat4,
    };

    static Result MakeFromSourceWithStructs(SkSpan<const Attribute> attributes,
                                            size_t                  stride,
                                            SkSpan<const Varying>   varyings,
                                            const SkString&         vs,
                                            const SkString&         fs,
                                            sk_sp<SkColorSpace>     cs,
                                            SkAlphaType             at);

    SkCustomMeshSpecification(SkSpan<const Attribute>,
                              size_t,
                              SkSpan<const Varying>,
                              std::unique_ptr<SkSL::Program>,
                              std::unique_ptr<SkSL::Program>,
                              ColorType,
                              bool hasLocalCoords,
                              sk_sp<SkColorSpace>,
                              SkAlphaType);

    SkCustomMeshSpecification(const SkCustomMeshSpecification&) = delete;
    SkCustomMeshSpecification(SkCustomMeshSpecification&&) = delete;

    SkCustomMeshSpecification& operator=(const SkCustomMeshSpecification&) = delete;
    SkCustomMeshSpecification& operator=(SkCustomMeshSpecification&&) = delete;

    const std::vector<Attribute>       fAttributes;
    const std::vector<Varying>         fVaryings;
    std::unique_ptr<SkSL::Program>     fVS;
    std::unique_ptr<SkSL::Program>     fFS;
    size_t                             fStride;
    uint32_t                           fHash;
    ColorType                          fColorType;
    bool                               fHasLocalCoords;
    sk_sp<SkColorSpace>                fColorSpace;
    SkAlphaType                        fAlphaType;
};

/**
 * This is a placeholder object. We will want something that allows the client to incrementally
 * update the mesh that can be synchronized with the GPU backend without requiring extra copies.
 *
 * A buffer of vertices, a topology, optionally indices, and a compatible SkCustomMeshSpecification.
 * The data in 'vb' is expected to contain the attributes described in 'spec' for 'vcount' vertices.
 * The size of the buffer must be at least spec->stride()*vcount (even if vertex attributes contains
 * pad at the end of the stride). If 'bounds' does not contain all points output by 'spec''s vertex
 * program when applied to the vertices in 'vb' a draw of the custom mesh produces undefined
 * results.
 *
 * If indices is null then then 'icount' must be <= 0. 'vcount' vertices will be selected from 'vb'
 * to create the topology indicated by 'mode'.
 *
 * If indices is not null then icount must be >= 3. 'vb' will be indexed by 'icount' successive
 * values in 'indices' to create the topology indicated by 'mode'. The values in 'indices' must be
 * less than 'vcount'
 */
struct SkCustomMesh {
    enum class Mode { kTriangles, kTriangleStrip };
    sk_sp<SkCustomMeshSpecification>  spec;
    Mode                              mode     = Mode::kTriangles;
    SkRect                            bounds   = SkRect::MakeEmpty();
    const void*                       vb       = nullptr;
    int                               vcount   = 0;
    const uint16_t*                   indices  = nullptr;
    int                               icount   = 0;
};

#endif  // SK_ENABLE_SKSL

#endif
