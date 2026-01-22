#include "root.h"
#include "JSGit.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSCJSValueInlines.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "wtf/text/WTFString.h"
#include "helpers.h"
#include "JSDOMExceptionHandling.h"
#include "BunClientData.h"
#include <git2.h>

namespace Bun {
using namespace JSC;

// libgit2 initialization
static std::once_flag s_libgit2InitFlag;

void initializeLibgit2()
{
    std::call_once(s_libgit2InitFlag, []() {
        git_libgit2_init();
    });
}

void shutdownLibgit2()
{
    git_libgit2_shutdown();
}

// Helper to throw git errors
static void throwGitError(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, int errorCode)
{
    const git_error* err = git_error_last();
    WTF::String message;
    if (err && err->message) {
        message = WTF::String::fromUTF8(err->message);
    } else {
        message = makeString("Git error: "_s, errorCode);
    }
    throwException(globalObject, scope, createError(globalObject, message));
}

// ============================================================================
// JSGitRepository Implementation
// ============================================================================

const ClassInfo JSGitRepository::s_info = { "Repository"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitRepository) };

JSGitRepository::~JSGitRepository()
{
    if (m_repo) {
        git_repository_free(m_repo);
        m_repo = nullptr;
    }
}

void JSGitRepository::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
}

JSC::GCClient::IsoSubspace* JSGitRepository::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSGitRepository, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSGitRepository.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSGitRepository = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSGitRepository.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSGitRepository = std::forward<decltype(space)>(space); });
}

// ============================================================================
// JSGitRepository Prototype Methods and Getters
// ============================================================================

// Getter: path
JSC_DEFINE_CUSTOM_GETTER(jsGitRepositoryGetter_path, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitRepository*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwThisTypeError(*globalObject, scope, "Repository"_s, "path"_s);
        return {};
    }

    const char* path = git_repository_workdir(thisObject->repo());
    if (!path) {
        path = git_repository_path(thisObject->repo());
    }
    return JSValue::encode(jsString(vm, WTF::String::fromUTF8(path)));
}

// Getter: gitDir
JSC_DEFINE_CUSTOM_GETTER(jsGitRepositoryGetter_gitDir, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitRepository*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwThisTypeError(*globalObject, scope, "Repository"_s, "gitDir"_s);
        return {};
    }

    const char* path = git_repository_path(thisObject->repo());
    return JSValue::encode(jsString(vm, WTF::String::fromUTF8(path)));
}

// Getter: isBare
JSC_DEFINE_CUSTOM_GETTER(jsGitRepositoryGetter_isBare, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitRepository*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwThisTypeError(*globalObject, scope, "Repository"_s, "isBare"_s);
        return {};
    }

    return JSValue::encode(jsBoolean(git_repository_is_bare(thisObject->repo())));
}

// Getter: isClean
JSC_DEFINE_CUSTOM_GETTER(jsGitRepositoryGetter_isClean, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitRepository*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwThisTypeError(*globalObject, scope, "Repository"_s, "isClean"_s);
        return {};
    }

    git_status_options opts = GIT_STATUS_OPTIONS_INIT;
    opts.show = GIT_STATUS_SHOW_INDEX_AND_WORKDIR;
    opts.flags = GIT_STATUS_OPT_INCLUDE_UNTRACKED;

    git_status_list* statusList = nullptr;
    int error = git_status_list_new(&statusList, thisObject->repo(), &opts);
    if (error < 0) {
        throwGitError(globalObject, scope, error);
        return {};
    }

    size_t count = git_status_list_entrycount(statusList);
    git_status_list_free(statusList);

    return JSValue::encode(jsBoolean(count == 0));
}

// Getter: head (returns the HEAD commit)
JSC_DEFINE_CUSTOM_GETTER(jsGitRepositoryGetter_head, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    auto* thisObject = jsDynamicCast<JSGitRepository*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwThisTypeError(*lexicalGlobalObject, scope, "Repository"_s, "head"_s);
        return {};
    }

    git_reference* headRef = nullptr;
    int error = git_repository_head(&headRef, thisObject->repo());
    if (error < 0) {
        if (error == GIT_EUNBORNBRANCH || error == GIT_ENOTFOUND) {
            return JSValue::encode(jsNull());
        }
        throwGitError(lexicalGlobalObject, scope, error);
        return {};
    }

    const git_oid* oid = git_reference_target(headRef);
    git_commit* commit = nullptr;
    error = git_commit_lookup(&commit, thisObject->repo(), oid);
    git_reference_free(headRef);

    if (error < 0) {
        throwGitError(lexicalGlobalObject, scope, error);
        return {};
    }

    auto* structure = globalObject->JSGitCommitStructure();
    return JSValue::encode(JSGitCommit::create(vm, lexicalGlobalObject, structure, commit, thisObject));
}

