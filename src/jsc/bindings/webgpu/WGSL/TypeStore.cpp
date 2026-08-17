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
#include "TypeStore.h"

#include "Types.h"
#include <wtf/EnumTraits.h>

namespace WGSL {

using namespace Types;

struct VectorKey {
    const Type* elementType;
    uint8_t size;

    TypeCache::EncodedKey encode() const { return std::tuple(TypeCache::Vector, size, 0, 0, std::bit_cast<uintptr_t>(elementType)); }
};

struct MatrixKey {
    const Type* elementType;
    uint8_t columns;
    uint8_t rows;

    TypeCache::EncodedKey encode() const { return std::tuple(TypeCache::Matrix, columns, rows, 0, std::bit_cast<uintptr_t>(elementType)); }
};

struct ArrayKey {
    const Type* elementType;
    Types::Array::Size size;

    TypeCache::EncodedKey encode() const
    {
        auto encodedSize = WTF::switchOn(size,
            [&](unsigned size) -> std::tuple<uint16_t, unsigned> {
                return { 0, size };
            },
            [&](std::monostate) -> std::tuple<uint16_t, unsigned> {
                return { 0, 0 };
            },
            [&](AST::Expression* expression) -> std::tuple<uint16_t, unsigned> {
                auto address = static_cast<uint64_t>(std::bit_cast<uintptr_t>(expression));
                return { address >> 32, address };
            });
        return std::tuple(TypeCache::Array, 0, std::get<0>(encodedSize), std::get<1>(encodedSize), std::bit_cast<uintptr_t>(elementType));
    }
};

struct TextureKey {
    const Type* elementType;
    Texture::Kind kind;

    TypeCache::EncodedKey encode() const { return std::tuple(TypeCache::Texture, std::to_underlying(kind), 0, 0, std::bit_cast<uintptr_t>(elementType)); }
};

struct TextureStorageKey {
    TextureStorage::Kind kind;
    TexelFormat format;
    AccessMode access;

    TypeCache::EncodedKey encode() const { return std::tuple(TypeCache::TextureStorage, std::to_underlying(kind), std::to_underlying(format), std::to_underlying(access), 0); }
};

struct ReferenceKey {
    const Type* elementType;
    AddressSpace addressSpace;
    AccessMode accessMode;
    bool isVectorComponent;

    TypeCache::EncodedKey encode() const { return std::tuple(TypeCache::Reference, std::to_underlying(addressSpace), std::to_underlying(accessMode), isVectorComponent, std::bit_cast<uintptr_t>(elementType)); }
};

struct PointerKey {
    const Type* elementType;
    AddressSpace addressSpace;
    AccessMode accessMode;

    TypeCache::EncodedKey encode() const { return std::tuple(TypeCache::Pointer, std::to_underlying(addressSpace), std::to_underlying(accessMode), 0, std::bit_cast<uintptr_t>(elementType)); }
};

struct PrimitiveStructKey {
    unsigned kind;
    const Type* elementType;

