/*
 * Copyright (c) 2024 Apple Inc. All rights reserved.
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
#include "WGSLShaderModule.h"

#include "AST.h"
#include "ConstantFunctions.h"
#include "WGSL.h"
#include <wtf/TZoneMallocInlines.h>

namespace WGSL {

WTF_MAKE_TZONE_ALLOCATED_IMPL(ShaderModule);

Result<ConstantValue> ShaderModule::ensureOverrideValue(const AST::Expression& expression, const HashMap<String, ConstantValue>& overrideValues) const
{
    auto maybeValue = evaluate(*this, expression, overrideValues);
    if (!maybeValue)
        return makeUnexpected(Error("Failed to evaluate override value"_s, expression.span()));
    return { *maybeValue };
}

std::optional<Error> ShaderModule::validateOverrides(const PrepareResult& prepareResult, HashMap<String, ConstantValue>& overrideValues)
{
    for (auto* variable : m_overrides) {
        String name = variable->id().has_value() ? String::number(*variable->id()) : variable->originalName();
        auto userDefinedValue = overrideValues.find(name);
        if (userDefinedValue != overrideValues.end()) {
            auto value = userDefinedValue->value;
            overrideValues.remove(name);
            overrideValues.add(variable->name(), value);
            continue;
        }

        bool isUsed = false;
        for (const auto& [_, entryPoint] : prepareResult.entryPoints) {
            if (entryPoint.specializationConstants.contains(name)) {
                isUsed = true;
                break;
            }
        }

        if (!isUsed)
            continue;

        auto* initializer = variable->maybeInitializer();
        if (!initializer) {
            if (isUsed)
                return { Error(makeString("override "_s, variable->originalName(), " is used in shader but not provided"_s), variable->span()) };
            continue;
        }

        auto maybeValue = ensureOverrideValue(*initializer, overrideValues);
        if (!maybeValue)
            return maybeValue.error();

        overrideValues.add(variable->name(), *maybeValue);
    }

    for (const auto& validator : m_overrideValidations) {
        if (auto maybeError = validator(overrideValues))
            return maybeError;
    }

    return std::nullopt;
}

bool ShaderModule::containsOverride(const String& key) const
{
    for (auto* variable : m_overrides) {
        String name = variable->id().has_value() ? String::number(*variable->id()) : variable->originalName();
        if (name == key)
            return true;
    }
    return false;
}

void ShaderModule::initializeOverloads()
{
    // This file contains the overloads generated from `TypeDeclarations.rb`
    #include "TypeOverloads.h" // NOLINT
}

const OverloadedDeclaration* ShaderModule::lookupOverload(const String& name) const
{
    auto it = m_overloadedOperations.find(name);
    if (it == m_overloadedOperations.end())
        return nullptr;
    return &it->value;
}

} // namespace WGSL
