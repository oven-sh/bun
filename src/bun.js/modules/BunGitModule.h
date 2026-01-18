#pragma once

#include "root.h"
#include "_NativeModule.h"

namespace Zig {
using namespace WebCore;
using namespace JSC;

DEFINE_NATIVE_MODULE(BunGit)
{
    // Currently we export 4 classes: Repository, Commit, Branch, Signature
    INIT_NATIVE_MODULE(4);

    auto* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);

    // Main classes (implemented so far)
    put(JSC::Identifier::fromString(vm, "Repository"_s), zigGlobalObject->JSGitRepositoryConstructor());
    put(JSC::Identifier::fromString(vm, "Commit"_s), zigGlobalObject->JSGitCommitConstructor());
    put(JSC::Identifier::fromString(vm, "Branch"_s), zigGlobalObject->JSGitBranchConstructor());
    put(JSC::Identifier::fromString(vm, "Signature"_s), zigGlobalObject->JSGitSignatureConstructor());

    // TODO: Implement the remaining classes:
    // - Remote
    // - Diff
    // - StatusEntry
    // - Index
    // - Config
    // - Stash
    // - Worktree
    // - Blob
    // - GitError

    RETURN_NATIVE_MODULE();
}

} // namespace Zig