// Getter: branch (returns the current branch or null if detached)
JSC_DEFINE_CUSTOM_GETTER(jsGitRepositoryGetter_branch, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    auto* thisObject = jsDynamicCast<JSGitRepository*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwThisTypeError(*lexicalGlobalObject, scope, "Repository"_s, "branch"_s);
        return {};
    }

    git_reference* headRef = nullptr;
    int error = git_repository_head(&headRef, thisObject->repo());
    if (error < 0) {
        if (error == GIT_EUNBORNBRANCH || error == GIT_ENOTFOUND) {
            return JSValue::encode(jsNull());
        }
        throwGitError(lexicalGlobalObject, scope, error);
        return {};
    }

    if (git_reference_is_branch(headRef)) {
        auto* structure = globalObject->JSGitBranchStructure();
        return JSValue::encode(JSGitBranch::create(vm, lexicalGlobalObject, structure, headRef, thisObject, false));
    }

    git_reference_free(headRef);
    return JSValue::encode(jsNull());
}

// Method: getCommit(ref: string) -> Commit | null
JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryProtoFunc_getCommit, (JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    auto* thisObject = jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwThisTypeError(*lexicalGlobalObject, scope, "Repository"_s, "getCommit"_s);
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "getCommit requires a ref argument"_s));
        return {};
    }

    auto refString = callFrame->argument(0).toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    git_object* obj = nullptr;
    int error = git_revparse_single(&obj, thisObject->repo(), refString.utf8().data());
    if (error < 0) {
        if (error == GIT_ENOTFOUND) {
            return JSValue::encode(jsNull());
        }
        throwGitError(lexicalGlobalObject, scope, error);
        return {};
    }

    git_commit* commit = nullptr;
    error = git_commit_lookup(&commit, thisObject->repo(), git_object_id(obj));
    git_object_free(obj);

    if (error < 0) {
        throwGitError(lexicalGlobalObject, scope, error);
        return {};
    }

    auto* structure = globalObject->JSGitCommitStructure();
    return JSValue::encode(JSGitCommit::create(vm, lexicalGlobalObject, structure, commit, thisObject));
}

