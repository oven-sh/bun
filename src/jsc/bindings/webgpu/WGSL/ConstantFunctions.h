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

#pragma once

#include "ConstantValue.h"
#include "Constraints.h"
#include "Types.h"
#include <bit>
#include <numbers>
#include <wtf/Assertions.h>
#include <wtf/DataLog.h>
#include <wtf/text/MakeString.h>

namespace WGSL {

// Zero values

using ConstantResult = Expected<ConstantValue, String>;
using ConstantFunction = ConstantResult(*)(const Type*, const FixedVector<ConstantValue>&);

#define CONSTANT_FUNCTION(name) \
    [[maybe_unused]] static Expected<ConstantValue, String>(constant ## name)(const Type* resultType, const FixedVector<ConstantValue>& arguments)

#define CALL_(__tmp, __variable, __fnName, ...) \
    auto __tmp = constant##__fnName(__VA_ARGS__); \
    if (!__tmp) \
        return makeUnexpected(__tmp.error()); \
    auto __variable = WTF::move(*__tmp)

#define CALL(__variable, __fnName, ...) \
    CALL_(WTF_LAZY_JOIN(tmp, __COUNTER__), __variable, __fnName, __VA_ARGS__)

#define CALL_MOVE_(__tmp, __target, __fnName, ...) \
    do { \
        auto __tmp = constant##__fnName(__VA_ARGS__); \
        if (!__tmp) \
            return makeUnexpected(__tmp.error()); \
        __target = WTF::move(*__tmp); \
    } while (0)

#define CALL_MOVE(__target, __fnName, ...) \
    CALL_MOVE_(tmp ## __COUNTER__, __target, __fnName, __VA_ARGS__)


[[maybe_unused]] static ConstantValue zeroValue(const Type* type)
{
    return WTF::switchOn(*type,
        [&](const Types::Primitive& primitive) -> ConstantValue {
            switch (primitive.kind) {
            case Types::Primitive::AbstractInt:
                return static_cast<int64_t>(0);
            case Types::Primitive::I32:
                return 0;
            case Types::Primitive::U32:
                return 0u;
            case Types::Primitive::AbstractFloat:
                return 0.0;
            case Types::Primitive::F32:
                return 0.0f;
            case Types::Primitive::F16:
                return static_cast<half>(0.0);
            case Types::Primitive::Bool:
                return false;
            case Types::Primitive::Void:
            case Types::Primitive::Sampler:
            case Types::Primitive::SamplerComparison:
            case Types::Primitive::TextureExternal:
            case Types::Primitive::AccessMode:
            case Types::Primitive::TexelFormat:
            case Types::Primitive::AddressSpace:
                RELEASE_ASSERT_NOT_REACHED();
            }
        },
        [&](const Types::Vector& vector) -> ConstantValue {
            ConstantVector result(vector.size);
            auto value = zeroValue(vector.element);
            for (unsigned i = 0; i < vector.size; ++i)
                result.elements[i] = value;
            return result;
        },
        [&](const Types::Array& array) -> ConstantValue {
            ASSERT(std::holds_alternative<unsigned>(array.size));
            auto size = std::get<unsigned>(array.size);
            ConstantArray result(size);
            auto value = zeroValue(array.element);
            for (unsigned i = 0; i < size; ++i)
                result.elements[i] = value;
            return result;
        },
        [&](const Types::Struct& structType) -> ConstantValue {
            HashMap<String, ConstantValue> constantFields;
            for (auto& [key, type] : structType.fields)
                constantFields.set(key, zeroValue(type));
            return ConstantStruct { WTF::move(constantFields) };
        },
        [&](const Types::PrimitiveStruct&) -> ConstantValue {
            // Primitive structs can't be zero initialized
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const Types::Matrix& matrix) -> ConstantValue {
            ConstantMatrix result(matrix.columns, matrix.rows);
            auto value = zeroValue(matrix.element);
            for (unsigned i = 0; i < result.elements.size(); ++i)
                result.elements[i] = value;
            return result;
        },
        [&](const Types::Reference&) -> ConstantValue {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const Types::Pointer&) -> ConstantValue {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const Types::Function&) -> ConstantValue {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const Types::Texture&) -> ConstantValue {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const Types::TextureStorage&) -> ConstantValue {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const Types::TextureDepth&) -> ConstantValue {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const Types::Atomic&) -> ConstantValue {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const Types::TypeConstructor&) -> ConstantValue {
            RELEASE_ASSERT_NOT_REACHED();
        });
}

// Helpers

template<Constraint constraint, typename Functor>
[[maybe_unused]] static ConstantResult constantUnaryOperation(const FixedVector<ConstantValue>& arguments, const Functor& fn)
{
    ASSERT(arguments.size() == 1);
    return scalarOrVector([&](auto& arg) -> ConstantResult {
        if constexpr (constraint & Constraints::Bool) {
            if (auto* boolean = std::get_if<bool>(&arg))
                return { { fn(*boolean) } };
        }
        if constexpr (constraint & Constraints::I32) {
            if (auto* i32 = std::get_if<int32_t>(&arg))
                return { { fn(*i32) } };
        }
        if constexpr (constraint & Constraints::U32) {
            if (auto* u32 = std::get_if<uint32_t>(&arg))
                return { { fn(*u32) } };
        }
        if constexpr (constraint & Constraints::AbstractInt) {
            if (auto* abstractInt = std::get_if<int64_t>(&arg))
                return { { fn(*abstractInt) } };
        }
        if constexpr (constraint & Constraints::F32) {
            if (auto* f32 = std::get_if<float>(&arg))
                return { { fn(*f32) } };
        }
        if constexpr (constraint & Constraints::F16) {
            if (auto* f16 = std::get_if<half>(&arg))
                return { { fn(*f16) } };
        }
        if constexpr (constraint & Constraints::AbstractFloat) {
            if (auto* abstractFloat = std::get_if<double>(&arg))
                return { { fn(*abstractFloat) } };
        }
        RELEASE_ASSERT_NOT_REACHED();
    }, arguments[0]);
}

template<Constraint constraint, typename Functor>
[[maybe_unused]] static ConstantResult constantBinaryOperation(const FixedVector<ConstantValue>& arguments, const Functor& fn)
{
    ASSERT(arguments.size() == 2);
    return scalarOrVector([&](auto& left, auto& right) -> ConstantResult {
        if constexpr (constraint & Constraints::Bool) {
            if (auto* leftBool = std::get_if<bool>(&left))
                return { { fn(*leftBool, std::get<bool>(right)) } };
        }
        if constexpr (constraint & Constraints::I32) {
            if (auto* leftI32 = std::get_if<int32_t>(&left))
                return { { fn(*leftI32, std::get<int32_t>(right)) } };
        }
        if constexpr (constraint & Constraints::U32) {
            if (auto* leftU32 = std::get_if<uint32_t>(&left))
                return { { fn(*leftU32, std::get<uint32_t>(right)) } };
        }
        if constexpr (constraint & Constraints::AbstractInt) {
            if (auto* leftAbstractInt = std::get_if<int64_t>(&left))
                return { { fn(*leftAbstractInt, std::get<int64_t>(right)) } };
        }
        if constexpr (constraint & Constraints::F32) {
            if (auto* leftF32 = std::get_if<float>(&left))
                return { { fn(*leftF32, std::get<float>(right)) } };
        }
        if constexpr (constraint & Constraints::F16) {
            if (auto* leftF16 = std::get_if<half>(&left))
                return { { fn(*leftF16, std::get<half>(right)) } };
        }
        if constexpr (constraint & Constraints::AbstractFloat) {
            if (auto* leftAbstractFloat = std::get_if<double>(&left))
                return { { fn(*leftAbstractFloat, std::get<double>(right)) } };
        }
        RELEASE_ASSERT_NOT_REACHED();
    }, arguments[0], arguments[1]);
}

template<Constraint constraint, typename Functor>
[[maybe_unused]] static ConstantResult constantTernaryOperation(const FixedVector<ConstantValue>& arguments, const Functor& fn)
{
    ASSERT(arguments.size() == 3);
    return scalarOrVector([&](auto& first, auto& second, auto& third) -> ConstantResult {
        if constexpr (constraint & Constraints::Bool) {
            if (auto* firstBool = std::get_if<bool>(&first))
                return { { fn(*firstBool, std::get<bool>(second), std::get<bool>(third)) } };
        }
        if constexpr (constraint & Constraints::I32) {
            if (auto* firstI32 = std::get_if<int32_t>(&first))
                return { { fn(*firstI32, std::get<int32_t>(second), std::get<int32_t>(third)) } };
        }
        if constexpr (constraint & Constraints::U32) {
            if (auto* firstU32 = std::get_if<uint32_t>(&first))
                return { { fn(*firstU32, std::get<uint32_t>(second), std::get<uint32_t>(third)) } };
        }
        if constexpr (constraint & Constraints::AbstractInt) {
            if (auto* firstAbstractInt = std::get_if<int64_t>(&first))
                return { { fn(*firstAbstractInt, std::get<int64_t>(second), std::get<int64_t>(third)) } };
        }
        if constexpr (constraint & Constraints::F32) {
            if (auto* firstF32 = std::get_if<float>(&first))
                return { { fn(*firstF32, std::get<float>(second), std::get<float>(third)) } };
        }
        if constexpr (constraint & Constraints::F16) {
            if (auto* firstF16 = std::get_if<half>(&first))
                return { { fn(*firstF16, std::get<half>(second), std::get<half>(third)) } };
        }
        if constexpr (constraint & Constraints::AbstractFloat) {
            if (auto* firstAbstractFloat = std::get_if<double>(&first))
                return { { fn(*firstAbstractFloat, std::get<double>(second), std::get<double>(third)) } };
        }
        RELEASE_ASSERT_NOT_REACHED();
    }, arguments[0], arguments[1], arguments[2]);
}

template<typename U>
struct StaticCast {
    template<typename T>
    static U cast(T t)
    {
        if constexpr (std::is_integral_v<U> && !std::is_same_v<U, bool> && (std::is_floating_point_v<T> || std::is_same_v<T, half>)) {
            if constexpr (std::is_same_v<T, half>) {
                static const half max = 0x1.ffcp15;
                static const half lowest = -max;
                return U(std::clamp(t, std::max(T(std::numeric_limits<U>::min()), lowest), max));
            } else if (std::is_same_v<T, float>)
                return U(std::clamp(t, T(std::numeric_limits<U>::min()), T(std::numeric_limits<U>::max() - ((128 << (!std::is_signed_v<U>)) - 1))));
        }

        return static_cast<U>(t);
    }
};

template<typename U>
struct BitwiseCast {
    template<typename T>
    static U cast(T t) { return std::bit_cast<U>(t); }
};

template<typename DestinationType, template <typename U> typename Cast = StaticCast>
[[maybe_unused]] static ConstantValue convertValue(ConstantValue value)
{
    if constexpr (std::is_same_v<Cast<DestinationType>, StaticCast<DestinationType>> || sizeof(DestinationType) == 4) {
        if (auto* i32 = std::get_if<int32_t>(&value))
            return Cast<DestinationType>::cast(*i32);
        if (auto* u32 = std::get_if<uint32_t>(&value))
            return Cast<DestinationType>::cast(*u32);
        if (auto* f32 = std::get_if<float>(&value))
            return Cast<DestinationType>::cast(*f32);
    }

    if constexpr (std::is_same_v<Cast<DestinationType>, StaticCast<DestinationType>> || sizeof(DestinationType) == 2) {
        if (auto* f16 = std::get_if<half>(&value))
            return Cast<DestinationType>::cast(*f16);
    }

    if constexpr (std::is_same_v<Cast<DestinationType>, StaticCast<DestinationType>>) {
        if (auto* boolean = std::get_if<bool>(&value))
            return Cast<DestinationType>::cast(*boolean);
        if (auto* abstractInt = std::get_if<int64_t>(&value))
            return Cast<DestinationType>::cast(*abstractInt);
        if (auto* abstractFloat = std::get_if<double>(&value))
            return Cast<DestinationType>::cast(*abstractFloat);
    }
    RELEASE_ASSERT_NOT_REACHED();
}

template<template <typename U> typename Cast = StaticCast>
[[maybe_unused]] static ConstantValue convertValue(const Type* targetType, ConstantValue value)
{
    ASSERT(std::holds_alternative<Types::Primitive>(*targetType));
    auto& primitive = std::get<Types::Primitive>(*targetType);
    switch (primitive.kind)  {
    case Types::Primitive::AbstractInt:
        return convertValue<int64_t, Cast>(value);
    case Types::Primitive::I32:
        return convertValue<int32_t, Cast>(value);
    case Types::Primitive::U32:
        return convertValue<uint32_t, Cast>(value);
    case Types::Primitive::AbstractFloat:
        return convertValue<double, Cast>(value);
    case Types::Primitive::F32:
        return convertValue<float, Cast>(value);
    case Types::Primitive::F16:
        return convertValue<half, Cast>(value);
    case Types::Primitive::Bool:
        return convertValue<bool, Cast>(value);
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

template<typename DestinationType>
[[maybe_unused]] static ConstantValue constantConstructor(const Type* resultType, const FixedVector<ConstantValue>& arguments)
{
    if (arguments.isEmpty())
        return zeroValue(resultType);

    ASSERT(arguments.size() == 1);
    return convertValue<DestinationType>(arguments[0]);
}


template<typename Functor, typename... Arguments>
[[maybe_unused]] static ConstantResult scalarOrVector(const Functor& functor, Arguments&&... unpackedArguments)
{
    unsigned vectorSize = 0;
    std::initializer_list<ConstantValue> arguments { unpackedArguments... };
    for (auto argument : arguments) {
        if (auto* vector = std::get_if<ConstantVector>(&argument)) {
            vectorSize = vector->elements.size();
            break;
        }
    }
    if (!vectorSize)
        return functor(std::forward<Arguments>(unpackedArguments)...);

    constexpr auto argumentCount = sizeof...(Arguments);
    ConstantVector result(vectorSize);
    std::array<ConstantValue, argumentCount> scalars;
    for (unsigned i = 0; i < vectorSize; ++i) {
        unsigned j = 0;
        for (const auto& argument : arguments) {
            if (auto* vector = std::get_if<ConstantVector>(&argument))
                scalars[j++] = vector->elements[i];
            else
                scalars[j++] = argument;
        }
        ConstantResult tmp = std::apply(functor, scalars);
        if (!tmp)
            return makeUnexpected(tmp.error());
        result.elements[i] = WTF::move(*tmp);
    }
    return { { result } };
}

[[maybe_unused]] static ConstantValue constantVector(const Type* resultType, const FixedVector<ConstantValue>& arguments, unsigned size)
{
    ConstantVector result(size);
    auto argumentCount = arguments.size();

    ASSERT(std::holds_alternative<Types::Vector>(*resultType));
    if (!argumentCount) {
        return zeroValue(resultType);
    }

    if (argumentCount == 1) {
        auto& vectorType = std::get<Types::Vector>(*resultType);
        auto* elementType = vectorType.element;
        if (auto* vector = std::get_if<ConstantVector>(&arguments[0])) {
            ASSERT(vector->elements.size() == vectorType.size);
            unsigned i = 0;
            for (auto element : vector->elements)
                result.elements[i++] = convertValue(elementType, element);
        } else {
            for (unsigned i = 0; i < size; ++i)
                result.elements[i] = convertValue(elementType, arguments[0]);
        }
        return result;
    }

    unsigned i = 0;
    for (const auto& argument : arguments) {
        const auto* vector = std::get_if<ConstantVector>(&argument);
        if (!vector) {
            result.elements[i++] = argument;
            continue;
        }
        for (auto element : vector->elements)
            result.elements[i++] = element;
    }
    ASSERT(i == size);
    return { result };
}

[[maybe_unused]] static ConstantValue constantMatrix(const Type* resultType, const FixedVector<ConstantValue>& arguments, unsigned columns, unsigned rows)
{
    if (arguments.isEmpty())
        return zeroValue(resultType);


    if (arguments.size() == 1) {
        auto& matrixType = std::get<Types::Matrix>(*resultType);
        auto* elementType = matrixType.element;
        auto& matrix = std::get<ConstantMatrix>(arguments[0]);
        ASSERT(matrix.elements.size() == matrixType.rows * matrixType.columns);
        ConstantMatrix result(columns, rows);
        unsigned i = 0;
        for (auto& element : matrix.elements)
            result.elements[i++] = convertValue(elementType, element);
        return result;
    }

    if (arguments.size() == columns * rows)
        return ConstantMatrix { columns, rows, arguments };

    RELEASE_ASSERT(arguments.size() == columns);
    ConstantMatrix result(columns, rows);
    unsigned i = 0;
    for (auto& arg : arguments) {
        ASSERT(arg.isVector());
        auto& vector = arg.toVector();
        ASSERT(vector.elements.size() == rows);
        for (auto& element : vector.elements)
            result.elements[i++] = element;
    }
    ASSERT(i == columns * rows);
    return result;
}

#define UNARY_OPERATION(name, constraint, fn) \
    CONSTANT_FUNCTION(name) \
    { \
        UNUSED_PARAM(resultType); \
        return constantUnaryOperation<Constraints::constraint>(arguments, fn); \
    }

#define BINARY_OPERATION(name, constraint, fn) \
    CONSTANT_FUNCTION(name) \
    { \
        UNUSED_PARAM(resultType); \
        return constantBinaryOperation<Constraints::constraint>(arguments, fn); \
    }

#define TERNARY_OPERATION(name, constraint, fn) \
    CONSTANT_FUNCTION(name) \
    { \
        UNUSED_PARAM(resultType); \
        return constantTernaryOperation<Constraints::constraint>(arguments, fn); \
    }

#define CONSTANT_CONSTRUCTOR(name, type) \
    CONSTANT_FUNCTION(name) \
    { \
        return { constantConstructor<type>(resultType, arguments) }; \
    }

#define MATRIX_CONSTRUCTOR(columns, rows) \
    CONSTANT_FUNCTION(Mat ## columns ## x ## rows) \
    { \
        return constantMatrix(resultType, arguments, columns, rows); \
    }

#define CONSTANT_TRIGONOMETRIC(name, fn) UNARY_OPERATION(name, Float, WRAP_STD(fn))

#define WRAP_STD(fn) \
    [&]<typename T, typename... Args>(T arg, Args&&... args) -> T { return std::fn(arg, std::forward<Args>(args)...); }

// Arithmetic operators

CONSTANT_FUNCTION(Add)
{
    ASSERT(arguments.size() == 2);

    if (auto* left = std::get_if<ConstantMatrix>(&arguments[0])) {
        auto& right = std::get<ConstantMatrix>(arguments[1]);
        auto* elementType = std::get<Types::Matrix>(*resultType).element;
        ASSERT(left->columns == right.columns);
        ASSERT(left->rows == right.rows);
        ConstantMatrix result(left->columns, left->rows);
        for (unsigned i = 0; i < result.elements.size(); ++i)
            CALL_MOVE(result.elements[i], Add, elementType, { left->elements[i], right.elements[i] });
        return { { result } };
    }

    return constantBinaryOperation<Constraints::Number>(arguments, [&]<typename T>(T left, T right) -> ConstantResult {
        auto result = static_cast<T>(left + right);
        if constexpr (std::is_floating_point_v<T> || std::is_same_v<T, half>) {
            if (!std::isfinite(static_cast<double>(result)))
                return makeUnexpected("addition overflow"_s);
        }
        return { { result } };
    });
}

CONSTANT_FUNCTION(Minus)
{
    UNUSED_PARAM(resultType);
    if (arguments.size() == 1) {
        return constantUnaryOperation<Constraints::Number>(arguments, [&]<typename T>(T arg) -> T {
            return -arg;
        });
    }

    if (auto* left = std::get_if<ConstantMatrix>(&arguments[0])) {
        auto& right = std::get<ConstantMatrix>(arguments[1]);
        auto* elementType = std::get<Types::Matrix>(*resultType).element;
        ASSERT(left->columns == right.columns);
        ASSERT(left->rows == right.rows);
        ConstantMatrix result(left->columns, left->rows);
        for (unsigned i = 0; i < result.elements.size(); ++i)
            CALL_MOVE(result.elements[i], Minus, elementType, { left->elements[i], right.elements[i] });
        return { { result } };
    }

    return constantBinaryOperation<Constraints::Number>(arguments, [&]<typename T>(T left, T right) -> ConstantResult {
        auto result = static_cast<T>(left - right);
        if constexpr (std::is_floating_point_v<T> || std::is_same_v<T, half>) {
            if (!std::isfinite(static_cast<double>(result)))
                return makeUnexpected("subtraction overflow"_s);
        }
        return { { result } };
    });
}


CONSTANT_FUNCTION(Dot);

CONSTANT_FUNCTION(Multiply)
{
    ASSERT(arguments.size() == 2);

    auto* leftMatrix = std::get_if<ConstantMatrix>(&arguments[0]);
    auto* rightMatrix = std::get_if<ConstantMatrix>(&arguments[1]);
    if (leftMatrix && rightMatrix) {
        ASSERT(leftMatrix->columns == rightMatrix->rows);
        auto* elementType = std::get<Types::Matrix>(*resultType).element;
        ConstantMatrix result(rightMatrix->columns, leftMatrix->rows);
        for (unsigned i = 0; i < rightMatrix->columns; ++i) {
            for (unsigned j = 0; j < leftMatrix->rows; ++j) {
                ConstantValue value = zeroValue(elementType);
                for (unsigned k = 0; k < leftMatrix->columns; ++k) {
                    CALL(tmp, Multiply, elementType, { leftMatrix->elements[k * leftMatrix->rows + j], rightMatrix->elements[i * rightMatrix->rows + k] });
                    CALL_MOVE(value, Add, elementType, { value, tmp });
                }
                result.elements[i * result.rows + j] = value;
            }
        }
        return { { result } };
    }
    if (leftMatrix || rightMatrix) {
        if (auto* rightVector = std::get_if<ConstantVector>(&arguments[1])) {
            auto* elementType = std::get<Types::Vector>(*resultType).element;
            auto columns = leftMatrix->columns;
            auto rows = leftMatrix->rows;
            ConstantVector result(rows);
            ConstantVector leftVector(columns);
            for (unsigned i = 0; i < rows; ++i) {
                for (unsigned j = 0; j < columns; ++j)
                    leftVector.elements[j] = leftMatrix->elements[j * rows + i];
                CALL_MOVE(result.elements[i], Dot, elementType, { leftVector, *rightVector });
            }
            return { { result } };
        }

        if (auto* leftVector = std::get_if<ConstantVector>(&arguments[0])) {
            auto* elementType = std::get<Types::Vector>(*resultType).element;
            auto columns = rightMatrix->columns;
            auto rows = rightMatrix->rows;
            ConstantVector result(columns);
            ConstantVector rightVector(rows);
            for (unsigned i = 0; i < columns; ++i) {
                for (unsigned j = 0; j < rows; ++j)
                    rightVector.elements[j] = rightMatrix->elements[i * rows + j];
                CALL_MOVE(result.elements[i], Dot, elementType, { *leftVector, rightVector });
            }
            return { { result } };
        }

        const ConstantMatrix* matrix;
        ConstantValue scalar;
        if (leftMatrix) {
            matrix = leftMatrix;
            scalar = arguments[1];
        } else {
            matrix = rightMatrix;
            scalar = arguments[0];
        }

        auto* elementType = std::get<Types::Matrix>(*resultType).element;
        ConstantMatrix result(matrix->columns, matrix->rows);
        for (unsigned i = 0; i < result.elements.size(); ++i)
            CALL_MOVE(result.elements[i], Multiply, elementType, { matrix->elements[i], scalar });
        return { { result } };
    }

    return constantBinaryOperation<Constraints::Number>(arguments, [&]<typename T>(T left, T right) -> ConstantResult {
        auto result = static_cast<T>(left * right);
        if constexpr (std::is_floating_point_v<T> || std::is_same_v<T, half>) {
            if (!std::isfinite(static_cast<double>(result)))
                return makeUnexpected("multiply overflow"_s);
        }
        return { { result } };
    });
}

BINARY_OPERATION(Divide, Number, [&]<typename T>(T left, T right) -> ConstantResult {
    if constexpr (std::is_integral_v<T>) {
        if (!right)
            return makeUnexpected("invalid division by zero"_s);
        if constexpr (std::is_signed_v<T>) {
            if (left == std::numeric_limits<T>::lowest() && right == -1)
                return makeUnexpected("invalid division overflow"_s);
        }
    }
    return { { static_cast<T>(left / right) } };
});

BINARY_OPERATION(Modulo, Number, [&]<typename T>(T left, T right) -> ConstantResult {
    if constexpr (std::is_floating_point_v<decltype(left)> || std::is_same_v<T, half>)
        return { { static_cast<T>(fmod(left, right)) } };
    else {
        if (!right)
            return makeUnexpected("invalid modulo by zero"_s);
        if constexpr (std::is_signed_v<T>) {
            if (left == std::numeric_limits<T>::lowest() && right == -1)
                return makeUnexpected("invalid modulo overflow"_s);
        }
        return { { left % right } };
    }
});

// Comparison Operations

BINARY_OPERATION(Equal, Scalar, [&](auto left, auto right) { return left == right; })
BINARY_OPERATION(NotEqual, Scalar, [&](auto left, auto right) { return left != right; })
BINARY_OPERATION(Lt, Scalar, [&](auto left, auto right) { return left < right; })
BINARY_OPERATION(LtEq, Scalar, [&](auto left, auto right) { return left <= right; })
BINARY_OPERATION(Gt, Scalar, [&](auto left, auto right) { return left > right; })
BINARY_OPERATION(GtEq, Scalar, [&](auto left, auto right) { return left >= right; })

// Logical Expressions

UNARY_OPERATION(Not, Bool, [&](bool arg) { return !arg; })
BINARY_OPERATION(Or, Bool, [&](bool left, bool right) { return left || right; })
BINARY_OPERATION(And, Bool, [&](bool left, bool right) { return left && right; })


// Bit Expressions

CONSTANT_FUNCTION(BitwiseOr)
{
    UNUSED_PARAM(resultType);
    return scalarOrVector([&](const auto& left, auto& right) -> ConstantValue {
        if (auto* leftBool = std::get_if<bool>(&left))
            return static_cast<bool>(static_cast<int>(*leftBool) | static_cast<int>(std::get<bool>(right)));
        if (auto* leftI32 = std::get_if<int32_t>(&left))
            return *leftI32 | std::get<int32_t>(right);
        if (auto* leftU32 = std::get_if<uint32_t>(&left))
            return *leftU32 | std::get<uint32_t>(right);
        if (auto* leftAbstractInt = std::get_if<int64_t>(&left))
            return *leftAbstractInt | std::get<int64_t>(right);
        RELEASE_ASSERT_NOT_REACHED();
    }, arguments[0], arguments[1]);
}

CONSTANT_FUNCTION(BitwiseAnd)
{
    UNUSED_PARAM(resultType);
    return scalarOrVector([&](const auto& left, auto& right) -> ConstantValue {
        if (auto* leftBool = std::get_if<bool>(&left))
            return static_cast<bool>(static_cast<int>(*leftBool) & static_cast<int>(std::get<bool>(right)));
        if (auto* leftI32 = std::get_if<int32_t>(&left))
            return *leftI32 & std::get<int32_t>(right);
        if (auto* leftU32 = std::get_if<uint32_t>(&left))
            return *leftU32 & std::get<uint32_t>(right);
        if (auto* leftAbstractInt = std::get_if<int64_t>(&left))
            return *leftAbstractInt & std::get<int64_t>(right);
        RELEASE_ASSERT_NOT_REACHED();
    }, arguments[0], arguments[1]);
}

UNARY_OPERATION(BitwiseNot, Integer, [&](auto arg) { return ~arg; })
BINARY_OPERATION(BitwiseXor, Integer, [&](auto left, auto right) { return left ^ right; })

CONSTANT_FUNCTION(BitwiseShiftLeft)
{
    // We can't use a BINARY_OPERATION here since the arguments might not all have the same type
    // i.e. we accept (u32, u32) as well as (i32, u32)
    UNUSED_PARAM(resultType);
    ASSERT(arguments.size() == 2);
    const auto& shift = [&]<typename T>(T left, uint32_t right) -> ConstantResult {
        constexpr auto bitSize = sizeof(T) * 8;
        if (right >= bitSize)
            return makeUnexpected(makeString("shift left value must be less than the bit width of the shifted value, which is "_s, bitSize));

        if constexpr (std::is_unsigned_v<T>) {
            uint64_t mask = -1ull << (bitSize - right);
            if (left & mask)
                return makeUnexpected("shift left overflows"_s);
        } else {
            uint64_t mask = -1ull << (bitSize - (right + 1));
            auto leftBits = left & mask;
            if (leftBits && leftBits != mask)
                return makeUnexpected("shift left overflows"_s);
        }

        return { left << right };
    };

    return scalarOrVector([&](const auto& left, const auto& rightValue) -> ConstantResult {
        auto right = std::get<uint32_t>(rightValue);
        if (auto* i32 = std::get_if<int32_t>(&left))
            return shift(*i32, right);
        if (auto* u32 = std::get_if<uint32_t>(&left))
            return shift(*u32, right);
        if (auto* abstractInt = std::get_if<int64_t>(&left))
            return shift(*abstractInt, right);
        RELEASE_ASSERT_NOT_REACHED();
    }, arguments[0], arguments[1]);
}

CONSTANT_FUNCTION(BitwiseShiftRight)
{
    // We can't use a BINARY_OPERATION here since the arguments might not all have the same type
    // i.e. we accept (u32, u32) as well as (i32, u32)
    UNUSED_PARAM(resultType);
    ASSERT(arguments.size() == 2);
    const auto& shift = [&]<typename T>(T left, uint32_t right) -> ConstantResult {
        constexpr auto bitSize = sizeof(T) * 8;
        if constexpr (std::is_same_v<T, int64_t>) {
            // Abstract-int right shifts are permitted to shift by >= bitwidth
            if (right >= bitSize)
                return { left < 0 ? T(-1) : T(0) };
        } else {
            if (right >= bitSize)
                return makeUnexpected(makeString("shift right value must be less than the bit width of the shifted value, which is "_s, bitSize));
        }
        return { left >> right };
    };

    return scalarOrVector([&](const auto& left, const auto& rightValue) -> ConstantResult {
        auto right = std::get<uint32_t>(rightValue);
        if (auto* i32 = std::get_if<int32_t>(&left))
            return shift(*i32, right);
        if (auto* u32 = std::get_if<uint32_t>(&left))
            return shift(*u32, right);
        if (auto* abstractInt = std::get_if<int64_t>(&left))
            return shift(*abstractInt, right);
        RELEASE_ASSERT_NOT_REACHED();
    }, arguments[0], arguments[1]);
}


// Constructors

CONSTANT_CONSTRUCTOR(Bool, bool)
CONSTANT_CONSTRUCTOR(F32, float)
CONSTANT_CONSTRUCTOR(F16, half)

CONSTANT_FUNCTION(I32)
{
    if (arguments.size()) {
        if (auto* abstractInt = std::get_if<int64_t>(&arguments[0])) {
            auto result = convertInteger<int32_t>(*abstractInt);
            if (result)
                return { *result };
            return makeUnexpected(makeString("value "_s, *abstractInt, " cannot be represented as 'i32'"_s));
        }
    }

    return { constantConstructor<int32_t>(resultType, arguments) };
}

CONSTANT_FUNCTION(U32)
{
    if (arguments.size()) {
        if (auto* abstractInt = std::get_if<int64_t>(&arguments[0])) {
            auto result = convertInteger<uint32_t>(*abstractInt);
            if (result)
                return { *result };
            return makeUnexpected(makeString("value "_s, *abstractInt, " cannot be represented as 'u32'"_s));
        }
    }

    return { constantConstructor<uint32_t>(resultType, arguments) };
}

CONSTANT_FUNCTION(Vec2)
{
    return constantVector(resultType, arguments, 2);
}

CONSTANT_FUNCTION(Vec3)
{
    return constantVector(resultType, arguments, 3);
}

CONSTANT_FUNCTION(Vec4)
{
    return constantVector(resultType, arguments, 4);
}

MATRIX_CONSTRUCTOR(2, 2);
MATRIX_CONSTRUCTOR(2, 3);
MATRIX_CONSTRUCTOR(2, 4);
MATRIX_CONSTRUCTOR(3, 2);
MATRIX_CONSTRUCTOR(3, 3);
MATRIX_CONSTRUCTOR(3, 4);
MATRIX_CONSTRUCTOR(4, 2);
MATRIX_CONSTRUCTOR(4, 3);
MATRIX_CONSTRUCTOR(4, 4);

// Logical Built-in Functions

CONSTANT_FUNCTION(All)
{
    UNUSED_PARAM(resultType);
    ASSERT(arguments.size() == 1);
    const auto& arg = arguments[0];
    if (arg.isBool())
        return arg;

    ASSERT(arg.isVector());
    for (auto element : arg.toVector().elements) {
        if (!element.toBool())
            return { { false } };
    }
    return { { true } };
}

CONSTANT_FUNCTION(Any)
{
    UNUSED_PARAM(resultType);
    ASSERT(arguments.size() == 1);
    const auto& arg = arguments[0];
    if (arg.isBool())
        return arg;

    ASSERT(arg.isVector());
    for (auto element : arg.toVector().elements) {
        if (element.toBool())
            return { { true } };
    }
    return { { false } };
}

CONSTANT_FUNCTION(Select)
{
    UNUSED_PARAM(resultType);
    ASSERT(arguments.size() == 3);
    const auto& falseValue = arguments[0];
    const auto& trueValue = arguments[1];
    const auto& condition = arguments[2];
    if (condition.isBool())
        return condition.toBool() ? trueValue : falseValue;

    ASSERT(falseValue.isVector());
    ASSERT(trueValue.isVector());
    ASSERT(condition.isVector());

    const auto& falseVector = arguments[0].toVector();
    const auto& trueVector = arguments[1].toVector();
    const auto& conditionVector = arguments[2].toVector();

    auto size = conditionVector.elements.size();
    ASSERT(size == falseVector.elements.size());
    ASSERT(size == trueVector.elements.size());

    ConstantVector result(size);
    for (unsigned i = 0; i < size; ++i) {
        result.elements[i] = conditionVector.elements[i].toBool()
            ? trueVector.elements[i]
            : falseVector.elements[i];
    }
    return { { result } };
}

// Numeric Built-in Functions

CONSTANT_TRIGONOMETRIC(Acos, acos);
CONSTANT_TRIGONOMETRIC(Asin, asin);
CONSTANT_TRIGONOMETRIC(Atan, atan);
CONSTANT_TRIGONOMETRIC(Cos,  cos);
CONSTANT_TRIGONOMETRIC(Sin,  sin);
CONSTANT_TRIGONOMETRIC(Tan,  tan);
CONSTANT_TRIGONOMETRIC(Acosh, acosh);
CONSTANT_TRIGONOMETRIC(Asinh, asinh);
CONSTANT_TRIGONOMETRIC(Atanh, atanh);
CONSTANT_TRIGONOMETRIC(Cosh, cosh);
CONSTANT_TRIGONOMETRIC(Sinh, sinh);
CONSTANT_TRIGONOMETRIC(Tanh, tanh);

UNARY_OPERATION(Abs, Number, [&]<typename T>(T n) -> T {
    if constexpr (std::is_same_v<decltype(n), uint32_t>)
        return n;
    else
        return std::abs(n);
});

BINARY_OPERATION(Atan2, Float, WRAP_STD(atan2))
UNARY_OPERATION(Ceil, Float, WRAP_STD(ceil))

TERNARY_OPERATION(Clamp, Number, [&]<typename T>(T e, T low, T high) -> ConstantResult {
    if (low > high)
        return makeUnexpected(makeString("clamp called with low ("_s, String::number(low), ") greater than high ("_s, String::number(high), ")"_s));
    return { { std::min(std::max(e, low), high) } };
})

UNARY_OPERATION(CountLeadingZeros, ConcreteInteger, [&]<typename T>(T arg) -> T {
    return std::countl_zero(static_cast<unsigned>(arg));
})

UNARY_OPERATION(CountOneBits, ConcreteInteger, [&]<typename T>(T arg) -> T {
    return std::popcount(static_cast<unsigned>(arg));
})

UNARY_OPERATION(CountTrailingZeros, ConcreteInteger, [&]<typename T>(T arg) -> T {
    return std::countr_zero(static_cast<unsigned>(arg));
})

CONSTANT_FUNCTION(Cross)
{
    UNUSED_PARAM(resultType);
    ASSERT(arguments.size() == 2);
    auto& lhs = arguments[0].toVector();
    auto& rhs = arguments[1].toVector();

    const auto& cross = [&]<typename T>() -> ConstantResult {
        auto u0 = std::get<T>(lhs.elements[0]);
        auto u1 = std::get<T>(lhs.elements[1]);
        auto u2 = std::get<T>(lhs.elements[2]);
        auto v0 = std::get<T>(rhs.elements[0]);
        auto v1 = std::get<T>(rhs.elements[1]);
        auto v2 = std::get<T>(rhs.elements[2]);

        ConstantVector result(3);
        result.elements[0] = static_cast<T>(u1 * v2 - u2 * v1);
        result.elements[1] = static_cast<T>(u2 * v0 - u0 * v2);
        result.elements[2] = static_cast<T>(u0 * v1 - u1 * v0);
        return { { result } };
    };

    if (std::holds_alternative<float>(lhs.elements[0]))
        return cross.operator()<float>();
    if (std::holds_alternative<half>(lhs.elements[0]))
        return cross.operator()<half>();
    if (std::holds_alternative<double>(lhs.elements[0]))
        return cross.operator()<double>();
    RELEASE_ASSERT_NOT_REACHED();
}

UNARY_OPERATION(Degrees, Float, [&]<typename T>(T arg) -> T { return arg * (180 / std::numbers::pi); })

CONSTANT_FUNCTION(Determinant)
{
    UNUSED_PARAM(resultType);
    ASSERT(arguments.size() == 1);
    auto& matrix = std::get<ConstantMatrix>(arguments[0]);
    auto columns = matrix.columns;
    auto solve2 = [&]<typename T>(
        T a, T b,
        T c, T d
    ) -> T {
        return a * d - b * c;
    };

    auto solve3 = [&]<typename T>(
        T a, T b, T c,
        T d, T e, T f,
        T g, T h, T i
    ) -> T {
        return a * e * i + b * f * g + c * d * h - c * e * g - b * d * i - a * f * h;
    };

    auto solve4 = [&]<typename T>(
        T a, T b, T c, T d,
        T e, T f, T g, T h,
        T i, T j, T k, T l,
        T m, T n, T o, T p
    ) -> T {
        return a * solve3(f, g, h, j, k, l, n, o, p) - b * solve3(e, g, h, i, k, l, m, o, p) + c * solve3(e, f, h, i, j, l, m, n, p) - d * solve3(e, f, g, i, j, k, m, n, o);
    };

    const auto& determinant = [&]<typename T>() {
        switch (columns) {
        case 2:
            return solve2(
                std::get<T>(matrix.elements[0]), std::get<T>(matrix.elements[2]),
                std::get<T>(matrix.elements[1]), std::get<T>(matrix.elements[3])
            );

        case 3:
            return solve3(
                std::get<T>(matrix.elements[0]), std::get<T>(matrix.elements[3]), std::get<T>(matrix.elements[6]),
                std::get<T>(matrix.elements[1]), std::get<T>(matrix.elements[4]), std::get<T>(matrix.elements[7]),
                std::get<T>(matrix.elements[2]), std::get<T>(matrix.elements[5]), std::get<T>(matrix.elements[8])
            );
        case 4:
            return solve4(
                std::get<T>(matrix.elements[0]), std::get<T>(matrix.elements[4]), std::get<T>(matrix.elements[8]),  std::get<T>(matrix.elements[12]),
                std::get<T>(matrix.elements[1]), std::get<T>(matrix.elements[5]), std::get<T>(matrix.elements[9]),  std::get<T>(matrix.elements[13]),
                std::get<T>(matrix.elements[2]), std::get<T>(matrix.elements[6]), std::get<T>(matrix.elements[10]), std::get<T>(matrix.elements[14]),
                std::get<T>(matrix.elements[3]), std::get<T>(matrix.elements[7]), std::get<T>(matrix.elements[11]), std::get<T>(matrix.elements[15])
            );
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }
    };

    if (std::holds_alternative<float>(matrix.elements[0]))
        return { { determinant.operator()<float>() } };
    if (std::holds_alternative<half>(matrix.elements[0]))
        return { { determinant.operator()<half>() } };
    if (std::holds_alternative<double>(matrix.elements[0]))
        return { { determinant.operator()<double>() } };
    RELEASE_ASSERT_NOT_REACHED();
}

CONSTANT_FUNCTION(Length);

CONSTANT_FUNCTION(Distance)
{
    // we can't produce the type for the intermediate computation here. Pass
    // nullptr instead so we crash if we ever start depending on it.
    CALL(minus, Minus, nullptr, arguments);
    return constantLength(resultType, { minus });
}

CONSTANT_FUNCTION(Dot)
{
    CALL(product, Multiply, resultType, arguments);
    ConstantValue result = zeroValue(resultType);
    for (auto& element : product.toVector().elements)
        CALL_MOVE(result, Add, resultType,  { result, element });
    return { { result } };
}

CONSTANT_FUNCTION(Dot4U8Packed)
{
    UNUSED_PARAM(resultType);
    auto lhs = std::bit_cast<std::array<uint8_t, 4>>(std::get<uint32_t>(arguments[0]));
    auto rhs = std::bit_cast<std::array<uint8_t, 4>>(std::get<uint32_t>(arguments[1]));
    uint32_t result = lhs[0] * rhs[0] + lhs[1] * rhs[1] + lhs[2] * rhs[2] + lhs[3] * rhs[3];
    return { { result } };
}

CONSTANT_FUNCTION(Dot4I8Packed)
{
    UNUSED_PARAM(resultType);
    auto lhs = std::bit_cast<std::array<int8_t, 4>>(std::get<uint32_t>(arguments[0]));
    auto rhs = std::bit_cast<std::array<int8_t, 4>>(std::get<uint32_t>(arguments[1]));
    int32_t result = lhs[0] * rhs[0] + lhs[1] * rhs[1] + lhs[2] * rhs[2] + lhs[3] * rhs[3];
    return { { result } };
}

CONSTANT_FUNCTION(Sqrt);

CONSTANT_FUNCTION(Length)
{
    ASSERT(arguments.size() == 1);
    const auto& arg = arguments[0];
    if (!arg.isVector())
        return constantAbs(resultType, arguments);

    ConstantValue result = zeroValue(resultType);
    for (auto& element : arg.toVector().elements) {
        CALL(tmp, Multiply, resultType, { element, element });
        CALL_MOVE(result, Add, resultType, { result, tmp });
    }
    return constantSqrt(resultType, { result });
}

UNARY_OPERATION(Exp, Float, WRAP_STD(exp));
UNARY_OPERATION(Exp2, Float, WRAP_STD(exp2));

CONSTANT_FUNCTION(ExtractBits)
{
    // We can't use a TERNARY_OPERATION here since the arguments might not all have the same type
    // i.e. we accept (u32, u32, u32) as well as (i32, u32, u32)
    UNUSED_PARAM(resultType);
    ASSERT(arguments.size() == 3);
    auto offset = std::get<uint32_t>(arguments[1]);
    auto count = std::get<uint32_t>(arguments[2]);

    const auto& extractBits = [&]<typename T>(T e) {
        constexpr unsigned w = 32;
        unsigned o = std::min(offset, w);
        unsigned c = std::min(count, w - o);
        if (!c)
            return static_cast<T>(0);
        if (c == w)
            return e;
        unsigned srcMask = ((1 << c) - 1) << o;
        T result = (e & srcMask) >> o;
        if constexpr (std::is_signed_v<T>) {
            if (result & (1 << (c - 1))) {
                unsigned dstMask = srcMask >> o;
                result |= (~0 & ~dstMask);
            }
        }
        return result;
    };

    return scalarOrVector([&](const auto& e) -> ConstantValue {
        if (auto* i32 = std::get_if<int32_t>(&e))
            return extractBits(*i32);
        if (auto* u32 = std::get_if<uint32_t>(&e))
            return extractBits(*u32);
        RELEASE_ASSERT_NOT_REACHED();
    }, arguments[0]);
}

CONSTANT_FUNCTION(FaceForward)
{
    ASSERT(arguments.size() == 3);
    const auto& e1 = arguments[0];
    const auto& e2 = arguments[1];
    const auto& e3 = arguments[2];

    auto* elementType = std::get<Types::Vector>(*resultType).element;
    CALL(dot, Dot, elementType, { e2, e3 });
    CALL(lt, Lt, elementType, { dot, zeroValue(elementType) });
    if (lt.toBool())
        return e1;
    return constantMinus(resultType, { e1 });
}

UNARY_OPERATION(FirstLeadingBit, ConcreteInteger, [&](auto e) {
    if constexpr (std::is_same_v<decltype(e), int32_t>) {
        unsigned ue = e;
        if (!e || e == -1)
            return -1;
        unsigned count = e < 0 ? std::countl_one(ue) : std::countl_zero(ue);
        return static_cast<int32_t>(31 - count);
    } else {
        if (!e)
            return static_cast<uint32_t>(-1);
        return static_cast<uint32_t>(31 - std::countl_zero(e));
    }
})

UNARY_OPERATION(FirstTrailingBit, ConcreteInteger, [&](auto e) {
    if (!e)
        return static_cast<decltype(e)>(-1);
    unsigned ue = e;
    return static_cast<decltype(e)>(std::countr_zero(ue));
})

UNARY_OPERATION(Floor, Float, WRAP_STD(floor));

CONSTANT_FUNCTION(Fma)
{
    ASSERT(arguments.size() == 3);
    CALL(product, Multiply, resultType, { arguments[0], arguments[1] });
    return constantAdd(resultType, { product, arguments[2] });
}

CONSTANT_FUNCTION(Fract)
{
    ASSERT(arguments.size() == 1);
    const auto& arg = arguments[0];
    CALL(floor, Floor, resultType, { arg });
    return constantMinus(resultType, { arg, floor });
}

CONSTANT_FUNCTION(Frexp)
{
    UNUSED_PARAM(resultType);
    ASSERT(arguments.size() == 1);

    const auto& frexpValue = [&](auto value) -> std::tuple<ConstantValue, ConstantValue> {
        using T = decltype(value);
        using Exp = std::conditional_t<std::is_same_v<T, double>, int64_t, int>;
        int exp;
        auto fract = std::frexp(value, &exp);
        return { ConstantValue(static_cast<T>(fract)), ConstantValue(static_cast<Exp>(exp)) };
    };

    const auto& frexpScalar = [&](auto value) {
        if (auto* f32 = std::get_if<float>(&value))
            return frexpValue(*f32);
        if (auto* f16 = std::get_if<half>(&value))
            return frexpValue(*f16);
        if (auto* abstractFloat = std::get_if<double>(&value))
            return frexpValue(*abstractFloat);
        RELEASE_ASSERT_NOT_REACHED();
    };

    auto [fract, exp] = [&]() -> std::tuple<ConstantValue, ConstantValue> {
        auto& arg = arguments[0];

        if (!std::holds_alternative<ConstantVector>(arg))
            return frexpScalar(arg);

        auto& argVector = std::get<ConstantVector>(arg);
        auto size = argVector.elements.size();
        ConstantVector fractVector(size);
        ConstantVector expVector(size);
        for (unsigned i = 0; i < size; ++i) {
            auto [fract, exp] = frexpScalar(argVector.elements[i]);
            fractVector.elements[i] = fract;
            expVector.elements[i] = exp;
        }
        return { fractVector, expVector };
    }();

    return { ConstantStruct({ { { "fract"_s, fract }, { "exp"_s, exp } } }) };
}

CONSTANT_FUNCTION(InsertBits)
{
    UNUSED_PARAM(resultType);
    return scalarOrVector([&](auto eValue, auto newbitsValue, auto offset, auto count) -> ConstantValue {
        constexpr unsigned w = 32;
        unsigned o = std::min(std::get<uint32_t>(offset), w);
        unsigned c = std::min(std::get<uint32_t>(count), w - o);
        if (!c)
            return eValue;
        if (c == w)
            return newbitsValue;

        const auto& fn = [&](auto e, auto newbits) {
            auto from = newbits << o;
            auto mask = ((1 << c) - 1) << o;
            auto result = e;
            result &= ~mask;
            result |= (from & mask);
            return result;
        };

        if (auto* e = std::get_if<int32_t>(&eValue))
            return fn(*e, std::get<int32_t>(newbitsValue));
        return fn(std::get<uint32_t>(eValue), std::get<uint32_t>(newbitsValue));
    }, arguments[0], arguments[1], arguments[2], arguments[3]);
}

UNARY_OPERATION(InverseSqrt, Float, [&]<typename T>(T arg) -> T {
    return 1.0 / std::sqrt(arg);
})

CONSTANT_FUNCTION(Ldexp)
{
    UNUSED_PARAM(resultType);
    return scalarOrVector([&](const auto& e1, auto& e2) -> ConstantResult {
        if (auto* abstractE1 = std::get_if<double>(&e1)) {
            constexpr int64_t bias = 1023;
            int64_t e2Value;
            if (auto* abstractE2 = std::get_if<int64_t>(&e2))
                e2Value = *abstractE2;
            else
                e2Value = std::get<int32_t>(e2);
            if (e2Value + bias <= 0)
                return { static_cast<double>(0) };
            if (e2Value > bias + 1)
                return makeUnexpected(makeString("e2 must be less than or equal to "_s, bias + 1));
            return { std::ldexp(*abstractE1, static_cast<int>(e2Value)) };
        }

        auto i32E2 = std::get<int32_t>(e2);
        if (auto* f32E1 = std::get_if<float>(&e1)) {
            constexpr int32_t bias = 127;
            if (i32E2 + bias <= 0)
                return { static_cast<float>(0) };
            if (i32E2 > bias + 1)
                return makeUnexpected(makeString("e2 must be less than or equal to "_s, bias + 1));
            return { std::ldexp(*f32E1, i32E2) };
        }
        if (auto* f16E1 = std::get_if<half>(&e1)) {
            constexpr int32_t bias = 15;
            if (i32E2 + bias <= 0)
                return { static_cast<half>(0) };
            if (i32E2 > bias + 1)
                return makeUnexpected(makeString("e2 must be less than or equal to "_s, bias + 1));
            return { static_cast<half>(std::ldexp(*f16E1, i32E2)) };
        }
        RELEASE_ASSERT_NOT_REACHED();
    }, arguments[0], arguments[1]);
}

UNARY_OPERATION(Log, Float, WRAP_STD(log))
UNARY_OPERATION(Log2, Float, WRAP_STD(log2))
BINARY_OPERATION(Max, Number, WRAP_STD(max))
BINARY_OPERATION(Min, Number, WRAP_STD(min))
TERNARY_OPERATION(Mix, Number, [&]<typename T>(T e1, T e2, T e3) -> T { return  e1 * (1 - e3) + e2 * e3; })

CONSTANT_FUNCTION(Modf)
{
    UNUSED_PARAM(resultType);
    ASSERT(arguments.size() == 1);

    const auto& modfValue = [&](auto value) -> std::tuple<ConstantValue, ConstantValue> {
        using T = decltype(value);
        using Whole = std::conditional_t<std::is_same_v<T, half>, float, T>;
        Whole whole;
        T fract = std::modf(value, &whole);
        return { ConstantValue(fract), ConstantValue(static_cast<T>(whole)) };
    };

    const auto& modfScalar = [&](auto value) {
        if (auto* f32 = std::get_if<float>(&value))
            return modfValue(*f32);
        if (auto* f16 = std::get_if<half>(&value))
            return modfValue(*f16);
        if (auto* abstractFloat = std::get_if<double>(&value))
            return modfValue(*abstractFloat);
        RELEASE_ASSERT_NOT_REACHED();
    };

    auto [fract, whole] = [&]() -> std::tuple<ConstantValue, ConstantValue> {
        auto& arg = arguments[0];

        if (!std::holds_alternative<ConstantVector>(arg))
            return modfScalar(arg);

        auto& argVector = std::get<ConstantVector>(arg);
        auto size = argVector.elements.size();
        ConstantVector fractVector(size);
        ConstantVector wholeVector(size);
        for (unsigned i = 0; i < size; ++i) {
            auto [fract, whole] = modfScalar(argVector.elements[i]);
            fractVector.elements[i] = fract;
            wholeVector.elements[i] = whole;
        }
        return { fractVector, wholeVector };
    }();

    return { ConstantStruct({ { { "fract"_s, fract }, { "whole"_s, whole } } }) };
}

CONSTANT_FUNCTION(Normalize)
{
    ASSERT(arguments.size() == 1);
    auto* elementType = std::get<Types::Vector>(*resultType).element;
    const auto& arg = arguments[0];
    CALL(length, Length, elementType, arguments);
    return constantDivide(resultType, { arg, length });
}

BINARY_OPERATION(Pow, Float, [&]<typename T>(T base, T exp) -> ConstantResult {
    if (base < 0)
        return makeUnexpected(makeString("pow called with negative base ("_s, String::number(base), ")"_s));
    if (!base && exp <= 0)
        return makeUnexpected(makeString("pow called with base 0 and non-positive exponent ("_s, String::number(exp), ")"_s));
    auto result = std::pow(base, exp);
    if (!std::isfinite(result))
        return makeUnexpected("pow overflow"_s);
    return { { T(result) } };
});

UNARY_OPERATION(QuantizeToF16, F32, [&](float arg) -> ConstantResult {
    UNUSED_PARAM(resultType);
    auto converted = convertFloat<half>(arg);
    if (!converted)
        return makeUnexpected(makeString("value "_s, String::number(arg), " cannot be represented as 'f16'"_s));
    return { { static_cast<float>(*converted) } };
});

UNARY_OPERATION(Radians, Float, [&]<typename T>(T arg) -> T {
    return arg * (std::numbers::pi / static_cast<T>(180));
})

CONSTANT_FUNCTION(Reflect)
{
    ASSERT(arguments.size() == 2);
    const auto& e1 = arguments[0];
    const auto& e2 = arguments[1];
    auto* elementType = std::get<Types::Vector>(*resultType).element;
    auto& primitive = std::get<Types::Primitive>(*elementType);

    const auto& reflect = [&]<typename T>() -> ConstantResult {
        CALL(dot, Dot, elementType, { e2, e1 });
        CALL(doubleResult, Multiply, resultType, { static_cast<T>(2), dot });
        CALL(prod, Multiply, resultType, { doubleResult, e2 });
        return constantMinus(resultType, { e1, prod });
    };

    if (primitive.kind == Types::Primitive::F32)
        return reflect.operator()<float>();
    if (primitive.kind == Types::Primitive::F16)
        return reflect.operator()<half>();
    if (primitive.kind == Types::Primitive::AbstractFloat)
        return reflect.operator()<double>();
    RELEASE_ASSERT_NOT_REACHED();
}

CONSTANT_FUNCTION(Refract)
{
    ASSERT(arguments.size() == 3);
    const auto& e1 = arguments[0];
    const auto& e2 = arguments[1];
    const auto& e3 = arguments[2];

    const auto& refract = [&]<typename T>(T e3) -> ConstantResult {
        auto* elementType = std::get<Types::Vector>(*resultType).element;
        CALL(dot, Dot, elementType, { e2, e1 });
        CALL(dotSquared, Multiply, elementType, { dot, dot });
        CALL(sub, Minus, elementType, { static_cast<T>(1.0), dotSquared });
        CALL(e3Squared, Multiply, elementType, { e3, e3 });
        CALL(mul, Multiply, elementType, { e3Squared, sub });
        CALL(k, Minus, elementType, { static_cast<T>(1.0), mul });
        CALL(lt, Lt, elementType, { k, static_cast<T>(0.0) });

        if (lt.toBool())
            return zeroValue(resultType);

        {
            CALL(mul, Multiply, elementType, { e3, dot });
            CALL(sqrt, Sqrt, elementType, { k });
            CALL(sum, Add, elementType, { mul, sqrt });
            CALL(mul2, Multiply, resultType, { e3, e1 });
            CALL(mul3, Multiply, resultType, { sum, e2 });
            return constantMinus(resultType, { mul2, mul3 });
        }
    };

    if (auto* f32 = std::get_if<float>(&e3))
        return refract(*f32);
    if (auto* f16 = std::get_if<half>(&e3))
        return refract(*f16);
    if (auto* abstractFloat = std::get_if<double>(&e3))
        return refract(*abstractFloat);
    RELEASE_ASSERT_NOT_REACHED();
}

UNARY_OPERATION(ReverseBits, Integer, [&]<typename T>(T e) -> T {
    unsigned v = e;
    T result = 0;
    for (unsigned k = 0; k < 32; ++k)
        result |= !!(v & (1 << (31 - k))) << k;
    return result;
})

UNARY_OPERATION(Round, Float, WRAP_STD(rint))

UNARY_OPERATION(Saturate, Float, [&](auto e) {
    return std::min(std::max(e, static_cast<decltype(e)>(0)), static_cast<decltype(e)>(1));
})

UNARY_OPERATION(Sign, Number, [&]<typename T>(T e) -> T {
    T result;
    if (e > 0)
        result = 1;
    else if (e < 0)
        result = -1;
    else
        result = 0;
    return result;
})

TERNARY_OPERATION(Smoothstep, Float, [&]<typename T>(T low, T high, T x) -> ConstantResult {
    if (low == high)
        return makeUnexpected(makeString("smoothstep called with low ("_s, String::number(low), ") equal high ("_s, String::number(high), ")"_s));
    auto e = (x - low) / (high - low);
    auto t = std::min(std::max(e, static_cast<decltype(e)>(0)), static_cast<decltype(e)>(1));
    return { { t * t * (3.0 - 2.0 * t) } };
})

UNARY_OPERATION(Sqrt, Float, WRAP_STD(sqrt))
BINARY_OPERATION(Step, Float, [&](auto edge, auto x) { return edge <= x ? 1.0 : 0.0; })

CONSTANT_FUNCTION(Transpose)
{
    UNUSED_PARAM(resultType);
    ASSERT(arguments.size() == 1);
    auto& matrix = std::get<ConstantMatrix>(arguments[0]);
    auto columns = matrix.columns;
    auto rows = matrix.rows;
    ConstantMatrix result(rows, columns);
    for (unsigned j = 0; j < rows; ++j) {
        for (unsigned i = 0; i < columns; ++i)
            result.elements[j * columns + i] = matrix.elements[i * rows + j];
    }
    return { { result } };
}

UNARY_OPERATION(Trunc, Float, WRAP_STD(trunc))

// Data Packing
CONSTANT_FUNCTION(Pack4x8snorm)
{
    UNUSED_PARAM(resultType);
    auto& vector = std::get<ConstantVector>(arguments[0]);
    std::array<int8_t, 4> packed;
    for (unsigned i = 0; i < 4; ++i) {
        auto e = std::get<float>(vector.elements[i]);
        packed[i] = static_cast<int8_t>(std::floor(0.5 + 127 * std::min(1.f, std::max(-1.f, e))));
    }
    return { { std::bit_cast<uint32_t>(packed) } };
}

CONSTANT_FUNCTION(Pack4x8unorm)
{
    UNUSED_PARAM(resultType);
    auto& vector = std::get<ConstantVector>(arguments[0]);
    std::array<uint8_t, 4> packed;
    for (unsigned i = 0; i < 4; ++i) {
        auto e = std::get<float>(vector.elements[i]);
        packed[i] = static_cast<uint8_t>(std::floor(0.5 + 255 * std::min(1.f, std::max(0.f, e))));
    }
    return { { std::bit_cast<uint32_t>(packed) } };
}

CONSTANT_FUNCTION(Pack4xI8)
{
    UNUSED_PARAM(resultType);
    auto& vector = std::get<ConstantVector>(arguments[0]);
    std::array<uint8_t, 4> packed;
    for (unsigned i = 0; i < 4; ++i) {
        auto e = std::get<int32_t>(vector.elements[i]);
        packed[i] = static_cast<uint8_t>(e);
    }
    return { { std::bit_cast<uint32_t>(packed) } };
}

CONSTANT_FUNCTION(Pack4xU8)
{
    UNUSED_PARAM(resultType);
    auto& vector = std::get<ConstantVector>(arguments[0]);
    std::array<uint8_t, 4> packed;
    for (unsigned i = 0; i < 4; ++i) {
        auto e = std::get<uint32_t>(vector.elements[i]);
        packed[i] = static_cast<uint8_t>(e);
    }
    return { { std::bit_cast<uint32_t>(packed) } };
}

CONSTANT_FUNCTION(Pack4xI8Clamp)
{
    UNUSED_PARAM(resultType);
    auto& vector = std::get<ConstantVector>(arguments[0]);
    std::array<uint8_t, 4> packed;
    for (unsigned i = 0; i < 4; ++i) {
        auto e = std::get<int32_t>(vector.elements[i]);
        packed[i] = static_cast<uint8_t>(std::min(127, std::max(-128, e)));
    }
    return { { std::bit_cast<uint32_t>(packed) } };
}

CONSTANT_FUNCTION(Pack4xU8Clamp)
{
    UNUSED_PARAM(resultType);
    auto& vector = std::get<ConstantVector>(arguments[0]);
    std::array<uint8_t, 4> packed;
    for (unsigned i = 0; i < 4; ++i) {
        auto e = std::get<uint32_t>(vector.elements[i]);
        packed[i] = static_cast<uint8_t>(std::min(255u, e));
    }
    return { { std::bit_cast<uint32_t>(packed) } };
}

CONSTANT_FUNCTION(Pack2x16snorm)
{
    UNUSED_PARAM(resultType);
    auto& vector = std::get<ConstantVector>(arguments[0]);
    std::array<int16_t, 2> packed;
    for (unsigned i = 0; i < 2; ++i) {
        auto e = std::get<float>(vector.elements[i]);
        packed[i] = static_cast<int16_t>(std::floor(0.5 + 32767 * std::min(1.f, std::max(-1.f, e))));
    }
    return { { std::bit_cast<uint32_t>(packed) } };
}

CONSTANT_FUNCTION(Pack2x16unorm)
{
    UNUSED_PARAM(resultType);
    auto& vector = std::get<ConstantVector>(arguments[0]);
    std::array<uint16_t, 2> packed;
    for (unsigned i = 0; i < 2; ++i) {
        auto e = std::get<float>(vector.elements[i]);
        packed[i] = static_cast<uint16_t>(std::floor(0.5 + 65535 * std::min(1.f, std::max(0.f, e))));
    }
    return { { std::bit_cast<uint32_t>(packed) } };
}

CONSTANT_FUNCTION(Pack2x16float)
{
    UNUSED_PARAM(resultType);
    auto& vector = std::get<ConstantVector>(arguments[0]);
    std::array<half, 2> packed;
    for (unsigned i = 0; i < 2; ++i) {
        auto e = std::get<float>(vector.elements[i]);
        auto converted = convertFloat<half>(e);
        if (!converted)
            return makeUnexpected(makeString("value "_s, e, " cannot be represented as 'f16'"_s));
        packed[i] = *converted;
    }
    return { { std::bit_cast<uint32_t>(packed) } };
}

// Data Unpacking
CONSTANT_FUNCTION(Unpack4x8snorm)
{
    UNUSED_PARAM(resultType);
    auto argument = std::get<uint32_t>(arguments[0]);
    auto packed = std::bit_cast<std::array<int8_t, 4>>(argument);
    ConstantVector result(4);
    for (unsigned i = 0; i < 4; ++i) {
        auto e = static_cast<float>(packed[i]);
        result.elements[i] = std::max(e / 127.f, -1.f);
    }
    return { result };
}

CONSTANT_FUNCTION(Unpack4x8unorm)
{
    UNUSED_PARAM(resultType);
    auto argument = std::get<uint32_t>(arguments[0]);
    auto packed = std::bit_cast<std::array<uint8_t, 4>>(argument);
    ConstantVector result(4);
    for (unsigned i = 0; i < 4; ++i) {
        auto e = static_cast<float>(packed[i]);
        result.elements[i] = e / 255.f;
    }
    return { result };
}

CONSTANT_FUNCTION(Unpack4xI8)
{
    UNUSED_PARAM(resultType);
    auto argument = std::get<uint32_t>(arguments[0]);
    auto packed = std::bit_cast<std::array<int8_t, 4>>(argument);
    ConstantVector result(4);
    for (unsigned i = 0; i < 4; ++i)
        result.elements[i] = static_cast<int32_t>(packed[i]);
    return { result };
}

CONSTANT_FUNCTION(Unpack4xU8)
{
    UNUSED_PARAM(resultType);
    auto argument = std::get<uint32_t>(arguments[0]);
    auto packed = std::bit_cast<std::array<uint8_t, 4>>(argument);
    ConstantVector result(4);
    for (unsigned i = 0; i < 4; ++i)
        result.elements[i] = static_cast<uint32_t>(packed[i]);
    return { result };
}

CONSTANT_FUNCTION(Unpack2x16snorm)
{
    UNUSED_PARAM(resultType);
    auto argument = std::get<uint32_t>(arguments[0]);
    auto packed = std::bit_cast<std::array<int16_t, 2>>(argument);
    ConstantVector result(2);
    for (unsigned i = 0; i < 2; ++i) {
        auto e = static_cast<float>(packed[i]);
        result.elements[i] = std::max(e / 32767.f, -1.f);
    }
    return { result };
}

CONSTANT_FUNCTION(Unpack2x16unorm)
{
    UNUSED_PARAM(resultType);
    auto argument = std::get<uint32_t>(arguments[0]);
    auto packed = std::bit_cast<std::array<uint16_t, 2>>(argument);
    ConstantVector result(2);
    for (unsigned i = 0; i < 2; ++i) {
        auto e = static_cast<float>(packed[i]);
        result.elements[i] = e / 65535.f;
    }
    return { result };
}

CONSTANT_FUNCTION(Unpack2x16float)
{
    UNUSED_PARAM(resultType);
    auto argument = std::get<uint32_t>(arguments[0]);
    auto packed = std::bit_cast<std::array<half, 2>>(argument);
    ConstantVector result(2);
    for (unsigned i = 0; i < 2; ++i)
        result.elements[i] = static_cast<float>(packed[i]);
    return { result };
}

CONSTANT_FUNCTION(Bitcast)
{
    const auto& split = [&](ConstantVector& result, const ConstantValue& argument, unsigned offset) -> std::optional<String> {
        uint32_t value;
        if (auto* i32 = std::get_if<int32_t>(&argument))
            value = std::bit_cast<uint32_t>(*i32);
        else if (auto* u32 = std::get_if<uint32_t>(&argument))
            value = *u32;
        else if (auto* f32 = std::get_if<float>(&argument))
            value = std::bit_cast<uint32_t>(*f32);
        else if (auto* abstractInt = std::get_if<int64_t>(&argument)) {
            auto i32 = convertInteger<int32_t>(*abstractInt);
            if (!i32)
                return { makeString("value "_s, String::number(*abstractInt), " cannot be represented as 'i32'"_s) };
            value = std::bit_cast<uint32_t>(*i32);
        } else if (auto* abstractFloat = std::get_if<double>(&argument)) {
            auto f32 = convertFloat<float>(*abstractFloat);
            if (!f32)
                return { makeString("value "_s, String::number(*abstractFloat), " cannot be represented as 'f32'"_s) };
            value = std::bit_cast<uint32_t>(*f32);
        } else {
            RELEASE_ASSERT_NOT_REACHED();
            value = 0;
        }

        auto parts = std::bit_cast<std::array<half, 2>>(value);
        result.elements[offset] = parts[0];
        result.elements[offset + 1] = parts[1];
        return std::nullopt;
    };

    const auto& join = [&](const Type* type, const ConstantVector& vector, unsigned offset) -> ConstantValue {
        uint32_t value = 0;
        value |= std::bit_cast<uint16_t>(std::get<half>(vector.elements[offset]));
        value |= static_cast<uint32_t>(std::bit_cast<uint16_t>(std::get<half>(vector.elements[offset + 1]))) << 16;
        return convertValue<BitwiseCast>(type, value);
    };

    const auto& vectorVector = [&](const Types::Vector& dst, const ConstantVector& src) -> ConstantResult {
        if (dst.size == src.elements.size()) {
            return scalarOrVector([&](auto& value) {
                return constantBitcast(dst.element, { value });
            }, src);
        }

        ConstantVector result(dst.size);
        if (dst.size == 4) {
            if (auto error = split(result, src.elements[0], 0))
                return makeUnexpected(*error);
            if (auto error = split(result, src.elements[1], 2))
                return makeUnexpected(*error);
        } else {
            result.elements[0] = join(dst.element, src, 0);
            result.elements[1] = join(dst.element, src, 2);
        }
        return { result };
    };

    auto& argument = arguments[0];
    if (auto* dstVector = std::get_if<Types::Vector>(resultType)) {
        if (auto* srcVector = std::get_if<ConstantVector>(&argument))
            return vectorVector(*dstVector, *srcVector);

        RELEASE_ASSERT(dstVector->size == 2);
        ConstantVector result(2);
        split(result, argument, 0);
        return { result };
    }

    if (auto* srcVector = std::get_if<ConstantVector>(&argument))
        return { join(resultType, *srcVector, 0) };

    if (auto* abstractInt = std::get_if<int64_t>(&argument)) {
        auto& primitive = std::get<Types::Primitive>(*resultType);

        if (primitive.kind == Types::Primitive::U32) {
            auto result = convertInteger<uint32_t>(*abstractInt);
            if (!result.has_value())
                return makeUnexpected(makeString("value "_s, *abstractInt, " cannot be represented as 'u32'"_s));
            return { *result };
        }

        auto result = convertInteger<int32_t>(*abstractInt);
        if (!result.has_value())
            return makeUnexpected(makeString("value "_s, *abstractInt, " cannot be represented as 'i32'"_s));
        return { convertValue<BitwiseCast>(resultType, *result) };
    }

    if (auto* abstractFloat = std::get_if<double>(&argument)) {
        auto result = convertFloat<float>(*abstractFloat);
        if (!result.has_value())
            return makeUnexpected(makeString("value "_s, *abstractFloat, " cannot be represented as 'f32'"_s));
        return { convertValue<BitwiseCast>(resultType, *result) };
    }

    return { convertValue<BitwiseCast>(resultType, argument) };
}

// Type checker helpers

[[maybe_unused]] static bool containsZero(ConstantValue value, const Type* valueType)
{
    auto wrapped = [&]() -> Expected<bool, String> {
        auto zero = zeroValue(valueType);
        CALL(equal, Equal, nullptr, { value, zero });
        CALL(any, Any, nullptr, { equal });
        return any.toBool();
    }();

    if (!wrapped)
        return false;
    return *wrapped;
}

#undef CALL_
#undef CALL
#undef CALL_MOVE_
#undef CALL_MOVE
#undef CONSTANT_FUNCTION

#define VALIDATION_FUNCTION(name) \
    [[maybe_unused]] static std::optional<String>(validate ## name)(const FixedVector<std::optional<ConstantValue>>& arguments, const FixedVector<const Type*>& parameterTypes)

#define CALL_(__tmp, __variable, __fnName, ...) \
    auto __tmp = constant##__fnName(__VA_ARGS__); \
    if (!__tmp) \
        return { __tmp.error() }; \
    auto __variable = WTF::move(*__tmp)

#define CALL(__variable, __fnName, ...) \
    CALL_(WTF_LAZY_JOIN(tmp, __COUNTER__), __variable, __fnName, __VA_ARGS__)

VALIDATION_FUNCTION(Clamp)
{
    UNUSED_PARAM(parameterTypes);
    if (arguments[1] && arguments[2]) {
        CALL(gt, Gt, nullptr, { *arguments[1], *arguments[2] });
        CALL(any, Any, nullptr, { gt });
        if (any.toBool())
            return { makeString("clamp called with low ("_s, *arguments[1], ") greater than high ("_s, *arguments[2], ")"_s) };
    }

    return std::nullopt;
}

static bool containsInfinity(const ConstantValue& value)
{
    if (auto* f = std::get_if<float>(&value))
        return std::isinf(*f);
    if (auto* h = std::get_if<half>(&value))
        return std::isinf(static_cast<float>(*h));
    if (auto* d = std::get_if<double>(&value))
        return std::isinf(*d);
    if (auto* v = std::get_if<ConstantVector>(&value)) {
        for (auto& element : v->elements) {
            if (containsInfinity(element))
                return true;
        }
    }
    return false;
}

VALIDATION_FUNCTION(Add)
{
    UNUSED_PARAM(parameterTypes);
    if (arguments[0] && arguments[1] && !arguments[0]->isMatrix()) {
        auto result = constantBinaryOperation<Constraints::Number>({ *arguments[0], *arguments[1] }, [&]<typename T>(T left, T right) -> T {
            return left + right;
        });
        if (!result)
            return { result.error() };
        if (containsInfinity(*result))
            return { makeString("addition of ("_s, *arguments[0], ") and ("_s, *arguments[1], ") overflows"_s) };
    }
    return std::nullopt;
}

VALIDATION_FUNCTION(Minus)
{
    UNUSED_PARAM(parameterTypes);
    if (arguments.size() == 2 && arguments[0] && arguments[1] && !arguments[0]->isMatrix()) {
        auto result = constantBinaryOperation<Constraints::Number>({ *arguments[0], *arguments[1] }, [&]<typename T>(T left, T right) -> T {
            return left - right;
        });
        if (!result)
            return { result.error() };
        if (containsInfinity(*result))
            return { makeString("subtraction of ("_s, *arguments[0], ") and ("_s, *arguments[1], ") overflows"_s) };
    }
    return std::nullopt;
}

VALIDATION_FUNCTION(Multiply)
{
    UNUSED_PARAM(parameterTypes);
    if (arguments[0] && arguments[1] && !arguments[0]->isMatrix() && !arguments[1]->isMatrix()) {
        auto result = constantBinaryOperation<Constraints::Number>({ *arguments[0], *arguments[1] }, [&]<typename T>(T left, T right) -> T {
            return left * right;
        });
        if (!result)
            return { result.error() };
        if (containsInfinity(*result))
            return { makeString("multiplication of ("_s, *arguments[0], ") and ("_s, *arguments[1], ") overflows"_s) };
    }
    return std::nullopt;
}

VALIDATION_FUNCTION(Smoothstep)
{
    UNUSED_PARAM(parameterTypes);
    if (arguments[0] && arguments[1]) {
        CALL(equal, Equal, nullptr, { *arguments[0], *arguments[1] });
        CALL(any, Any, nullptr, { equal });
        if (any.toBool())
            return { makeString("smoothstep called with low ("_s, *arguments[0], ") equal high ("_s, *arguments[1], ")"_s) };
    }

    return std::nullopt;
}

VALIDATION_FUNCTION(Divide)
{
    UNUSED_PARAM(parameterTypes);
    if (arguments[0] && arguments[1]) {
        auto result = constantDivide(nullptr, { *arguments[0], *arguments[1] });
        if (!result)
            return { result.error() };
    } else if (arguments[1]) {
        // right / right only errors for integer zero, which is exactly
        // the case where division is invalid regardless of the dividend.
        auto result = constantDivide(nullptr, { *arguments[1], *arguments[1] });
        if (!result)
            return { result.error() };
    }

    return std::nullopt;
}

VALIDATION_FUNCTION(Modulo)
{
    UNUSED_PARAM(parameterTypes);
    if (arguments[0] && arguments[1]) {
        auto result = constantModulo(nullptr, { *arguments[0], *arguments[1] });
        if (!result)
            return { result.error() };
    } else if (arguments[1]) {
        auto result = constantModulo(nullptr, { *arguments[1], *arguments[1] });
        if (!result)
            return { result.error() };
    }

    return std::nullopt;
}

static int32_t ldexpBiasForType(const Type* type)
{
    if (auto* vectorType = std::get_if<Types::Vector>(type))
        type = vectorType->element;
    if (auto* primitive = std::get_if<Types::Primitive>(type)) {
        switch (primitive->kind) {
        case Types::Primitive::F16:
            return 15;
        case Types::Primitive::F32:
            return 127;
        case Types::Primitive::AbstractFloat:
        case Types::Primitive::AbstractInt:
            return 1023;
        default:
            break;
        }
    }
    RELEASE_ASSERT_NOT_REACHED();
}

VALIDATION_FUNCTION(Ldexp)
{
    if (!arguments[1])
        return std::nullopt;

    int32_t bias = ldexpBiasForType(parameterTypes[0]);
    int32_t maxExponent = bias + 1;

    auto checkScalar = [&](const ConstantValue& value) -> bool {
        if (auto* i32 = std::get_if<int32_t>(&value))
            return *i32 > maxExponent;
        if (auto* abstractInt = std::get_if<int64_t>(&value))
            return *abstractInt > maxExponent;
        return false;
    };

    auto& e2 = *arguments[1];
    if (auto* vec = std::get_if<ConstantVector>(&e2)) {
        for (auto& element : vec->elements) {
            if (checkScalar(element))
                return { makeString("e2 must be less than or equal to "_s, maxExponent) };
        }
        return std::nullopt;
    }
    if (checkScalar(e2))
        return { makeString("e2 must be less than or equal to "_s, maxExponent) };
    return std::nullopt;
}

static bool shiftAmountExceedsBitWidth(const std::optional<ConstantValue>& lhs, const std::optional<ConstantValue>& rhs)
{
    if (!rhs)
        return false;

    unsigned bitWidth = 32;
    if (lhs) {
        auto& lhsValue = *lhs;
        if (auto* vec = std::get_if<ConstantVector>(&lhsValue)) {
            if (std::get_if<int64_t>(&vec->elements[0]))
                bitWidth = 64;
        } else if (std::get_if<int64_t>(&lhsValue))
            bitWidth = 64;
    }

    auto checkScalarExceedsBitWidth = [&](const ConstantValue& value) -> bool {
        if (auto* u = std::get_if<uint32_t>(&value))
            return *u >= bitWidth;
        return false;
    };

    if (auto* vec = std::get_if<ConstantVector>(&*rhs)) {
        for (auto& element : vec->elements) {
            if (checkScalarExceedsBitWidth(element))
                return true;
        }
        return false;
    }
    return checkScalarExceedsBitWidth(*rhs);
}

VALIDATION_FUNCTION(BitwiseShiftLeft)
{
    UNUSED_PARAM(parameterTypes);
    if (shiftAmountExceedsBitWidth(arguments[0], arguments[1]))
        return { "shift left value must be less than the bit width of the shifted value, which is 32"_s };
    return std::nullopt;
}

VALIDATION_FUNCTION(BitwiseShiftRight)
{
    UNUSED_PARAM(parameterTypes);
    if (shiftAmountExceedsBitWidth(arguments[0], arguments[1]))
        return { "shift right value must be less than the bit width of the shifted value, which is 32"_s };
    return std::nullopt;
}

// https://www.w3.org/TR/WGSL/#subgroupShuffle-builtin
// For subgroupShuffle{,Up,Down,Xor}, if the id/delta/mask argument is a const-expression
// outside the range [0, 128) it is a shader-creation error. Non-const arguments are not
// checked here (an out-of-range override is a pipeline-creation error handled separately).
VALIDATION_FUNCTION(SubgroupShuffle)
{
    UNUSED_PARAM(parameterTypes);
    if (arguments.size() == 2 && arguments[1]) {
        auto id = arguments[1]->integerValue();
        if (id < 0 || id >= 128)
            return { makeString("the id argument of a subgroup shuffle must be in the range [0, 128), but was "_s, String::number(id)) };
    }
    return std::nullopt;
}

// https://www.w3.org/TR/WGSL/#subgroupBroadcast-builtin
// subgroupBroadcast requires its id argument to be a const-expression in the range [0, 128).
VALIDATION_FUNCTION(SubgroupBroadcast)
{
    UNUSED_PARAM(parameterTypes);
    if (arguments.size() != 2 || !arguments[1])
        return { "the id argument of subgroupBroadcast must be a const-expression"_s };
    auto id = arguments[1]->integerValue();
    if (id < 0 || id >= 128)
        return { makeString("the id argument of subgroupBroadcast must be in the range [0, 128), but was "_s, String::number(id)) };
    return std::nullopt;
}

// https://www.w3.org/TR/WGSL/#quadBroadcast-builtin
// quadBroadcast requires its id argument to be a const-expression in the range [0, 4).
VALIDATION_FUNCTION(QuadBroadcast)
{
    UNUSED_PARAM(parameterTypes);
    if (arguments.size() != 2 || !arguments[1])
        return { "the id argument of quadBroadcast must be a const-expression"_s };
    auto id = arguments[1]->integerValue();
    if (id < 0 || id >= 4)
        return { makeString("the id argument of quadBroadcast must be in the range [0, 4), but was "_s, String::number(id)) };
    return std::nullopt;
}

#undef VALIDATION_FUNCTION
#undef CALL_
#undef CALL

} // namespace WGSL
