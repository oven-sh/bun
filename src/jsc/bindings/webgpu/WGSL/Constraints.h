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

#include <wtf/OptionSet.h>

namespace WGSL {

struct Type;
class TypeStore;


using Constraint = uint8_t;

namespace Constraints {

constexpr Constraint None = 0;

constexpr Constraint Bool          = 1 << 0;
constexpr Constraint AbstractInt   = 1 << 1;
constexpr Constraint I32           = 1 << 2;
constexpr Constraint U32           = 1 << 3;
constexpr Constraint AbstractFloat = 1 << 4;
constexpr Constraint F32           = 1 << 5;
constexpr Constraint F16           = 1 << 6;

constexpr Constraint ConcreteFloat = F16 | F32;
constexpr Constraint Float = ConcreteFloat | AbstractFloat;

constexpr Constraint ConcreteInteger = I32 | U32;
constexpr Constraint Integer = ConcreteInteger | AbstractInt;
constexpr Constraint SignedInteger = I32 | AbstractInt;

constexpr Constraint Scalar = Bool | Integer | Float;
constexpr Constraint ConcreteScalar = Bool | ConcreteInteger | ConcreteFloat;

constexpr Constraint Concrete32BitNumber = ConcreteInteger | F32;

constexpr Constraint SignedNumber = Float | SignedInteger;
constexpr Constraint Number = Float | Integer;
constexpr Constraint ConcreteNumber = ConcreteInteger | ConcreteFloat;

}

bool satisfies(const Type*, Constraint);
const Type* satisfyOrPromote(const Type*, Constraint, const TypeStore&);
const Type* concretize(const Type*, TypeStore&);

} // namespace WGSL
