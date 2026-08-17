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

#include "ASTForward.h"
#include "WGSLEnums.h"
#include <wtf/HashMap.h>
#include <wtf/HashSet.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace WGSL {

class ShaderModule;
struct PipelineLayout;
struct PrepareResult;

class CallGraph {
    friend class CallGraphBuilder;

public:
    struct Global {
        struct Resource {
            unsigned group;
            unsigned binding;
        };

        std::optional<Resource> resource;
        AST::Variable* declaration;
    };

    struct Callee {
        AST::Function* target;
        Vector<std::tuple<AST::Function*, AST::CallExpression*>> callSites;
        HashSet<const Global*> usedGlobals { };
    };

    struct EntryPoint {
        AST::Function& function;
        ShaderStage stage;
        String originalName;
        HashSet<const Global*> usedGlobals { };
    };

    const Vector<EntryPoint>& entrypoints() const LIFETIME_BOUND { return m_entrypoints; }
    const Vector<Callee>& callees(AST::Function& function) const LIFETIME_BOUND { return m_calleeMap.find(&function)->value; }

    const Global* addGlobal(Global&& global) const
    {
        m_globals.append(std::unique_ptr<Global>(new Global(WTF::move(global))));
        return m_globals.last().get();
    }

private:
    CallGraph() { }

    mutable Vector<std::unique_ptr<Global>> m_globals;
    Vector<EntryPoint> m_entrypoints;
    HashMap<String, AST::Function*> m_functionsByName;
    HashMap<AST::Function*, Vector<Callee>> m_calleeMap;
};

void buildCallGraph(ShaderModule&);

} // namespace WGSL