// Method: status(options?) -> StatusEntry[]
JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryProtoFunc_status, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwThisTypeError(*globalObject, scope, "Repository"_s, "status"_s);
        return {};
    }

    git_status_options opts = GIT_STATUS_OPTIONS_INIT;
    opts.show = GIT_STATUS_SHOW_INDEX_AND_WORKDIR;
    opts.flags = GIT_STATUS_OPT_INCLUDE_UNTRACKED | GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS;

    // Parse options if provided
    if (callFrame->argumentCount() > 0 && !callFrame->argument(0).isUndefinedOrNull()) {
        JSObject* options = callFrame->argument(0).toObject(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        JSValue includeUntracked = options->get(globalObject, Identifier::fromString(vm, "includeUntracked"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!includeUntracked.isUndefined() && !includeUntracked.toBoolean(globalObject)) {
            opts.flags &= ~(GIT_STATUS_OPT_INCLUDE_UNTRACKED | GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS);
        }

        JSValue includeIgnored = options->get(globalObject, Identifier::fromString(vm, "includeIgnored"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!includeIgnored.isUndefined() && includeIgnored.toBoolean(globalObject)) {
            opts.flags |= GIT_STATUS_OPT_INCLUDE_IGNORED | GIT_STATUS_OPT_RECURSE_IGNORED_DIRS;
        }
    }

    git_status_list* statusList = nullptr;
    int error = git_status_list_new(&statusList, thisObject->repo(), &opts);
    if (error < 0) {
        throwGitError(globalObject, scope, error);
        return {};
    }

    size_t count = git_status_list_entrycount(statusList);
    JSArray* result = constructEmptyArray(globalObject, nullptr, count);
    RETURN_IF_EXCEPTION(scope, {});

    for (size_t i = 0; i < count; i++) {
        const git_status_entry* entry = git_status_byindex(statusList, i);
        JSObject* entryObj = constructEmptyObject(globalObject);

        const char* path = entry->head_to_index ? entry->head_to_index->new_file.path
                         : entry->index_to_workdir ? entry->index_to_workdir->new_file.path
                         : nullptr;
        if (path) {
            entryObj->putDirect(vm, Identifier::fromString(vm, "path"_s), jsString(vm, WTF::String::fromUTF8(path)));
        }

        // Index status
        WTF::String indexStatus = "unmodified"_s;
        if (entry->status & GIT_STATUS_INDEX_NEW) indexStatus = "added"_s;
        else if (entry->status & GIT_STATUS_INDEX_MODIFIED) indexStatus = "modified"_s;
        else if (entry->status & GIT_STATUS_INDEX_DELETED) indexStatus = "deleted"_s;
        else if (entry->status & GIT_STATUS_INDEX_RENAMED) indexStatus = "renamed"_s;
        else if (entry->status & GIT_STATUS_INDEX_TYPECHANGE) indexStatus = "typechange"_s;
        entryObj->putDirect(vm, Identifier::fromString(vm, "indexStatus"_s), jsString(vm, indexStatus));

        // Worktree status
        WTF::String wtStatus = "unmodified"_s;
        if (entry->status & GIT_STATUS_WT_NEW) wtStatus = "untracked"_s;
        else if (entry->status & GIT_STATUS_WT_MODIFIED) wtStatus = "modified"_s;
        else if (entry->status & GIT_STATUS_WT_DELETED) wtStatus = "deleted"_s;
        else if (entry->status & GIT_STATUS_WT_RENAMED) wtStatus = "renamed"_s;
        else if (entry->status & GIT_STATUS_WT_TYPECHANGE) wtStatus = "typechange"_s;
        else if (entry->status & GIT_STATUS_IGNORED) wtStatus = "ignored"_s;
        else if (entry->status & GIT_STATUS_CONFLICTED) wtStatus = "unmerged"_s;
        entryObj->putDirect(vm, Identifier::fromString(vm, "workTreeStatus"_s), jsString(vm, wtStatus));

        // Original path for renames
        const char* origPath = entry->head_to_index ? entry->head_to_index->old_file.path
                             : entry->index_to_workdir ? entry->index_to_workdir->old_file.path
                             : nullptr;
        if (origPath && path && strcmp(origPath, path) != 0) {
            entryObj->putDirect(vm, Identifier::fromString(vm, "origPath"_s), jsString(vm, WTF::String::fromUTF8(origPath)));
        } else {
            entryObj->putDirect(vm, Identifier::fromString(vm, "origPath"_s), jsNull());
        }

        result->putDirectIndex(globalObject, i, entryObj);
        RETURN_IF_EXCEPTION(scope, {});
    }

    git_status_list_free(statusList);
    return JSValue::encode(result);
}

// Method: add(paths: string | string[])
JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryProtoFunc_add, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwThisTypeError(*globalObject, scope, "Repository"_s, "add"_s);
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        throwException(globalObject, scope, createError(globalObject, "add requires a path argument"_s));
        return {};
    }

    git_index* index = nullptr;
    int error = git_repository_index(&index, thisObject->repo());
    if (error < 0) {
        throwGitError(globalObject, scope, error);
        return {};
    }

    JSValue pathsArg = callFrame->argument(0);
    if (pathsArg.isString()) {
        auto pathStr = pathsArg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        error = git_index_add_bypath(index, pathStr.utf8().data());
    } else if (isArray(globalObject, pathsArg)) {
        JSArray* paths = jsCast<JSArray*>(pathsArg);
        uint32_t length = paths->length();
        for (uint32_t i = 0; i < length; i++) {
            JSValue pathValue = paths->get(globalObject, i);
            RETURN_IF_EXCEPTION(scope, {});
            auto pathStr = pathValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            error = git_index_add_bypath(index, pathStr.utf8().data());
            if (error < 0) break;
        }
    } else {
        git_index_free(index);
        throwException(globalObject, scope, createTypeError(globalObject, "paths must be a string or array of strings"_s));
        return {};
    }

    if (error < 0) {
        git_index_free(index);
        throwGitError(globalObject, scope, error);
        return {};
    }

    error = git_index_write(index);
    git_index_free(index);

    if (error < 0) {
        throwGitError(globalObject, scope, error);
        return {};
    }

    return JSValue::encode(jsUndefined());
}