    TypeCache::EncodedKey encode() const { return std::tuple(TypeCache::PrimitiveStruct, kind, 0, 0, std::bit_cast<uintptr_t>(elementType)); }
};

template<typename Key>
const Type* TypeCache::find(const Key& key) const
{
    auto it = m_storage.find(key.encode());
    if (it != m_storage.end())
        return it->value;
    return nullptr;
}

template<typename Key>
void TypeCache::insert(const Key& key, const Type* type)
{
    auto it = m_storage.add(key.encode(), type);
    ASSERT_UNUSED(it, it.isNewEntry);
}

TypeStore::TypeStore()
{
    m_abstractInt = allocateType<Primitive>(Primitive::AbstractInt);
    m_abstractFloat = allocateType<Primitive>(Primitive::AbstractFloat);
    m_void = allocateType<Primitive>(Primitive::Void);
    m_bool = allocateType<Primitive>(Primitive::Bool);
    m_i32 = allocateType<Primitive>(Primitive::I32);
    m_u32 = allocateType<Primitive>(Primitive::U32);
    m_f32 = allocateType<Primitive>(Primitive::F32);
    m_f16 = allocateType<Primitive>(Primitive::F16);
    m_sampler = allocateType<Primitive>(Primitive::Sampler);
    m_samplerComparison = allocateType<Primitive>(Primitive::SamplerComparison);
    m_textureExternal = allocateType<Primitive>(Primitive::TextureExternal);
    m_accessMode = allocateType<Primitive>(Primitive::AccessMode);
    m_texelFormat = allocateType<Primitive>(Primitive::TexelFormat);
    m_addressSpace = allocateType<Primitive>(Primitive::AddressSpace);
    m_textureDepth2d = allocateType<TextureDepth>(TextureDepth::Kind::TextureDepth2d);
    m_textureDepthArray2d = allocateType<TextureDepth>(TextureDepth::Kind::TextureDepth2dArray);
    m_textureDepthCube = allocateType<TextureDepth>(TextureDepth::Kind::TextureDepthCube);
    m_textureDepthArrayCube = allocateType<TextureDepth>(TextureDepth::Kind::TextureDepthCubeArray);
    m_textureDepthMultisampled2d = allocateType<TextureDepth>(TextureDepth::Kind::TextureDepthMultisampled2d);
    m_atomicI32 = allocateType<Atomic>(m_i32);
    m_atomicU32 = allocateType<Atomic>(m_u32);
}

const Type* TypeStore::structType(AST::Structure& structure, HashMap<String, const Type*>&& fields)
{
    return allocateType<Struct>(structure, fields);
}

const Type* TypeStore::arrayType(const Type* elementType, Types::Array::Size size)
{
    ArrayKey key { elementType, size };
    const Type* type = m_cache.find(key);
    if (type)
        return type;
    type = allocateType<Array>(elementType, size);
    m_cache.insert(key, type);
    return type;
}

const Type* TypeStore::vectorType(uint8_t size, const Type* elementType)
{
    VectorKey key { elementType, size };
    const Type* type = m_cache.find(key);
    if (type)
        return type;
    type = allocateType<Vector>(elementType, size);
    m_cache.insert(key, type);
    return type;
}

const Type* TypeStore::matrixType(uint8_t columns, uint8_t rows, const Type* elementType)
{
    MatrixKey key { elementType, columns, rows };
    const Type* type = m_cache.find(key);
    if (type)
        return type;
    type = allocateType<Matrix>(elementType, columns, rows);
    m_cache.insert(key, type);
    return type;
}

const Type* TypeStore::textureType(Texture::Kind kind, const Type* elementType)
{
    TextureKey key { elementType, kind };
    const Type* type = m_cache.find(key);
    if (type)
        return type;
    type = allocateType<Texture>(elementType, kind);
    m_cache.insert(key, type);
    return type;
}

const Type* TypeStore::textureStorageType(TextureStorage::Kind kind, TexelFormat format, AccessMode access)
{
    TextureStorageKey key { kind, format, access };
    const Type* type = m_cache.find(key);
    if (type)
        return type;
    type = allocateType<TextureStorage>(kind, format, access);
    m_cache.insert(key, type);
    return type;
}

const Type* TypeStore::functionType(WTF::Vector<const Type*>&& parameters, const Type* result, bool mustUse)
{
    return allocateType<Function>(WTF::move(parameters), result, mustUse);
}

const Type* TypeStore::referenceType(AddressSpace addressSpace, const Type* element, AccessMode accessMode, bool isVectorComponent)
{
    ReferenceKey key { element, addressSpace, accessMode, isVectorComponent };
    const Type* type = m_cache.find(key);
    if (type)
        return type;
    type = allocateType<Reference>(addressSpace, accessMode, element, isVectorComponent);
    m_cache.insert(key, type);
    return type;
}

const Type* TypeStore::pointerType(AddressSpace addressSpace, const Type* element, AccessMode accessMode)
{
    PointerKey key { element, addressSpace, accessMode };
    const Type* type = m_cache.find(key);
    if (type)
        return type;
    type = allocateType<Pointer>(addressSpace, accessMode, element);
    m_cache.insert(key, type);
    return type;
}

const Type* TypeStore::atomicType(const Type* type)
{
    if (type == m_i32)
        return m_atomicI32;
    ASSERT(type == m_u32);
    return m_atomicU32;
}

const Type* TypeStore::typeConstructorType(ASCIILiteral name, std::function<Result<const Type*>(AST::ElaboratedTypeExpression&)>&& constructor)
{
    return allocateType<TypeConstructor>(name, WTF::move(constructor));
}

const Type* TypeStore::frexpResultType(const Type* fract, const Type* exp)
{
    PrimitiveStructKey key { PrimitiveStruct::FrexpResult::kind, fract };
    const Type* type = m_cache.find(key);
    if (type)
        return type;

    FixedVector<const Type*> values(2);
    values[PrimitiveStruct::FrexpResult::fract] = fract;
    values[PrimitiveStruct::FrexpResult::exp] = exp;
    type = allocateType<PrimitiveStruct>("__frexp_result"_s, PrimitiveStruct::FrexpResult::kind, values);
    m_cache.insert(key, type);
    return type;
}

const Type* TypeStore::modfResultType(const Type* fract, const Type* whole)
{
    PrimitiveStructKey key { PrimitiveStruct::ModfResult::kind, fract };
    const Type* type = m_cache.find(key);
    if (type)
        return type;

    FixedVector<const Type*> values(2);
    values[PrimitiveStruct::ModfResult::fract] = fract;
    values[PrimitiveStruct::ModfResult::whole] = whole;
    type = allocateType<PrimitiveStruct>("__modf_result"_s, PrimitiveStruct::ModfResult::kind, values);
    m_cache.insert(key, type);
    return type;
}

const Type* TypeStore::atomicCompareExchangeResultType(const Type* type)
{
    const auto& load = [&](const Type*& member) {
        if (member)
            return member;
        FixedVector<const Type*> values(2);
        values[PrimitiveStruct::AtomicCompareExchangeResult::oldValue] = type;
        values[PrimitiveStruct::AtomicCompareExchangeResult::exchanged] = boolType();
        member = allocateType<PrimitiveStruct>("__atomic_compare_exchange_result"_s, PrimitiveStruct::AtomicCompareExchangeResult::kind, values);
        return member;
    };

    if (type == m_i32)
        return load(m_atomicCompareExchangeResultI32);
    ASSERT(type == m_u32);
    return load(m_atomicCompareExchangeResultU32);
}

template<typename TypeKind, typename... Arguments>
const Type* TypeStore::allocateType(Arguments&&... arguments)
{
    m_types.append(std::unique_ptr<Type>(new Type(TypeKind { std::forward<Arguments>(arguments)... })));
    return m_types.last().get();
}

} // namespace WGSL
