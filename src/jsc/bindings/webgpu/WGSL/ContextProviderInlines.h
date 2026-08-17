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

#include "ASTIdentifier.h"
#include "ContextProvider.h"

namespace WGSL {

template<typename Value>
ContextProvider<Value>::Context::Context(const Context *const parent)
    : m_parent(parent)
{
}

template<typename Value>
const Value* ContextProvider<Value>::Context::lookup(const String& name) const
{
    auto it = m_map.find(name);
    if (it != m_map.end())
        return &it->value;
    if (m_parent)
        return m_parent->lookup(name);
    return nullptr;
}

template<typename Value>
const Value* ContextProvider<Value>::Context::add(const String& name, const Value& value)
{
    auto result = m_map.add(name, value);
    if (!result.isNewEntry) [[unlikely]]
        return nullptr;
    return &result.iterator->value;
}

template<typename Value>
ContextProvider<Value>::ContextScope::ContextScope(ContextProvider<Value>* provider)
    : m_provider(*provider)
    , m_previousContext(provider->m_context)
{
    m_provider.m_contexts.append(std::unique_ptr<Context>(new Context { m_previousContext }));
    m_provider.m_context = m_provider.m_contexts.last().get();
}

template<typename Value>
ContextProvider<Value>::ContextScope::~ContextScope()
{
    m_provider.m_context = m_previousContext;
    m_provider.m_contexts.removeLast();
}

template<typename Value>
ContextProvider<Value>::ContextProvider()
    : m_context(nullptr)
    , m_contexts()
    , m_globalScope(this)
{
}

template<typename Value>
auto ContextProvider<Value>::introduceVariable(const String& name, const Value& value) -> const Value*
{
    return m_context->add(name, value);
}

template<typename Value>
auto ContextProvider<Value>::readVariable(const String& name) const -> const Value*
{
    return m_context->lookup(name);
}

} // namespace WGSL
