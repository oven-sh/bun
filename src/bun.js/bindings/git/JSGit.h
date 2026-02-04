/*
 * Copyright (C) 2024 Oven-sh
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "root.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/VM.h>

#include "headers-handwritten.h"
#include "BunClientData.h"
#include <JavaScriptCore/CallFrame.h>

// Forward declarations for libgit2 types
typedef struct git_repository git_repository;
typedef struct git_commit git_commit;
typedef struct git_oid git_oid;

namespace WebCore {

// Forward declarations
class JSGitRepository;
class JSGitCommit;
class JSGitOid;

// JSGitRepository - Wraps git_repository*
class JSGitRepository final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSGitRepository* create(JSC::VM& vm, JSC::Structure* structure, git_repository* repo);
    static void destroy(JSC::JSCell* cell);

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return WebCore::subspaceForImpl<JSGitRepository, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSGitRepository.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSGitRepository = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSGitRepository.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSGitRepository = std::forward<decltype(space)>(space); });
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    git_repository* repository() const { return m_repo; }

private:
    JSGitRepository(JSC::VM& vm, JSC::Structure* structure, git_repository* repo)
        : Base(vm, structure)
        , m_repo(repo)
    {
    }

    void finishCreation(JSC::VM& vm);

    git_repository* m_repo { nullptr };
};

// JSGitCommit - Wraps git_commit*
class JSGitCommit final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSGitCommit* create(JSC::VM& vm, JSC::Structure* structure, git_commit* commit);
    static void destroy(JSC::JSCell* cell);

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return WebCore::subspaceForImpl<JSGitCommit, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSGitCommit.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSGitCommit = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSGitCommit.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSGitCommit = std::forward<decltype(space)>(space); });
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    git_commit* commit() const { return m_commit; }

private:
    JSGitCommit(JSC::VM& vm, JSC::Structure* structure, git_commit* commit)
        : Base(vm, structure)
        , m_commit(commit)
    {
    }

    void finishCreation(JSC::VM& vm);

    git_commit* m_commit { nullptr };
};

// Structure creation functions
JSC::Structure* createJSGitRepositoryStructure(JSC::JSGlobalObject* globalObject);
JSC::Structure* createJSGitCommitStructure(JSC::JSGlobalObject* globalObject);

// Module creation function (called from $cpp)
JSC::JSValue createJSGitModule(Zig::GlobalObject* globalObject);

} // namespace WebCore
