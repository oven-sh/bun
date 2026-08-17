/*
 * Copyright (c) 2023 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "Types.h"

#include "ASTStringDumper.h"
#include "ASTStructure.h"
#include "TypeStore.h"
#include <wtf/CheckedArithmetic.h>
#include <wtf/StdLibExtras.h>
#include <wtf/StringPrintStream.h>
#include <wtf/text/StringHash.h>

namespace WGSL {

using namespace Types;

namespace Types {

size_t Array::stride() const
{
    return WTF::roundUpToMultipleOf(element->alignment(), element->size());
}

} // namespace Types

void Type::dump(PrintStream& out) const
{
    WTF::switchOn(*this,
        [&](const Primitive& primitive) {
            switch (primitive.kind) {
#define PRIMITIVE_CASE(kind, name) \
            case Primitive::kind: \
                out.print(name); \
                break;
            FOR_EACH_PRIMITIVE_TYPE(PRIMITIVE_CASE)
#undef PRIMITIVE_CASE
            }
        },
        [&](const Vector& vector) {
            out.print("vec", vector.size, "<", *vector.element, ">");
        },
        [&](const Matrix& matrix) {
            out.print("mat", matrix.columns, "x", matrix.rows, "<", *matrix.element, ">");
        },
        [&](const Array& array) {
            out.print("array<", *array.element);
            WTF::switchOn(array.size,
                [&](unsigned size) { out.print(", ", size); },
                [&](std::monostate) { },
                [&](AST::Expression* size) {
                    out.print(", ");
                    dumpNode(out, *size);
                });
            out.print(">");
        },
        [&](const Struct& structure) {
            out.print(structure.structure.name());
        },
        [&](const PrimitiveStruct& structure) {
            out.print(structure.name, "<");
            switch (structure.kind) {
            case PrimitiveStruct::FrexpResult::kind:
                out.print(*structure.values[PrimitiveStruct::FrexpResult::fract]);
                break;
            case PrimitiveStruct::ModfResult::kind:
                out.print(*structure.values[PrimitiveStruct::ModfResult::fract]);
                break;
            case PrimitiveStruct::AtomicCompareExchangeResult::kind:
                out.print(*structure.values[PrimitiveStruct::AtomicCompareExchangeResult::oldValue]);
                break;
            }
            out.print(">");
        },
        [&](const Function& function) {
            out.print("(");
            bool first = true;
            for (auto* parameter : function.parameters) {
                if (!first)
                    out.print(", ");
                first = false;
                out.print(*parameter);
            }
            out.print(") -> ", *function.result);
        },
        [&](const Texture& texture) {
            switch (texture.kind) {
            case Texture::Kind::Texture1d:
                out.print("texture_1d");
                break;
            case Texture::Kind::Texture2d:
                out.print("texture_2d");
                break;
            case Texture::Kind::Texture2dArray:
                out.print("texture_2d_array");
                break;
            case Texture::Kind::Texture3d:
                out.print("texture_3d");
                break;
            case Texture::Kind::TextureCube:
                out.print("texture_cube");
                break;
            case Texture::Kind::TextureCubeArray:
                out.print("texture_cube_array");
                break;
            case Texture::Kind::TextureMultisampled2d:
                out.print("texture_multisampled_2d");
                break;
            }
            out.print("<", *texture.element, ">");
        },
        [&](const TextureStorage& texture) {
            switch (texture.kind) {
            case TextureStorage::Kind::TextureStorage1d:
                out.print("texture_storage_1d");
                break;
            case TextureStorage::Kind::TextureStorage2d:
                out.print("texture_storage_2d");
                break;
            case TextureStorage::Kind::TextureStorage2dArray:
                out.print("texture_storage_2d_array");
                break;
            case TextureStorage::Kind::TextureStorage3d:
                out.print("texture_storage_3d");
                break;
            }
            out.print("<", texture.format, ", ", texture.access, ">");
        },
        [&](const TextureDepth& texture) {
            switch (texture.kind) {
            case TextureDepth::Kind::TextureDepth2d:
                out.print("texture_depth_2d");
                break;
            case TextureDepth::Kind::TextureDepth2dArray:
                out.print("texture_depth_2d_array");
                break;
            case TextureDepth::Kind::TextureDepthCube:
                out.print("texture_depth_cube");
                break;
            case TextureDepth::Kind::TextureDepthCubeArray:
                out.print("texture_depth_cube_array");
                break;
            case TextureDepth::Kind::TextureDepthMultisampled2d:
                out.print("texture_depth_multisampled_2d");
                break;
            }
        },
        [&](const Reference& reference) {
            out.print("ref<", reference.addressSpace, ", ", *reference.element, ", ", reference.accessMode, ">");
        },
        [&](const Pointer& reference) {
            out.print("ptr<", reference.addressSpace, ", ", *reference.element, ", ", reference.accessMode, ">");
        },
        [&](const Atomic& atomic) {
            out.print("atomic<", *atomic.element, ">");
        },
        [&](const TypeConstructor& constructor) {
            out.print(constructor.name);
        });
}

constexpr unsigned NODELETE primitivePair(Types::Primitive::Kind first, Types::Primitive::Kind second)
{
    static_assert(sizeof(Types::Primitive::Kind) == 1);
    return static_cast<unsigned>(first) << 8 | second;
}

// https://www.w3.org/TR/WGSL/#conversion-rank
ConversionRank conversionRank(const Type* from, const Type* to)
{
    using namespace WGSL::Types;

    if (from == to)
        return { 0 };

    if (auto* fromReference = std::get_if<Reference>(from)) {
        if (fromReference->accessMode == AccessMode::Write)
            return std::nullopt;
        return conversionRank(fromReference->element, to);
    }

    if (auto* toReference = std::get_if<Reference>(to)) {
        if (toReference->accessMode == AccessMode::Write)
            return std::nullopt;
        return conversionRank(from, toReference->element);
    }

    if (auto* fromPrimitive = std::get_if<Primitive>(from)) {
        auto* toPrimitive = std::get_if<Primitive>(to);
        if (!toPrimitive)
            return std::nullopt;

        switch (primitivePair(fromPrimitive->kind, toPrimitive->kind)) {
        case primitivePair(Primitive::AbstractFloat, Primitive::F32):
            return { 1 };
        case primitivePair(Primitive::AbstractFloat, Primitive::F16):
            return { 2 };
        case primitivePair(Primitive::AbstractInt, Primitive::I32):
            return { 3 };
        case primitivePair(Primitive::AbstractInt, Primitive::U32):
            return { 4 };
        case primitivePair(Primitive::AbstractInt, Primitive::AbstractFloat):
            return { 5 };
        case primitivePair(Primitive::AbstractInt, Primitive::F32):
            return { 6 };
        case primitivePair(Primitive::AbstractInt, Primitive::F16):
            return { 7 };
        default:
            return std::nullopt;
        }
    }

    if (auto* fromVector = std::get_if<Vector>(from)) {
        auto* toVector = std::get_if<Vector>(to);
        if (!toVector)
            return std::nullopt;
        if (fromVector->size != toVector->size)
            return std::nullopt;
        return conversionRank(fromVector->element, toVector->element);
    }

    if (auto* fromMatrix = std::get_if<Matrix>(from)) {
        auto* toMatrix = std::get_if<Matrix>(to);
        if (!toMatrix)
            return std::nullopt;
        if (fromMatrix->columns != toMatrix->columns)
            return std::nullopt;
        if (fromMatrix->rows != toMatrix->rows)
            return std::nullopt;
        return conversionRank(fromMatrix->element, toMatrix->element);
    }

    if (auto* fromArray = std::get_if<Array>(from)) {
        auto* toArray = std::get_if<Array>(to);
        if (!toArray)
            return std::nullopt;
        if (fromArray->size != toArray->size)
            return std::nullopt;
        return conversionRank(fromArray->element, toArray->element);
    }

    if (auto* fromPrimitiveStruct = std::get_if<PrimitiveStruct>(from)) {
        auto* toPrimitiveStruct = std::get_if<PrimitiveStruct>(to);
        if (!toPrimitiveStruct)
            return std::nullopt;
        auto kind = fromPrimitiveStruct->kind;
        if (kind != toPrimitiveStruct->kind)
            return std::nullopt;
        switch (kind) {
        case PrimitiveStruct::FrexpResult::kind:
            return conversionRank(fromPrimitiveStruct->values[PrimitiveStruct::FrexpResult::fract], toPrimitiveStruct->values[PrimitiveStruct::FrexpResult::fract]);
        case PrimitiveStruct::ModfResult::kind:
            return conversionRank(fromPrimitiveStruct->values[PrimitiveStruct::ModfResult::fract], toPrimitiveStruct->values[PrimitiveStruct::ModfResult::fract]);
        case PrimitiveStruct::AtomicCompareExchangeResult::kind:
            return std::nullopt;
        }
    }

    return std::nullopt;
}

String Type::toString() const
{
    StringPrintStream out;
    dump(out);
    return out.toString();
}

// https://gpuweb.github.io/gpuweb/wgsl/#alignment-and-size
std::optional<unsigned> Type::maybeSize() const
{
    return WTF::switchOn(*this,
        [&](const Primitive& primitive) -> std::optional<unsigned> {
            switch (primitive.kind) {
            case Types::Primitive::F16:
                return 2;
            case Types::Primitive::F32:
            case Types::Primitive::I32:
            case Types::Primitive::U32:
                return 4;
            case Types::Primitive::Bool:
                return 1;
            case Types::Primitive::Void:
            case Types::Primitive::AbstractInt:
            case Types::Primitive::AbstractFloat:
            case Types::Primitive::Sampler:
            case Types::Primitive::SamplerComparison:
            case Types::Primitive::TextureExternal:
            case Types::Primitive::AccessMode:
            case Types::Primitive::TexelFormat:
            case Types::Primitive::AddressSpace:
                return std::nullopt;
            }
        },
        [&](const Vector& vector) -> std::optional<unsigned> {
            return vector.element->size() * vector.size;
        },
        [&](const Matrix& matrix) -> std::optional<unsigned> {
            // The size of the matrix is computed as: sizeof(array<vecR<T>, C>)
            // sizeof(vecR<T>)
            auto rowSize = matrix.rows * matrix.element->size();
            // sizeof(array<vecR<T>, C>)
            auto rowAlignment = (matrix.rows == 2 ? 2 : 4) * matrix.element->alignment();
            return matrix.columns * WTF::roundUpToMultipleOf(rowAlignment, rowSize);
        },
        [&](const Array& array) -> std::optional<unsigned> {
            CheckedUint32 size = 1;
            if (auto* constantSize = std::get_if<unsigned>(&array.size))
                size = *constantSize;
            else if (auto* expression = std::get_if<AST::Expression*>(&array.size)) {
                if (const auto& maybeConstantValue = (*expression)->constantValue())
                    size = maybeConstantValue->integerValue();
            }
            auto elementSize = array.element->size();
            auto stride = WTF::roundUpToMultipleOf(array.element->alignment(), elementSize);
            if (stride < elementSize)
                return std::numeric_limits<unsigned>::max();
            size *= stride;
            if (size.hasOverflowed())
                return std::numeric_limits<unsigned>::max();
            return size.value();
        },
        [&](const Struct& structure) -> std::optional<unsigned> {
            return structure.structure.size();
        },
        [&](const PrimitiveStruct& structure) -> std::optional<unsigned> {
            unsigned size = 0;
            for (auto* type : structure.values)
                size += type->size();
            return size;
        },
        [&](const Function&) -> std::optional<unsigned> {
            return std::nullopt;
        },
        [&](const Texture&) -> std::optional<unsigned> {
            return std::nullopt;
        },
        [&](const TextureStorage&) -> std::optional<unsigned> {
            return std::nullopt;
        },
        [&](const TextureDepth&) -> std::optional<unsigned> {
            return std::nullopt;
        },
        [&](const Reference&) -> std::optional<unsigned> {
            return std::nullopt;
        },
        [&](const Pointer&) -> std::optional<unsigned> {
            return std::nullopt;
        },
        [&](const Atomic& a) -> std::optional<unsigned> {
            RELEASE_ASSERT(a.element);
            return a.element->size();
        },
        [&](const TypeConstructor&) -> std::optional<unsigned> {
            return std::nullopt;
        });
}

unsigned Type::size() const
{
    return *maybeSize();
}

unsigned Type::alignment() const
{
    return WTF::switchOn(*this,
        [&](const Primitive& primitive) -> unsigned {
            switch (primitive.kind) {
            case Types::Primitive::F16:
                return 2;
            case Types::Primitive::F32:
            case Types::Primitive::I32:
            case Types::Primitive::U32:
                return 4;
            case Types::Primitive::Bool:
                return 1;
            case Types::Primitive::Void:
            case Types::Primitive::AbstractInt:
            case Types::Primitive::AbstractFloat:
            case Types::Primitive::Sampler:
            case Types::Primitive::SamplerComparison:
            case Types::Primitive::TextureExternal:
            case Types::Primitive::AccessMode:
            case Types::Primitive::TexelFormat:
            case Types::Primitive::AddressSpace:
                RELEASE_ASSERT_NOT_REACHED();
            }
        },
        [&](const Vector& vector) -> unsigned {
            auto elementAlignment = vector.element->alignment();
            if (vector.size == 2)
                return 2 * elementAlignment;
            return 4 * elementAlignment;
        },
        [&](const Matrix& matrix) -> unsigned {
            auto elementAlignment = matrix.element->alignment();
            if (matrix.rows == 2)
                return 2 * elementAlignment;
            return 4 * elementAlignment;
        },
        [&](const Array& array) -> unsigned {
            return array.element->alignment();
        },
        [&](const Struct& structure) -> unsigned {
            return structure.structure.alignment();
        },
        [&](const PrimitiveStruct& structure) -> unsigned {
            unsigned alignment = 0;
            for (auto* type : structure.values)
                alignment = std::max(alignment, type->alignment());
            return alignment;
        },
        [&](const Function&) -> unsigned {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const Texture&) -> unsigned {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const TextureStorage&) -> unsigned {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const TextureDepth&) -> unsigned {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const Reference&) -> unsigned {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const Pointer&) -> unsigned {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const Atomic& a) -> unsigned {
            RELEASE_ASSERT(a.element);
            return a.element->alignment();
        },
        [&](const TypeConstructor&) -> unsigned {
            RELEASE_ASSERT_NOT_REACHED();
        });
}

Packing Type::packing() const
{
    if (auto* referenceType = std::get_if<Types::Reference>(this))
        return referenceType->element->packing();

    if (auto* structType = std::get_if<Types::Struct>(this)) {
        if (structType->structure.role() == AST::StructureRole::UserDefinedResource)
            return Packing::PackedStruct;
    } else if (auto* vectorType = std::get_if<Types::Vector>(this)) {
        if (vectorType->size == 3)
            return Packing::PackedVec3;
    } else if (auto* matrixType = std::get_if<Types::Matrix>(this)) {
        if (matrixType->rows == 3)
            return Packing::PackedVec3;
    } else if (auto* arrayType = std::get_if<Types::Array>(this)) {
        auto elementPacking = arrayType->element->packing();
        if (elementPacking & Packing::Packed)
            elementPacking = static_cast<Packing>(elementPacking | Packing::PArray);
        return elementPacking;
    }

    return Packing::Unpacked;
}

// https://www.w3.org/TR/WGSL/#constructible-types
bool Type::isConstructible() const
{
    return WTF::switchOn(*this,
        [&](const Primitive& primitive) -> bool {
            switch (primitive.kind) {
            case Types::Primitive::F16:
            case Types::Primitive::F32:
            case Types::Primitive::I32:
            case Types::Primitive::U32:
            case Types::Primitive::Bool:
            case Types::Primitive::AbstractInt:
            case Types::Primitive::AbstractFloat:
                return true;
            case Types::Primitive::Void:
            case Types::Primitive::Sampler:
            case Types::Primitive::SamplerComparison:
            case Types::Primitive::TextureExternal:
            case Types::Primitive::AccessMode:
            case Types::Primitive::TexelFormat:
            case Types::Primitive::AddressSpace:
                return false;
            }
        },
        [&](const Vector&) -> bool {
            return true;
        },
        [&](const Matrix&) -> bool {
            return true;
        },
        [&](const Array& array) -> bool {
            return array.isCreationFixed() && array.element->isConstructible();
        },
        [&](const Struct& structure) -> bool {
            for (auto& member : structure.structure.members()) {
                if (!member.type().inferredType()->isConstructible())
                    return false;
            }
            return true;
        },
        [&](const PrimitiveStruct&) -> bool {
            return true;
        },

        [&](const Function&) -> bool {
            return false;
        },
        [&](const Texture&) -> bool {
            return false;
        },
        [&](const TextureStorage&) -> bool {
            return false;
        },
        [&](const TextureDepth&) -> bool {
            return false;
        },
        [&](const Reference&) -> bool {
            return false;
        },
        [&](const Pointer&) -> bool {
            return false;
        },
        [&](const Atomic&) -> bool {
            return false;
        },
        [&](const TypeConstructor&) -> bool {
            return false;
        });
}

// https://www.w3.org/TR/WGSL/#storable
bool Type::isStorable() const
{
    return WTF::switchOn(*this,
        [&](const Primitive& primitive) -> bool {
            switch (primitive.kind) {
            case Types::Primitive::F16:
            case Types::Primitive::F32:
            case Types::Primitive::I32:
            case Types::Primitive::U32:
            case Types::Primitive::Bool:
            case Types::Primitive::Sampler:
            case Types::Primitive::SamplerComparison:
            case Types::Primitive::TextureExternal:
                return true;
            case Types::Primitive::AbstractInt:
            case Types::Primitive::AbstractFloat:
            case Types::Primitive::Void:
            case Types::Primitive::AccessMode:
            case Types::Primitive::TexelFormat:
            case Types::Primitive::AddressSpace:
                return false;
            }
        },
        [&](const Vector& vector) -> bool {
            return vector.element->isStorable();
        },
        [&](const Matrix& matrix) -> bool {
            return matrix.element->isStorable();
        },
        [&](const Array& array) -> bool {
            return array.element->isStorable();
        },
        [&](const Struct& structure) -> bool {
            for (auto& member : structure.structure.members()) {
                if (!member.type().inferredType()->isStorable())
                    return false;
            }
            return true;
        },
        [&](const TextureStorage&) -> bool {
            return true;
        },
        [&](const TextureDepth&) -> bool {
            return true;
        },
        [&](const Atomic&) -> bool {
            return true;
        },

        [&](const PrimitiveStruct&) -> bool {
            return false;
        },
        [&](const Function&) -> bool {
            return false;
        },
        [&](const Texture&) -> bool {
            return false;
        },
        [&](const TypeConstructor&) -> bool {
            return false;
        },
        [&](const Reference&) -> bool {
            return false;
        },
        [&](const Pointer&) -> bool {
            return false;
        });
}

// https://www.w3.org/TR/WGSL/#host-shareable-types
bool Type::isHostShareable() const
{
    return WTF::switchOn(*this,
        [&](const Primitive& primitive) -> bool {
            switch (primitive.kind) {
            case Types::Primitive::F16:
            case Types::Primitive::F32:
            case Types::Primitive::I32:
            case Types::Primitive::U32:
                return true;
            case Types::Primitive::Bool:
            case Types::Primitive::Sampler:
            case Types::Primitive::SamplerComparison:
            case Types::Primitive::TextureExternal:
            case Types::Primitive::AbstractInt:
            case Types::Primitive::AbstractFloat:
            case Types::Primitive::Void:
            case Types::Primitive::AccessMode:
            case Types::Primitive::TexelFormat:
            case Types::Primitive::AddressSpace:
                return false;
            }
        },
        [&](const Vector& vector) -> bool {
            return vector.element->isHostShareable();
        },
        [&](const Matrix& matrix) -> bool {
            return matrix.element->isHostShareable();
        },
        [&](const Array& array) -> bool {
            return array.element->isHostShareable();
        },
        [&](const Struct& structure) -> bool {
            for (auto& member : structure.structure.members()) {
                if (!member.type().inferredType()->isHostShareable())
                    return false;
            }
            return true;
        },
        [&](const Atomic&) -> bool {
            return true;
        },

        [&](const TextureStorage&) -> bool {
            return false;
        },
        [&](const TextureDepth&) -> bool {
            return false;
        },
        [&](const PrimitiveStruct&) -> bool {
            return false;
        },
        [&](const Function&) -> bool {
            return false;
        },
        [&](const Texture&) -> bool {
            return false;
        },
        [&](const TypeConstructor&) -> bool {
            return false;
        },
        [&](const Reference&) -> bool {
            return false;
        },
        [&](const Pointer&) -> bool {
            return false;
        });
}

// https://www.w3.org/TR/WGSL/#fixed-footprint
bool Type::hasFixedFootprint() const
{
    return WTF::switchOn(*this,
        [&](const Primitive& primitive) -> bool {
            switch (primitive.kind) {
            case Types::Primitive::F16:
            case Types::Primitive::F32:
            case Types::Primitive::I32:
            case Types::Primitive::U32:
            case Types::Primitive::Bool:
                return true;
            case Types::Primitive::Sampler:
            case Types::Primitive::SamplerComparison:
            case Types::Primitive::TextureExternal:
            case Types::Primitive::AbstractInt:
            case Types::Primitive::AbstractFloat:
            case Types::Primitive::Void:
            case Types::Primitive::AccessMode:
            case Types::Primitive::TexelFormat:
            case Types::Primitive::AddressSpace:
                return false;
            }
        },
        [&](const Vector&) -> bool {
            return true;
        },
        [&](const Matrix&) -> bool {
            return true;
        },
        [&](const Array& array) -> bool {
            return !array.isRuntimeSized();
        },
        [&](const Struct& structure) -> bool {
            for (auto& member : structure.structure.members()) {
                if (!member.type().inferredType()->hasFixedFootprint())
                    return false;
            }
            return true;
        },
        [&](const Atomic&) -> bool {
            return true;
        },

        [&](const TextureStorage&) -> bool {
            return false;
        },
        [&](const TextureDepth&) -> bool {
            return false;
        },
        [&](const PrimitiveStruct&) -> bool {
            return false;
        },
        [&](const Function&) -> bool {
            return false;
        },
        [&](const Texture&) -> bool {
            return false;
        },
        [&](const TypeConstructor&) -> bool {
            return false;
        },
        [&](const Reference&) -> bool {
            return false;
        },
        [&](const Pointer&) -> bool {
            return false;
        });
}

// https://www.w3.org/TR/WGSL/#creation-fixed-footprint
bool Type::hasCreationFixedFootprint() const
{
    return WTF::switchOn(*this,
        [&](const Primitive& primitive) -> bool {
            switch (primitive.kind) {
            case Types::Primitive::F16:
            case Types::Primitive::F32:
            case Types::Primitive::I32:
            case Types::Primitive::U32:
            case Types::Primitive::Bool:
                return true;
            case Types::Primitive::Sampler:
            case Types::Primitive::SamplerComparison:
            case Types::Primitive::TextureExternal:
            case Types::Primitive::AbstractInt:
            case Types::Primitive::AbstractFloat:
            case Types::Primitive::Void:
            case Types::Primitive::AccessMode:
            case Types::Primitive::TexelFormat:
            case Types::Primitive::AddressSpace:
                return false;
            }
        },
        [&](const Vector&) -> bool {
            return true;
        },
        [&](const Matrix&) -> bool {
            return true;
        },
        [&](const Array& array) -> bool {
            return array.isCreationFixed();
        },
        [&](const Struct& structure) -> bool {
            for (auto& member : structure.structure.members()) {
                if (!member.type().inferredType()->hasCreationFixedFootprint())
                    return false;
            }
            return true;
        },
        [&](const Atomic&) -> bool {
            return true;
        },

        [&](const TextureStorage&) -> bool {
            return false;
        },
        [&](const TextureDepth&) -> bool {
            return false;
        },
        [&](const PrimitiveStruct&) -> bool {
            return false;
        },
        [&](const Function&) -> bool {
            return false;
        },
        [&](const Texture&) -> bool {
            return false;
        },
        [&](const TypeConstructor&) -> bool {
            return false;
        },
        [&](const Reference&) -> bool {
            return false;
        },
        [&](const Pointer&) -> bool {
            return false;
        });
}

bool Type::containsRuntimeArray() const
{
    if (auto* array = std::get_if<Types::Array>(this))
        return array->isRuntimeSized();
    if (auto* structure = std::get_if<Types::Struct>(this))
        return structure->structure.members().last().type().inferredType()->containsRuntimeArray();
    if (auto* reference = std::get_if<Types::Reference>(this))
        return reference->element->containsRuntimeArray();
    return false;
}

bool Type::containsOverrideArray() const
{
    if (auto* array = std::get_if<Types::Array>(this))
        return array->isOverrideSized();
    if (auto* structure = std::get_if<Types::Struct>(this))
        return structure->structure.members().last().type().inferredType()->containsOverrideArray();
    if (auto* reference = std::get_if<Types::Reference>(this))
        return reference->element->containsOverrideArray();
    return false;
}

bool Type::isTexture() const
{
    auto* primitive = std::get_if<Types::Primitive>(this);
    if (primitive)
        return primitive->kind == Types::Primitive::TextureExternal;
    return std::holds_alternative<Types::Texture>(*this) || std::holds_alternative<Types::TextureStorage>(*this) || std::holds_alternative<Types::TextureDepth>(*this);
}

bool Type::isSampler() const
{
    auto* primitive = std::get_if<Types::Primitive>(this);
    if (!primitive)
        return false;
    return primitive->kind == Types::Primitive::Sampler || primitive->kind == Types::Primitive::SamplerComparison;
}

bool isPrimitive(const Type* type, Primitive::Kind kind)
{
    auto* primitive = std::get_if<Primitive>(type);
    if (!primitive)
        return false;
    return primitive->kind == kind;
}

bool isPrimitiveReference(const Type* type, Primitive::Kind kind)
{
    auto* reference = std::get_if<Reference>(type);
    if (!reference)
        return false;
    return isPrimitive(reference->element, kind);
}

const Type* shaderTypeForTexelFormat(TexelFormat format, const TypeStore& types)
{
    switch (format) {
    case TexelFormat::BGRA8unorm:
    case TexelFormat::R8snorm:
    case TexelFormat::R8unorm:
    case TexelFormat::RG8snorm:
    case TexelFormat::RG8unorm:
    case TexelFormat::RGBA8unorm:
    case TexelFormat::RGBA8snorm:
    case TexelFormat::RG16unorm:
    case TexelFormat::RG16snorm:
    case TexelFormat::RGBA16unorm:
    case TexelFormat::RGBA16snorm:
    case TexelFormat::R16unorm:
    case TexelFormat::R16snorm:
    case TexelFormat::R16float:
    case TexelFormat::RGB10A2unorm:
    case TexelFormat::RGBA16float:
    case TexelFormat::R32float:
    case TexelFormat::RG32float:
    case TexelFormat::RGBA32float:
    case TexelFormat::RG16float:
    case TexelFormat::RG11B10ufloat:
        return types.f32Type();
    case TexelFormat::RGBA8uint:
    case TexelFormat::RGB10A2uint:
    case TexelFormat::RGBA16uint:
    case TexelFormat::R16uint:
    case TexelFormat::R8uint:
    case TexelFormat::RG8uint:
    case TexelFormat::RG16uint:
    case TexelFormat::R32uint:
    case TexelFormat::RG32uint:
    case TexelFormat::RGBA32uint:
        return types.u32Type();
    case TexelFormat::RGBA8sint:
    case TexelFormat::RGBA16sint:
    case TexelFormat::R16sint:
    case TexelFormat::R8sint:
    case TexelFormat::RG8sint:
    case TexelFormat::RG16sint:
    case TexelFormat::R32sint:
    case TexelFormat::RG32sint:
    case TexelFormat::RGBA32sint:
        return types.i32Type();
    }
}

} // namespace WGSL