// Method: commit(message: string, options?) -> Commit
JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryProtoFunc_commit, (JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    auto* thisObject = jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwThisTypeError(*lexicalGlobalObject, scope, "Repository"_s, "commit"_s);
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "commit requires a message argument"_s));
        return {};
    }

    auto message = callFrame->argument(0).toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Get the index
    git_index* index = nullptr;
    int error = git_repository_index(&index, thisObject->repo());
    if (error < 0) {
        throwGitError(lexicalGlobalObject, scope, error);
        return {};
    }

    // Write the index as a tree
    git_oid treeId;
    error = git_index_write_tree(&treeId, index);
    git_index_free(index);
    if (error < 0) {
        throwGitError(lexicalGlobalObject, scope, error);
        return {};
    }

    // Lookup the tree
    git_tree* tree = nullptr;
    error = git_tree_lookup(&tree, thisObject->repo(), &treeId);
    if (error < 0) {
        throwGitError(lexicalGlobalObject, scope, error);
        return {};
    }

    // Get the default signature
    git_signature* sig = nullptr;
    error = git_signature_default(&sig, thisObject->repo());
    if (error < 0) {
        git_tree_free(tree);
        throwGitError(lexicalGlobalObject, scope, error);
        return {};
    }

    // Get the parent commit (HEAD)
    git_commit* parent = nullptr;
    git_reference* headRef = nullptr;
    error = git_repository_head(&headRef, thisObject->repo());
    if (error == 0) {
        const git_oid* parentId = git_reference_target(headRef);
        error = git_commit_lookup(&parent, thisObject->repo(), parentId);
        git_reference_free(headRef);
        if (error < 0) {
            git_signature_free(sig);
            git_tree_free(tree);
            throwGitError(lexicalGlobalObject, scope, error);
            return {};
        }
    } else if (error != GIT_EUNBORNBRANCH && error != GIT_ENOTFOUND) {
        git_signature_free(sig);
        git_tree_free(tree);
        throwGitError(lexicalGlobalObject, scope, error);
        return {};
    }

    // Create the commit
    git_oid commitId;
    const git_commit* parents[] = { parent };
    size_t parentCount = parent ? 1 : 0;

    error = git_commit_create(
        &commitId,
        thisObject->repo(),
        "HEAD",
        sig,
        sig,
        nullptr,
        message.utf8().data(),
        tree,
        parentCount,
        parents
    );

    git_signature_free(sig);
    git_tree_free(tree);
    if (parent) git_commit_free(parent);

    if (error < 0) {
        throwGitError(lexicalGlobalObject, scope, error);
        return {};
    }

    // Return the new commit
    git_commit* newCommit = nullptr;
    error = git_commit_lookup(&newCommit, thisObject->repo(), &commitId);
    if (error < 0) {
        throwGitError(lexicalGlobalObject, scope, error);
        return {};
    }

    auto* structure = globalObject->JSGitCommitStructure();
    return JSValue::encode(JSGitCommit::create(vm, lexicalGlobalObject, structure, newCommit, thisObject));
}

// ============================================================================
// JSGitRepository Prototype Table
// ============================================================================

static const HashTableValue JSGitRepositoryPrototypeTableValues[] = {
    { "path"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetter_path, 0 } },
    { "gitDir"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetter_gitDir, 0 } },
    { "isBare"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetter_isBare, 0 } },
    { "isClean"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetter_isClean, 0 } },
    { "head"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetter_head, 0 } },
    { "branch"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetter_branch, 0 } },
    { "getCommit"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryProtoFunc_getCommit, 1 } },
    { "status"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryProtoFunc_status, 0 } },
    { "add"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryProtoFunc_add, 1 } },
    { "commit"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryProtoFunc_commit, 1 } },
};

// ============================================================================
// JSGitRepositoryPrototype Implementation
// ============================================================================

const ClassInfo JSGitRepositoryPrototype::s_info = { "Repository"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitRepositoryPrototype) };

void JSGitRepositoryPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSGitRepository::info(), JSGitRepositoryPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// ============================================================================
// JSGitRepositoryConstructor Implementation
// ============================================================================

const ClassInfo JSGitRepositoryConstructor::s_info = { "Repository"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitRepositoryConstructor) };

// Static method: Repository.find(startPath?) -> Repository | null
JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryConstructorFunc_find, (JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    initializeLibgit2();

    WTF::String pathStr = "."_s;
    if (callFrame->argumentCount() > 0 && !callFrame->argument(0).isUndefinedOrNull()) {
        pathStr = callFrame->argument(0).toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    git_buf repoPath = GIT_BUF_INIT;
    int error = git_repository_discover(&repoPath, pathStr.utf8().data(), 0, nullptr);
    if (error < 0) {
        git_buf_dispose(&repoPath);
        return JSValue::encode(jsNull());
    }

    git_repository* repo = nullptr;
    error = git_repository_open(&repo, repoPath.ptr);
    git_buf_dispose(&repoPath);

    if (error < 0) {
        return JSValue::encode(jsNull());
    }

    auto* structure = globalObject->JSGitRepositoryStructure();
    return JSValue::encode(JSGitRepository::create(vm, lexicalGlobalObject, structure, repo));
}

// Static method: Repository.init(path, options?) -> Repository
JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryConstructorFunc_init, (JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    initializeLibgit2();

    if (callFrame->argumentCount() < 1) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "init requires a path argument"_s));
        return {};
    }

    auto pathStr = callFrame->argument(0).toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    bool isBare = false;
    if (callFrame->argumentCount() > 1 && !callFrame->argument(1).isUndefinedOrNull()) {
        JSObject* options = callFrame->argument(1).toObject(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});

        JSValue bareValue = options->get(lexicalGlobalObject, Identifier::fromString(vm, "bare"_s));
        RETURN_IF_EXCEPTION(scope, {});
        isBare = bareValue.toBoolean(lexicalGlobalObject);
    }

    git_repository* repo = nullptr;
    int error = git_repository_init(&repo, pathStr.utf8().data(), isBare ? 1 : 0);
    if (error < 0) {
        throwGitError(lexicalGlobalObject, scope, error);
        return {};
    }

    auto* structure = globalObject->JSGitRepositoryStructure();
    return JSValue::encode(JSGitRepository::create(vm, lexicalGlobalObject, structure, repo));
}

static const HashTableValue JSGitRepositoryConstructorTableValues[] = {
    { "find"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryConstructorFunc_find, 0 } },
    { "init"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryConstructorFunc_init, 1 } },
};

JSGitRepositoryConstructor* JSGitRepositoryConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSGitRepositoryPrototype* prototype)
{
    JSGitRepositoryConstructor* constructor = new (NotNull, allocateCell<JSGitRepositoryConstructor>(vm)) JSGitRepositoryConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

void JSGitRepositoryConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSGitRepositoryPrototype* prototype)
{
    Base::finishCreation(vm, 1, "Repository"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    reifyStaticProperties(vm, info(), JSGitRepositoryConstructorTableValues, *this);
}

// Constructor: new Repository(path?)
JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSGitRepositoryConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    initializeLibgit2();

    WTF::String pathStr = "."_s;
    if (callFrame->argumentCount() > 0 && !callFrame->argument(0).isUndefinedOrNull()) {
        pathStr = callFrame->argument(0).toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Discover the repository
    git_buf repoPath = GIT_BUF_INIT;
    int error = git_repository_discover(&repoPath, pathStr.utf8().data(), 0, nullptr);
    if (error < 0) {
        git_buf_dispose(&repoPath);
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Not a git repository"_s));
        return {};
    }

    git_repository* repo = nullptr;
    error = git_repository_open(&repo, repoPath.ptr);
    git_buf_dispose(&repoPath);

    if (error < 0) {
        throwGitError(lexicalGlobalObject, scope, error);
        return {};
    }

    auto* structure = globalObject->JSGitRepositoryStructure();
    return JSValue::encode(JSGitRepository::create(vm, lexicalGlobalObject, structure, repo));
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSGitRepositoryConstructor::call(JSGlobalObject* globalObject, CallFrame*)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwException(globalObject, scope, createTypeError(globalObject, "Repository constructor cannot be called as a function"_s));
    return {};
}

} // namespace Bun
