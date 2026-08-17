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
#include "Constraints.h"

#include "TypeStore.h"

namespace WGSL {

bool satisfies(const Type* type, Constraint constraint)
{
    if (constraint == Constraints::None)
        return true;

    auto* primitive = std::get_if<Types::Primitive>(type);
    if (!primitive) {
        if (auto* reference = std::get_if<Types::Reference>(type))
            return satisfies(reference->element, constraint);
        return false;
    }

    switch (primitive->kind) {
    case Types::Primitive::AbstractInt:
        return constraint >= Constraints::AbstractInt;
    case Types::Primitive::AbstractFloat:
        return constraint & Constraints::Float;
    case Types::Primitive::I32:
        return constraint & Constraints::I32;
    case Types::Primitive::U32:
        return constraint & Constraints::U32;
    case Types::Primitive::F32:
        return constraint & Constraints::F32;
    case Types::Primitive::F16:
        return constraint & Constraints::F16;
    case Types::Primitive::Bool:
        return constraint & Constraints::Bool;

    case Types::Primitive::Void:
    case Types::Primitive::Sampler:
    case Types::Primitive::SamplerComparison:
    case Types::Primitive::TextureExternal:
    case Types::Primitive::AccessMode:
    case Types::Primitive::TexelFormat:
    case Types::Primitive::AddressSpace:
        return false;
    }
}

const Type* satisfyOrPromote(const Type* type, Constraint constraint, const TypeStore& types)
{
    if (constraint == Constraints::None)
        return type;

    auto* primitive = std::get_if<Types::Primitive>(type);
    if (!primitive) {
        if (auto* reference = std::get_if<Types::Reference>(type))
            return satisfyOrPromote(reference->element, constraint, types);
        return nullptr;
    }

    switch (primitive->kind) {
    case Types::Primitive::AbstractInt:
        if (constraint < Constraints::AbstractInt)
            return nullptr;
        if (constraint & Constraints::AbstractInt)
            return type;
        if (constraint & Constraints::I32)
            return types.i32Type();
        if (constraint & Constraints::U32)
            return types.u32Type();
        if (constraint & Constraints::AbstractFloat)
            return types.abstractFloatType();
        if (constraint & Constraints::F32)
            return types.f32Type();
        if (constraint & Constraints::F16)
            return types.f16Type();
        RELEASE_ASSERT_NOT_REACHED();
    case Types::Primitive::AbstractFloat:
        if (constraint < Constraints::AbstractFloat)
            return nullptr;
        if (constraint & Constraints::AbstractFloat)
            return type;
        if (constraint & Constraints::F32)
            return types.f32Type();
        if (constraint & Constraints::F16)
            return types.f16Type();
        RELEASE_ASSERT_NOT_REACHED();
    case Types::Primitive::I32:
        if (!(constraint & Constraints::I32))
            return nullptr;
        return type;
    case Types::Primitive::U32:
        if (!(constraint & Constraints::U32))
            return nullptr;
        return type;
    case Types::Primitive::F32:
        if (!(constraint & Constraints::F32))
            return nullptr;
        return type;
    case Types::Primitive::F16:
        if (!(constraint & Constraints::F16))
            return nullptr;
        return type;
    case Types::Primitive::Bool:
        if (!(constraint & Constraints::Bool))
            return nullptr;
        return type;

    case Types::Primitive::Void:
    case Types::Primitive::Sampler:
    case Types::Primitive::SamplerComparison:
    case Types::Primitive::TextureExternal:
    case Types::Primitive::AccessMode:
    case Types::Primitive::TexelFormat:
    case Types::Primitive::AddressSpace:
        return nullptr;
    }
}

const Type* concretize(const Type* type, TypeStore& types)
{
    using namespace Types;

    return WTF::switchOn(*type,
        [&](const Primitive&) -> const Type* {
            return satisfyOrPromote(type, Constraints::ConcreteScalar, types);
        },
        [&](const Vector& vector) -> const Type* {
            auto* element = concretize(vector.element, types);
            if (!element)
                return nullptr;
            return types.vectorType(vector.size, element);
        },
        [&](const Matrix& matrix) -> const Type* {
            auto* element = concretize(matrix.element, types);
            if (!element)
                return nullptr;
            return types.matrixType(matrix.columns, matrix.rows, element);
        },
        [&](const Array& array) -> const Type* {
            auto* element = concretize(array.element, types);
            if (!element)
                return nullptr;
            return types.arrayType(element, array.size);
        },
        [&](const Struct&) -> const Type* {
            return type;
        },
        [&](const PrimitiveStruct& primitiveStruct) -> const Type* {
            switch (primitiveStruct.kind) {
            case PrimitiveStruct::FrexpResult::kind: {
                auto* fract = concretize(primitiveStruct.values[PrimitiveStruct::FrexpResult::fract], types);
                auto* exp = concretize(primitiveStruct.values[PrimitiveStruct::FrexpResult::exp], types);
                if (!fract || !exp)
                    return nullptr;
                return types.frexpResultType(fract, exp);
            }
            case PrimitiveStruct::ModfResult::kind: {
                auto* fract = concretize(primitiveStruct.values[PrimitiveStruct::ModfResult::fract], types);
                auto* whole = concretize(primitiveStruct.values[PrimitiveStruct::ModfResult::whole], types);
                if (!fract || !whole)
                    return nullptr;
                return types.modfResultType(fract, whole);
            }
            case PrimitiveStruct::AtomicCompareExchangeResult::kind: {
                return type;
            }
            }
        },
        [&](const Pointer&) -> const Type* {
            return type;
        },
        [&](const Atomic&) -> const Type* {
            return type;
        },
        [&](const Function&) -> const Type* {
            return nullptr;
        },
        [&](const Texture&) -> const Type* {
            return nullptr;
        },
        [&](const TextureStorage&) -> const Type* {
            return nullptr;
        },
        [&](const TextureDepth&) -> const Type* {
            return nullptr;
        },
        [&](const Reference&) -> const Type* {
            return nullptr;
        },
        [&](const TypeConstructor&) -> const Type* {
            return nullptr;
        });
}

} // namespace WGSL
