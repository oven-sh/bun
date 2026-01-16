#pragma once

#include "root.h"
#include "_NativeModule.h"

namespace Zig {
using namespace WebCore;
using namespace JSC;

// Forward declarations for the git classes
JSC::JSValue createGitRepositoryConstructor(JSC::JSGlobalObject* globalObject);
JSC::JSValue createGitCommitConstructor(JSC::JSGlobalObject* globalObject);
JSC::JSValue createGitBranchConstructor(JSC::JSGlobalObject* globalObject);
JSC::JSValue createGitRemoteConstructor(JSC::JSGlobalObject* globalObject);
JSC::JSValue createGitDiffConstructor(JSC::JSGlobalObject* globalObject);
JSC::JSValue createGitStatusEntryConstructor(JSC::JSGlobalObject* globalObject);
JSC::JSValue createGitIndexConstructor(JSC::JSGlobalObject* globalObject);
JSC::JSValue createGitConfigConstructor(JSC::JSGlobalObject* globalObject);
JSC::JSValue createGitStashConstructor(JSC::JSGlobalObject* globalObject);
JSC::JSValue createGitWorktreeConstructor(JSC::JSGlobalObject* globalObject);
JSC::JSValue createGitBlobConstructor(JSC::JSGlobalObject* globalObject);
JSC::JSValue createGitSignatureConstructor(JSC::JSGlobalObject* globalObject);
JSC::JSValue createGitErrorConstructor(JSC::JSGlobalObject* globalObject);

DEFINE_NATIVE_MODULE(BunGit)
{
    INIT_NATIVE_MODULE(13);

    auto* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);

    // Main classes
    put(JSC::Identifier::fromString(vm, "Repository"_s), zigGlobalObject->JSGitRepositoryConstructor());
    put(JSC::Identifier::fromString(vm, "Commit"_s), zigGlobalObject->JSGitCommitConstructor());
    put(JSC::Identifier::fromString(vm, "Branch"_s), zigGlobalObject->JSGitBranchConstructor());
    put(JSC::Identifier::fromString(vm, "Remote"_s), zigGlobalObject->JSGitRemoteConstructor());
    put(JSC::Identifier::fromString(vm, "Diff"_s), zigGlobalObject->JSGitDiffConstructor());
    put(JSC::Identifier::fromString(vm, "StatusEntry"_s), zigGlobalObject->JSGitStatusEntryConstructor());
    put(JSC::Identifier::fromString(vm, "Index"_s), zigGlobalObject->JSGitIndexConstructor());
    put(JSC::Identifier::fromString(vm, "Config"_s), zigGlobalObject->JSGitConfigConstructor());
    put(JSC::Identifier::fromString(vm, "Stash"_s), zigGlobalObject->JSGitStashConstructor());
    put(JSC::Identifier::fromString(vm, "Worktree"_s), zigGlobalObject->JSGitWorktreeConstructor());
    put(JSC::Identifier::fromString(vm, "Blob"_s), zigGlobalObject->JSGitBlobConstructor());
    put(JSC::Identifier::fromString(vm, "Signature"_s), zigGlobalObject->JSGitSignatureConstructor());
    put(JSC::Identifier::fromString(vm, "GitError"_s), zigGlobalObject->JSGitErrorConstructor());

    RETURN_NATIVE_MODULE();
}

} // namespace Zig
