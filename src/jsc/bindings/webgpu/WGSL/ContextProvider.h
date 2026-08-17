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

#include <wtf/HashMap.h>

namespace WGSL {

namespace AST {
class Identifier;
}

template<typename ContextValue>
class ContextProvider {
    class Context;
    friend class ContextScope;

protected:
    using ContextMap = HashMap<String, ContextValue>;

    class ContextScope {
    public:
        ContextScope(ContextProvider*);
        ~ContextScope();

    private:
        ContextProvider& m_provider;
        Context* m_previousContext;
    };

    ContextProvider();

    const ContextValue* introduceVariable(const String&, const ContextValue&);
    const ContextValue* readVariable(const String&) const;

private:
    class Context {
    public:
        Context(const Context *const parent);

        const ContextValue* lookup(const String&) const;
        const ContextValue* add(const String&, const ContextValue&);

    private:
        const Context* m_parent { nullptr };
        ContextMap m_map;
    };

    Context* m_context;
    Vector<std::unique_ptr<Context>> m_contexts;
    ContextScope m_globalScope;
};

} // namespace WGSL
