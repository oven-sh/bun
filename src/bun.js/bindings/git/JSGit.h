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
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/Structure.h>

#include "headers-handwritten.h"
#include "BunClientData.h"
#include <JavaScriptCore/CallFrame.h>

// Forward declarations for libgit2 types
struct git_repository;
struct git_commit;
struct git_reference;
struct git_remote;
struct git_config;
struct git_index;
struct git_diff;
struct git_status_list;
struct git_blob;
struct git_signature;
struct git_tree;
struct git_worktree;

namespace WebCore {

// Forward declarations
class JSGitRepository;
class JSGitCommit;
class JSGitBranch;
class JSGitRemote;
class JSGitConfig;
class JSGitIndex;
class JSGitDiff;
class JSGitBlob;
class JSGitSignature;
class JSGitWorktree;
class JSGitStash;
class JSGitStatusEntry;

// Initialize libgit2 (called once)
void initializeGitLibrary();

// Create the Git module constructor
JSC::JSValue createJSGitModule(Zig::GlobalObject* globalObject);

// ============================================================================
// JSGitRepository - Main repository class
// ============================================================================
class JSGitRepository final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSGitRepository* create(JSC::VM& vm, JSC::Structure* structure, git_repository* repo);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    git_repository* repository() const { return m_repository; }

    static void destroy(JSCell*);

private:
    JSGitRepository(JSC::VM& vm, JSC::Structure* structure, git_repository* repo);
    void finishCreation(JSC::VM&);

    git_repository* m_repository;
};

// ============================================================================
// JSGitCommit - Commit class
// ============================================================================
class JSGitCommit final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSGitCommit* create(JSC::VM& vm, JSC::Structure* structure, git_commit* commit, JSGitRepository* repo);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    git_commit* commit() const { return m_commit; }
    JSGitRepository* repo() const { return m_repo; }

    static void destroy(JSCell*);

private:
    JSGitCommit(JSC::VM& vm, JSC::Structure* structure, git_commit* commit, JSGitRepository* repo);
    void finishCreation(JSC::VM&);

    git_commit* m_commit;
    JSC::WriteBarrier<JSGitRepository> m_repo;
};

// ============================================================================
// JSGitBranch - Branch class
// ============================================================================
class JSGitBranch final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSGitBranch* create(JSC::VM& vm, JSC::Structure* structure, git_reference* ref, JSGitRepository* repo);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    git_reference* reference() const { return m_reference; }
    JSGitRepository* repo() const { return m_repo; }

    static void destroy(JSCell*);

private:
    JSGitBranch(JSC::VM& vm, JSC::Structure* structure, git_reference* ref, JSGitRepository* repo);
    void finishCreation(JSC::VM&);

    git_reference* m_reference;
    JSC::WriteBarrier<JSGitRepository> m_repo;
};

// ============================================================================
// JSGitRemote - Remote class
// ============================================================================
class JSGitRemote final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSGitRemote* create(JSC::VM& vm, JSC::Structure* structure, git_remote* remote, JSGitRepository* repo);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    git_remote* remote() const { return m_remote; }
    JSGitRepository* repo() const { return m_repo; }

    static void destroy(JSCell*);

private:
    JSGitRemote(JSC::VM& vm, JSC::Structure* structure, git_remote* remote, JSGitRepository* repo);
    void finishCreation(JSC::VM&);

    git_remote* m_remote;
    JSC::WriteBarrier<JSGitRepository> m_repo;
};

// ============================================================================
// JSGitConfig - Config class
// ============================================================================
class JSGitConfig final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSGitConfig* create(JSC::VM& vm, JSC::Structure* structure, git_config* config, JSGitRepository* repo);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    git_config* config() const { return m_config; }
    JSGitRepository* repo() const { return m_repo; }

    static void destroy(JSCell*);

private:
    JSGitConfig(JSC::VM& vm, JSC::Structure* structure, git_config* config, JSGitRepository* repo);
    void finishCreation(JSC::VM&);

    git_config* m_config;
    JSC::WriteBarrier<JSGitRepository> m_repo;
};

// ============================================================================
// JSGitIndex - Index class
// ============================================================================
class JSGitIndex final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSGitIndex* create(JSC::VM& vm, JSC::Structure* structure, git_index* index, JSGitRepository* repo);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    git_index* index() const { return m_index; }
    JSGitRepository* repo() const { return m_repo; }

    static void destroy(JSCell*);

private:
    JSGitIndex(JSC::VM& vm, JSC::Structure* structure, git_index* index, JSGitRepository* repo);
    void finishCreation(JSC::VM&);

    git_index* m_index;
    JSC::WriteBarrier<JSGitRepository> m_repo;
};

// ============================================================================
// JSGitDiff - Diff class
// ============================================================================
class JSGitDiff final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSGitDiff* create(JSC::VM& vm, JSC::Structure* structure, git_diff* diff, JSGitRepository* repo);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    git_diff* diff() const { return m_diff; }
    JSGitRepository* repo() const { return m_repo; }

    static void destroy(JSCell*);

private:
    JSGitDiff(JSC::VM& vm, JSC::Structure* structure, git_diff* diff, JSGitRepository* repo);
    void finishCreation(JSC::VM&);

    git_diff* m_diff;
    JSC::WriteBarrier<JSGitRepository> m_repo;
};

// ============================================================================
// JSGitBlob - Blob class
// ============================================================================
class JSGitBlob final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSGitBlob* create(JSC::VM& vm, JSC::Structure* structure, git_blob* blob, JSGitRepository* repo);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    git_blob* blob() const { return m_blob; }
    JSGitRepository* repo() const { return m_repo; }

    static void destroy(JSCell*);

private:
    JSGitBlob(JSC::VM& vm, JSC::Structure* structure, git_blob* blob, JSGitRepository* repo);
    void finishCreation(JSC::VM&);

    git_blob* m_blob;
    JSC::WriteBarrier<JSGitRepository> m_repo;
};

// ============================================================================
// JSGitWorktree - Worktree class
// ============================================================================
class JSGitWorktree final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSGitWorktree* create(JSC::VM& vm, JSC::Structure* structure, git_worktree* worktree, JSGitRepository* repo);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    git_worktree* worktree() const { return m_worktree; }
    JSGitRepository* repo() const { return m_repo; }

    static void destroy(JSCell*);

private:
    JSGitWorktree(JSC::VM& vm, JSC::Structure* structure, git_worktree* worktree, JSGitRepository* repo);
    void finishCreation(JSC::VM&);

    git_worktree* m_worktree;
    JSC::WriteBarrier<JSGitRepository> m_repo;
};

} // namespace WebCore
