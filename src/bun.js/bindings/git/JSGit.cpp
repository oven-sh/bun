/*
 * Copyright (C) 2024 Oven-sh
 */

#include "root.h"

#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/Structure.h"
#include "JavaScriptCore/ThrowScope.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/JSType.h"

#include "JSGit.h"
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/HeapAnalyzer.h>
#include <JavaScriptCore/JSDestructibleObjectHeapCellType.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/ObjectPrototype.h>
#include "BunBuiltinNames.h"
#include "BunString.h"

#include <git2.h>
#include <mutex>

namespace WebCore {

// Lazy initialization of libgit2
static std::once_flag s_libgit2InitFlag;

static void ensureLibgit2Initialized()
{
    std::call_once(s_libgit2InitFlag, []() {
        git_libgit2_init();
    });
}

// Helper to create error from libgit2 error
static JSC::JSValue createGitError(JSC::JSGlobalObject* globalObject, const char* message)
{
    const git_error* err = git_error_last();
    WTF::String errorMessage;
    if (err && err->message) {
        errorMessage = WTF::String::fromUTF8(err->message);
    } else if (message) {
        errorMessage = WTF::String::fromUTF8(message);
    } else {
        errorMessage = "Unknown git error"_s;
    }
    return JSC::createError(globalObject, errorMessage);
}

// ============================================================================
// JSGitRepository Implementation
// ============================================================================

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryOpen, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    ensureLibgit2Initialized();

    if (callFrame->argumentCount() < 1) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Repository.open requires a path argument"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue pathValue = callFrame->argument(0);
    if (!pathValue.isString()) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Path must be a string"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    WTF::String pathString = pathValue.toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    WTF::CString pathCString = pathString.utf8();

    git_repository* repo = nullptr;
    int error = git_repository_open(&repo, pathCString.data());

    if (error < 0) {
        throwException(lexicalGlobalObject, scope, createGitError(lexicalGlobalObject, "Failed to open repository"));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    auto* globalObject = JSC::jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject);
    if (!globalObject) {
        git_repository_free(repo);
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Invalid global object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::Structure* structure = globalObject->JSGitRepositoryStructure();
    JSGitRepository* jsRepo = JSGitRepository::create(vm, structure, repo);

    return JSC::JSValue::encode(jsRepo);
}

JSC_DEFINE_CUSTOM_GETTER(jsGitRepositoryGetPath, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = JSC::jsDynamicCast<JSGitRepository*>(JSC::JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Repository object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_repository* repo = thisObject->repository();
    if (!repo) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Repository has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    const char* path = git_repository_path(repo);
    if (!path) {
        return JSC::JSValue::encode(JSC::jsNull());
    }

    return JSC::JSValue::encode(JSC::jsString(vm, WTF::String::fromUTF8(path)));
}

JSC_DEFINE_CUSTOM_GETTER(jsGitRepositoryGetWorkdir, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = JSC::jsDynamicCast<JSGitRepository*>(JSC::JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Repository object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_repository* repo = thisObject->repository();
    if (!repo) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Repository has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    const char* workdir = git_repository_workdir(repo);
    if (!workdir) {
        return JSC::JSValue::encode(JSC::jsNull());
    }

    return JSC::JSValue::encode(JSC::jsString(vm, WTF::String::fromUTF8(workdir)));
}

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryHead, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = JSC::jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Repository object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_repository* repo = thisObject->repository();
    if (!repo) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Repository has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_reference* headRef = nullptr;
    int error = git_repository_head(&headRef, repo);
    if (error < 0) {
        throwException(lexicalGlobalObject, scope, createGitError(lexicalGlobalObject, "Failed to get HEAD"));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    const git_oid* oid = git_reference_target(headRef);
    if (!oid) {
        git_reference_free(headRef);
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "HEAD is not a direct reference"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_commit* commit = nullptr;
    error = git_commit_lookup(&commit, repo, oid);
    git_reference_free(headRef);

    if (error < 0) {
        throwException(lexicalGlobalObject, scope, createGitError(lexicalGlobalObject, "Failed to lookup HEAD commit"));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    auto* globalObject = JSC::jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject);
    if (!globalObject) {
        git_commit_free(commit);
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Invalid global object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::Structure* structure = globalObject->JSGitCommitStructure();
    JSGitCommit* jsCommit = JSGitCommit::create(vm, structure, commit);

    return JSC::JSValue::encode(jsCommit);
}

JSC_DEFINE_CUSTOM_GETTER(jsGitRepositoryIsBare, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = JSC::jsDynamicCast<JSGitRepository*>(JSC::JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Repository object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_repository* repo = thisObject->repository();
    if (!repo) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Repository has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    return JSC::JSValue::encode(JSC::jsBoolean(git_repository_is_bare(repo)));
}

// ============================================================================
// getStatus - Get working directory status
// ============================================================================

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryGetStatus, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = JSC::jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Repository object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_repository* repo = thisObject->repository();
    if (!repo) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Repository has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    // Parse options
    git_status_options opts = GIT_STATUS_OPTIONS_INIT;
    opts.show = GIT_STATUS_SHOW_INDEX_AND_WORKDIR;
    opts.flags = GIT_STATUS_OPT_INCLUDE_UNTRACKED | GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS;

    if (callFrame->argumentCount() > 0) {
        JSC::JSValue optionsValue = callFrame->argument(0);
        if (optionsValue.isObject()) {
            JSC::JSObject* options = optionsValue.toObject(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});

            JSC::JSValue includeUntracked = options->get(lexicalGlobalObject, JSC::Identifier::fromString(vm, "includeUntracked"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (!includeUntracked.isUndefined() && !includeUntracked.toBoolean(lexicalGlobalObject)) {
                opts.flags &= ~GIT_STATUS_OPT_INCLUDE_UNTRACKED;
            }

            JSC::JSValue includeIgnored = options->get(lexicalGlobalObject, JSC::Identifier::fromString(vm, "includeIgnored"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (!includeIgnored.isUndefined() && includeIgnored.toBoolean(lexicalGlobalObject)) {
                opts.flags |= GIT_STATUS_OPT_INCLUDE_IGNORED;
            }

            JSC::JSValue recurseUntrackedDirs = options->get(lexicalGlobalObject, JSC::Identifier::fromString(vm, "recurseUntrackedDirs"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (!recurseUntrackedDirs.isUndefined() && !recurseUntrackedDirs.toBoolean(lexicalGlobalObject)) {
                opts.flags &= ~GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS;
            }

            JSC::JSValue detectRenames = options->get(lexicalGlobalObject, JSC::Identifier::fromString(vm, "detectRenames"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (!detectRenames.isUndefined() && detectRenames.toBoolean(lexicalGlobalObject)) {
                opts.flags |= GIT_STATUS_OPT_RENAMES_HEAD_TO_INDEX | GIT_STATUS_OPT_RENAMES_INDEX_TO_WORKDIR;
            }
        }
    }

    git_status_list* statusList = nullptr;
    int error = git_status_list_new(&statusList, repo, &opts);
    if (error < 0) {
        throwException(lexicalGlobalObject, scope, createGitError(lexicalGlobalObject, "Failed to get status"));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    size_t count = git_status_list_entrycount(statusList);
    JSC::JSArray* result = JSC::constructEmptyArray(lexicalGlobalObject, nullptr, count);
    if (scope.exception()) [[unlikely]] {
        git_status_list_free(statusList);
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    for (size_t i = 0; i < count; i++) {
        const git_status_entry* entry = git_status_byindex(statusList, i);
        if (!entry)
            continue;

        JSC::JSObject* entryObj = JSC::constructEmptyObject(lexicalGlobalObject);

        // Get the path (from either index or workdir)
        const char* path = nullptr;
        if (entry->head_to_index && entry->head_to_index->new_file.path) {
            path = entry->head_to_index->new_file.path;
        } else if (entry->index_to_workdir && entry->index_to_workdir->new_file.path) {
            path = entry->index_to_workdir->new_file.path;
        } else if (entry->head_to_index && entry->head_to_index->old_file.path) {
            path = entry->head_to_index->old_file.path;
        } else if (entry->index_to_workdir && entry->index_to_workdir->old_file.path) {
            path = entry->index_to_workdir->old_file.path;
        }

        if (path) {
            entryObj->putDirect(vm, JSC::Identifier::fromString(vm, "path"_s),
                JSC::jsString(vm, WTF::String::fromUTF8(path)));
        } else {
            entryObj->putDirect(vm, JSC::Identifier::fromString(vm, "path"_s), JSC::jsEmptyString(vm));
        }

        entryObj->putDirect(vm, JSC::Identifier::fromString(vm, "status"_s),
            JSC::jsNumber(static_cast<int>(entry->status)));

        result->putDirectIndex(lexicalGlobalObject, i, entryObj);
        if (scope.exception()) [[unlikely]] {
            git_status_list_free(statusList);
            return JSC::JSValue::encode(JSC::jsUndefined());
        }
    }

    git_status_list_free(statusList);
    return JSC::JSValue::encode(result);
}

// ============================================================================
// revParse - Resolve a revision spec to an OID
// ============================================================================

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryRevParse, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = JSC::jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Repository object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_repository* repo = thisObject->repository();
    if (!repo) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Repository has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    if (callFrame->argumentCount() < 1) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "revParse requires a spec argument"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue specValue = callFrame->argument(0);
    if (!specValue.isString()) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Spec must be a string"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    WTF::String specString = specValue.toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});
    WTF::CString specCString = specString.utf8();

    git_object* obj = nullptr;
    int error = git_revparse_single(&obj, repo, specCString.data());
    if (error < 0) {
        throwException(lexicalGlobalObject, scope, createGitError(lexicalGlobalObject, "Failed to parse revision spec"));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    const git_oid* oid = git_object_id(obj);
    char oidStr[GIT_OID_SHA1_HEXSIZE + 1];
    git_oid_tostr(oidStr, sizeof(oidStr), oid);

    git_object_free(obj);
    return JSC::JSValue::encode(JSC::jsString(vm, WTF::String::fromUTF8(oidStr)));
}

// ============================================================================
// getCurrentBranch - Get the name of the current branch
// ============================================================================

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryGetCurrentBranch, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = JSC::jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Repository object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_repository* repo = thisObject->repository();
    if (!repo) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Repository has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_reference* headRef = nullptr;
    int error = git_repository_head(&headRef, repo);

    // GIT_EUNBORNBRANCH means HEAD points to a branch that doesn't exist yet
    if (error == GIT_EUNBORNBRANCH || error == GIT_ENOTFOUND) {
        return JSC::JSValue::encode(JSC::jsNull());
    }

    if (error < 0) {
        throwException(lexicalGlobalObject, scope, createGitError(lexicalGlobalObject, "Failed to get HEAD"));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    // Check if HEAD is detached
    if (git_repository_head_detached(repo)) {
        git_reference_free(headRef);
        return JSC::JSValue::encode(JSC::jsNull());
    }

    // Get the branch name (strip refs/heads/ prefix)
    const char* branchName = git_reference_shorthand(headRef);
    JSC::JSValue result = JSC::jsString(vm, WTF::String::fromUTF8(branchName));

    git_reference_free(headRef);
    return JSC::JSValue::encode(result);
}

// ============================================================================
// aheadBehind - Get ahead/behind counts between two commits
// ============================================================================

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryAheadBehind, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = JSC::jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Repository object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_repository* repo = thisObject->repository();
    if (!repo) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Repository has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    // Default to HEAD and @{u} (upstream)
    WTF::CString localSpec = WTF::String("HEAD"_s).utf8();
    WTF::CString upstreamSpec;

    // Parse arguments
    if (callFrame->argumentCount() > 0 && !callFrame->argument(0).isUndefinedOrNull()) {
        JSC::JSValue localValue = callFrame->argument(0);
        if (!localValue.isString()) {
            throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Local must be a string"_s));
            return JSC::JSValue::encode(JSC::jsUndefined());
        }
        WTF::String localString = localValue.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
        localSpec = localString.utf8();
    }

    if (callFrame->argumentCount() > 1 && !callFrame->argument(1).isUndefinedOrNull()) {
        JSC::JSValue upstreamValue = callFrame->argument(1);
        if (!upstreamValue.isString()) {
            throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Upstream must be a string"_s));
            return JSC::JSValue::encode(JSC::jsUndefined());
        }
        WTF::String upstreamString = upstreamValue.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
        upstreamSpec = upstreamString.utf8();
    }

    // Get the local OID
    git_object* localObj = nullptr;
    int error = git_revparse_single(&localObj, repo, localSpec.data());
    if (error < 0) {
        throwException(lexicalGlobalObject, scope, createGitError(lexicalGlobalObject, "Failed to resolve local ref"));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }
    git_oid localOid = *git_object_id(localObj);
    git_object_free(localObj);

    // Get the upstream OID
    git_oid upstreamOid;
    if (upstreamSpec.length() == 0) {
        // Try to get upstream from @{u}
        git_object* upstreamObj = nullptr;
        error = git_revparse_single(&upstreamObj, repo, "@{u}");
        if (error < 0) {
            // No upstream configured, return 0 for both
            JSC::JSObject* result = JSC::constructEmptyObject(lexicalGlobalObject);
            result->putDirect(vm, JSC::Identifier::fromString(vm, "ahead"_s), JSC::jsNumber(0));
            result->putDirect(vm, JSC::Identifier::fromString(vm, "behind"_s), JSC::jsNumber(0));
            return JSC::JSValue::encode(result);
        }
        upstreamOid = *git_object_id(upstreamObj);
        git_object_free(upstreamObj);
    } else {
        git_object* upstreamObj = nullptr;
        error = git_revparse_single(&upstreamObj, repo, upstreamSpec.data());
        if (error < 0) {
            throwException(lexicalGlobalObject, scope, createGitError(lexicalGlobalObject, "Failed to resolve upstream ref"));
            return JSC::JSValue::encode(JSC::jsUndefined());
        }
        upstreamOid = *git_object_id(upstreamObj);
        git_object_free(upstreamObj);
    }

    size_t ahead = 0, behind = 0;
    error = git_graph_ahead_behind(&ahead, &behind, repo, &localOid, &upstreamOid);
    if (error < 0) {
        throwException(lexicalGlobalObject, scope, createGitError(lexicalGlobalObject, "Failed to compute ahead/behind"));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSObject* result = JSC::constructEmptyObject(lexicalGlobalObject);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "ahead"_s), JSC::jsNumber(static_cast<double>(ahead)));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "behind"_s), JSC::jsNumber(static_cast<double>(behind)));

    return JSC::JSValue::encode(result);
}

// ============================================================================
// listFiles - Get list of files in the index
// ============================================================================

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryListFiles, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = JSC::jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Repository object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_repository* repo = thisObject->repository();
    if (!repo) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Repository has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_index* index = nullptr;
    int error = git_repository_index(&index, repo);
    if (error < 0) {
        throwException(lexicalGlobalObject, scope, createGitError(lexicalGlobalObject, "Failed to get repository index"));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    size_t count = git_index_entrycount(index);
    JSC::JSArray* result = JSC::constructEmptyArray(lexicalGlobalObject, nullptr, count);
    if (scope.exception()) [[unlikely]] {
        git_index_free(index);
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    for (size_t i = 0; i < count; i++) {
        const git_index_entry* entry = git_index_get_byindex(index, i);
        if (!entry)
            continue;

        JSC::JSObject* entryObj = JSC::constructEmptyObject(lexicalGlobalObject);

        entryObj->putDirect(vm, JSC::Identifier::fromString(vm, "path"_s),
            JSC::jsString(vm, WTF::String::fromUTF8(entry->path)));

        entryObj->putDirect(vm, JSC::Identifier::fromString(vm, "mode"_s),
            JSC::jsNumber(static_cast<int>(entry->mode)));

        char oidStr[GIT_OID_SHA1_HEXSIZE + 1];
        git_oid_tostr(oidStr, sizeof(oidStr), &entry->id);
        entryObj->putDirect(vm, JSC::Identifier::fromString(vm, "oid"_s),
            JSC::jsString(vm, WTF::String::fromUTF8(oidStr)));

        entryObj->putDirect(vm, JSC::Identifier::fromString(vm, "stage"_s),
            JSC::jsNumber(GIT_INDEX_ENTRY_STAGE(entry)));

        entryObj->putDirect(vm, JSC::Identifier::fromString(vm, "size"_s),
            JSC::jsNumber(static_cast<double>(entry->file_size)));

        result->putDirectIndex(lexicalGlobalObject, i, entryObj);
        if (scope.exception()) [[unlikely]] {
            git_index_free(index);
            return JSC::JSValue::encode(JSC::jsUndefined());
        }
    }

    git_index_free(index);
    return JSC::JSValue::encode(result);
}

// ============================================================================
// diff - Get diff information
// ============================================================================

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryDiff, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = JSC::jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Repository object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_repository* repo = thisObject->repository();
    if (!repo) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Repository has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    bool cached = false;

    // Parse options
    if (callFrame->argumentCount() > 0) {
        JSC::JSValue optionsValue = callFrame->argument(0);
        if (optionsValue.isObject()) {
            JSC::JSObject* options = optionsValue.toObject(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});

            JSC::JSValue cachedValue = options->get(lexicalGlobalObject, JSC::Identifier::fromString(vm, "cached"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (!cachedValue.isUndefined()) {
                cached = cachedValue.toBoolean(lexicalGlobalObject);
            }
        }
    }

    // Get HEAD tree
    git_reference* headRef = nullptr;
    git_commit* headCommit = nullptr;
    git_tree* headTree = nullptr;

    int error = git_repository_head(&headRef, repo);
    if (error == 0) {
        const git_oid* oid = git_reference_target(headRef);
        if (oid) {
            error = git_commit_lookup(&headCommit, repo, oid);
            if (error == 0) {
                error = git_commit_tree(&headTree, headCommit);
            }
        }
        git_reference_free(headRef);
    }

    git_diff* diff = nullptr;
    git_diff_options diffOpts = GIT_DIFF_OPTIONS_INIT;

    if (cached) {
        // HEAD vs index
        error = git_diff_tree_to_index(&diff, repo, headTree, nullptr, &diffOpts);
    } else {
        // HEAD vs workdir (with index)
        error = git_diff_tree_to_workdir_with_index(&diff, repo, headTree, &diffOpts);
    }

    if (headTree)
        git_tree_free(headTree);
    if (headCommit)
        git_commit_free(headCommit);

    if (error < 0) {
        throwException(lexicalGlobalObject, scope, createGitError(lexicalGlobalObject, "Failed to create diff"));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    // Get stats
    git_diff_stats* stats = nullptr;
    error = git_diff_get_stats(&stats, diff);
    if (error < 0) {
        git_diff_free(diff);
        throwException(lexicalGlobalObject, scope, createGitError(lexicalGlobalObject, "Failed to get diff stats"));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    size_t filesChanged = git_diff_stats_files_changed(stats);
    size_t insertions = git_diff_stats_insertions(stats);
    size_t deletions = git_diff_stats_deletions(stats);
    git_diff_stats_free(stats);

    // Get file list
    size_t numDeltas = git_diff_num_deltas(diff);
    JSC::JSArray* files = JSC::constructEmptyArray(lexicalGlobalObject, nullptr, numDeltas);
    if (scope.exception()) [[unlikely]] {
        git_diff_free(diff);
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    for (size_t i = 0; i < numDeltas; i++) {
        const git_diff_delta* delta = git_diff_get_delta(diff, i);
        if (!delta)
            continue;

        JSC::JSObject* fileObj = JSC::constructEmptyObject(lexicalGlobalObject);

        fileObj->putDirect(vm, JSC::Identifier::fromString(vm, "status"_s),
            JSC::jsNumber(static_cast<int>(delta->status)));

        if (delta->old_file.path) {
            fileObj->putDirect(vm, JSC::Identifier::fromString(vm, "oldPath"_s),
                JSC::jsString(vm, WTF::String::fromUTF8(delta->old_file.path)));
        } else {
            fileObj->putDirect(vm, JSC::Identifier::fromString(vm, "oldPath"_s), JSC::jsNull());
        }

        if (delta->new_file.path) {
            fileObj->putDirect(vm, JSC::Identifier::fromString(vm, "newPath"_s),
                JSC::jsString(vm, WTF::String::fromUTF8(delta->new_file.path)));
        } else {
            fileObj->putDirect(vm, JSC::Identifier::fromString(vm, "newPath"_s), JSC::jsNull());
        }

        if (delta->similarity > 0) {
            fileObj->putDirect(vm, JSC::Identifier::fromString(vm, "similarity"_s),
                JSC::jsNumber(static_cast<int>(delta->similarity)));
        }

        files->putDirectIndex(lexicalGlobalObject, i, fileObj);
        if (scope.exception()) [[unlikely]] {
            git_diff_free(diff);
            return JSC::JSValue::encode(JSC::jsUndefined());
        }
    }

    git_diff_free(diff);

    // Build result object
    JSC::JSObject* result = JSC::constructEmptyObject(lexicalGlobalObject);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "files"_s), files);

    JSC::JSObject* statsObj = JSC::constructEmptyObject(lexicalGlobalObject);
    statsObj->putDirect(vm, JSC::Identifier::fromString(vm, "filesChanged"_s),
        JSC::jsNumber(static_cast<double>(filesChanged)));
    statsObj->putDirect(vm, JSC::Identifier::fromString(vm, "insertions"_s),
        JSC::jsNumber(static_cast<double>(insertions)));
    statsObj->putDirect(vm, JSC::Identifier::fromString(vm, "deletions"_s),
        JSC::jsNumber(static_cast<double>(deletions)));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "stats"_s), statsObj);

    return JSC::JSValue::encode(result);
}

// ============================================================================
// countCommits - Count commits in a range
// ============================================================================

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryCountCommits, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = JSC::jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Repository object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_repository* repo = thisObject->repository();
    if (!repo) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Repository has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_revwalk* walk = nullptr;
    int error = git_revwalk_new(&walk, repo);
    if (error < 0) {
        throwException(lexicalGlobalObject, scope, createGitError(lexicalGlobalObject, "Failed to create revwalk"));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    // Parse range argument
    if (callFrame->argumentCount() > 0 && !callFrame->argument(0).isUndefinedOrNull()) {
        JSC::JSValue rangeValue = callFrame->argument(0);
        if (!rangeValue.isString()) {
            git_revwalk_free(walk);
            throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Range must be a string"_s));
            return JSC::JSValue::encode(JSC::jsUndefined());
        }

        WTF::String rangeString = rangeValue.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
        WTF::CString rangeCString = rangeString.utf8();

        error = git_revwalk_push_range(walk, rangeCString.data());
        if (error < 0) {
            git_revwalk_free(walk);
            throwException(lexicalGlobalObject, scope, createGitError(lexicalGlobalObject, "Failed to set range"));
            return JSC::JSValue::encode(JSC::jsUndefined());
        }
    } else {
        // Default to HEAD
        error = git_revwalk_push_head(walk);
        if (error < 0) {
            git_revwalk_free(walk);
            throwException(lexicalGlobalObject, scope, createGitError(lexicalGlobalObject, "Failed to push HEAD"));
            return JSC::JSValue::encode(JSC::jsUndefined());
        }
    }

    git_revwalk_sorting(walk, GIT_SORT_TIME);

    git_oid oid;
    size_t count = 0;
    while (git_revwalk_next(&oid, walk) == 0) {
        count++;
    }

    git_revwalk_free(walk);
    return JSC::JSValue::encode(JSC::jsNumber(static_cast<double>(count)));
}

// ============================================================================
// log - Get commit history
// ============================================================================

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryLog, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = JSC::jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Repository object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_repository* repo = thisObject->repository();
    if (!repo) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Repository has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    // Parse options
    WTF::CString fromSpec = WTF::String("HEAD"_s).utf8();
    WTF::CString rangeSpec;
    int limit = -1; // -1 means no limit

    if (callFrame->argumentCount() > 0) {
        JSC::JSValue optionsValue = callFrame->argument(0);
        if (optionsValue.isObject()) {
            JSC::JSObject* options = optionsValue.toObject(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});

            JSC::JSValue fromValue = options->get(lexicalGlobalObject, JSC::Identifier::fromString(vm, "from"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (!fromValue.isUndefined() && fromValue.isString()) {
                WTF::String fromString = fromValue.toWTFString(lexicalGlobalObject);
                RETURN_IF_EXCEPTION(scope, {});
                fromSpec = fromString.utf8();
            }

            JSC::JSValue rangeValue = options->get(lexicalGlobalObject, JSC::Identifier::fromString(vm, "range"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (!rangeValue.isUndefined() && rangeValue.isString()) {
                WTF::String rangeString = rangeValue.toWTFString(lexicalGlobalObject);
                RETURN_IF_EXCEPTION(scope, {});
                rangeSpec = rangeString.utf8();
            }

            JSC::JSValue limitValue = options->get(lexicalGlobalObject, JSC::Identifier::fromString(vm, "limit"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (!limitValue.isUndefined() && limitValue.isNumber()) {
                limit = limitValue.toInt32(lexicalGlobalObject);
                RETURN_IF_EXCEPTION(scope, {});
            }
        }
    }

    git_revwalk* walk = nullptr;
    int error = git_revwalk_new(&walk, repo);
    if (error < 0) {
        throwException(lexicalGlobalObject, scope, createGitError(lexicalGlobalObject, "Failed to create revwalk"));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    if (rangeSpec.length() > 0) {
        error = git_revwalk_push_range(walk, rangeSpec.data());
    } else {
        git_object* fromObj = nullptr;
        error = git_revparse_single(&fromObj, repo, fromSpec.data());
        if (error == 0) {
            error = git_revwalk_push(walk, git_object_id(fromObj));
            git_object_free(fromObj);
        }
    }

    if (error < 0) {
        git_revwalk_free(walk);
        throwException(lexicalGlobalObject, scope, createGitError(lexicalGlobalObject, "Failed to set revwalk range"));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_revwalk_sorting(walk, GIT_SORT_TIME);

    auto* globalObject = JSC::jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject);
    if (!globalObject) {
        git_revwalk_free(walk);
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Invalid global object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::Structure* commitStructure = globalObject->JSGitCommitStructure();

    // Collect commits
    Vector<JSC::Strong<JSC::JSObject>> commits;
    git_oid oid;
    int count = 0;
    while (git_revwalk_next(&oid, walk) == 0) {
        if (limit >= 0 && count >= limit)
            break;

        git_commit* commit = nullptr;
        error = git_commit_lookup(&commit, repo, &oid);
        if (error < 0)
            continue;

        JSGitCommit* jsCommit = JSGitCommit::create(vm, commitStructure, commit);
        commits.append(JSC::Strong<JSC::JSObject>(vm, jsCommit));
        count++;
    }

    git_revwalk_free(walk);

    // Create result array
    JSC::JSArray* result = JSC::constructEmptyArray(lexicalGlobalObject, nullptr, commits.size());
    RETURN_IF_EXCEPTION(scope, {});

    for (size_t i = 0; i < commits.size(); i++) {
        result->putDirectIndex(lexicalGlobalObject, i, commits[i].get());
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSC::JSValue::encode(result);
}

static const HashTableValue JSGitRepositoryPrototypeTableValues[] = {
    { "head"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryHead, 0 } },
    { "path"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetPath, 0 } },
    { "workdir"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetWorkdir, 0 } },
    { "isBare"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryIsBare, 0 } },
    { "getStatus"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryGetStatus, 1 } },
    { "revParse"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryRevParse, 1 } },
    { "getCurrentBranch"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryGetCurrentBranch, 0 } },
    { "aheadBehind"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryAheadBehind, 2 } },
    { "listFiles"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryListFiles, 0 } },
    { "diff"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryDiff, 1 } },
    { "countCommits"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryCountCommits, 1 } },
    { "log"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryLog, 1 } },
};

class JSGitRepositoryPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSGitRepositoryPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSGitRepositoryPrototype* ptr = new (NotNull, JSC::allocateCell<JSGitRepositoryPrototype>(vm)) JSGitRepositoryPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSGitRepositoryPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSGitRepositoryPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        reifyStaticProperties(vm, JSGitRepositoryPrototype::info(), JSGitRepositoryPrototypeTableValues, *this);
    }
};

const ClassInfo JSGitRepositoryPrototype::s_info = { "Repository"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitRepositoryPrototype) };
const ClassInfo JSGitRepository::s_info = { "Repository"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitRepository) };

JSGitRepository* JSGitRepository::create(JSC::VM& vm, JSC::Structure* structure, git_repository* repo)
{
    JSGitRepository* ptr = new (NotNull, JSC::allocateCell<JSGitRepository>(vm)) JSGitRepository(vm, structure, repo);
    ptr->finishCreation(vm);
    return ptr;
}

void JSGitRepository::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
}

void JSGitRepository::destroy(JSC::JSCell* cell)
{
    JSGitRepository* thisObject = static_cast<JSGitRepository*>(cell);
    if (thisObject->m_repo) {
        git_repository_free(thisObject->m_repo);
        thisObject->m_repo = nullptr;
    }
    thisObject->~JSGitRepository();
}

JSC::Structure* createJSGitRepositoryStructure(JSC::JSGlobalObject* globalObject)
{
    JSC::Structure* prototypeStructure = JSGitRepositoryPrototype::createStructure(globalObject->vm(), globalObject, globalObject->objectPrototype());
    prototypeStructure->setMayBePrototype(true);
    JSGitRepositoryPrototype* prototype = JSGitRepositoryPrototype::create(globalObject->vm(), globalObject, prototypeStructure);
    return JSGitRepository::createStructure(globalObject->vm(), globalObject, prototype);
}

// ============================================================================
// JSGitCommit Implementation
// ============================================================================

JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetId, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = JSC::jsDynamicCast<JSGitCommit*>(JSC::JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Commit object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_commit* commit = thisObject->commit();
    if (!commit) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Commit has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    const git_oid* oid = git_commit_id(commit);
    char oidStr[GIT_OID_SHA1_HEXSIZE + 1];
    git_oid_tostr(oidStr, sizeof(oidStr), oid);

    return JSC::JSValue::encode(JSC::jsString(vm, WTF::String::fromUTF8(oidStr)));
}

JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetMessage, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = JSC::jsDynamicCast<JSGitCommit*>(JSC::JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Commit object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_commit* commit = thisObject->commit();
    if (!commit) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Commit has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    const char* message = git_commit_message(commit);
    if (!message) {
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));
    }

    return JSC::JSValue::encode(JSC::jsString(vm, WTF::String::fromUTF8(message)));
}

JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetSummary, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = JSC::jsDynamicCast<JSGitCommit*>(JSC::JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Commit object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_commit* commit = thisObject->commit();
    if (!commit) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Commit has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    const char* summary = git_commit_summary(commit);
    if (!summary) {
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));
    }

    return JSC::JSValue::encode(JSC::jsString(vm, WTF::String::fromUTF8(summary)));
}

JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetAuthor, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = JSC::jsDynamicCast<JSGitCommit*>(JSC::JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Commit object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_commit* commit = thisObject->commit();
    if (!commit) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Commit has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    const git_signature* author = git_commit_author(commit);
    if (!author) {
        return JSC::JSValue::encode(JSC::jsNull());
    }

    JSC::JSObject* obj = JSC::constructEmptyObject(lexicalGlobalObject);
    obj->putDirect(vm, JSC::Identifier::fromString(vm, "name"_s),
        JSC::jsString(vm, WTF::String::fromUTF8(author->name ? author->name : "")));
    obj->putDirect(vm, JSC::Identifier::fromString(vm, "email"_s),
        JSC::jsString(vm, WTF::String::fromUTF8(author->email ? author->email : "")));
    obj->putDirect(vm, JSC::Identifier::fromString(vm, "time"_s),
        JSC::jsNumber(static_cast<double>(author->when.time) * 1000.0)); // Convert to milliseconds for JS Date

    return JSC::JSValue::encode(obj);
}

JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetCommitter, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = JSC::jsDynamicCast<JSGitCommit*>(JSC::JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Commit object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_commit* commit = thisObject->commit();
    if (!commit) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Commit has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    const git_signature* committer = git_commit_committer(commit);
    if (!committer) {
        return JSC::JSValue::encode(JSC::jsNull());
    }

    JSC::JSObject* obj = JSC::constructEmptyObject(lexicalGlobalObject);
    obj->putDirect(vm, JSC::Identifier::fromString(vm, "name"_s),
        JSC::jsString(vm, WTF::String::fromUTF8(committer->name ? committer->name : "")));
    obj->putDirect(vm, JSC::Identifier::fromString(vm, "email"_s),
        JSC::jsString(vm, WTF::String::fromUTF8(committer->email ? committer->email : "")));
    obj->putDirect(vm, JSC::Identifier::fromString(vm, "time"_s),
        JSC::jsNumber(static_cast<double>(committer->when.time) * 1000.0));

    return JSC::JSValue::encode(obj);
}

JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetTime, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = JSC::jsDynamicCast<JSGitCommit*>(JSC::JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected Commit object"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_commit* commit = thisObject->commit();
    if (!commit) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Commit has been freed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    git_time_t time = git_commit_time(commit);
    return JSC::JSValue::encode(JSC::jsNumber(static_cast<double>(time)));
}

static const HashTableValue JSGitCommitPrototypeTableValues[] = {
    { "id"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetId, 0 } },
    { "message"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetMessage, 0 } },
    { "summary"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetSummary, 0 } },
    { "author"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetAuthor, 0 } },
    { "committer"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetCommitter, 0 } },
    { "time"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetTime, 0 } },
};

class JSGitCommitPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSGitCommitPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSGitCommitPrototype* ptr = new (NotNull, JSC::allocateCell<JSGitCommitPrototype>(vm)) JSGitCommitPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSGitCommitPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSGitCommitPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        reifyStaticProperties(vm, JSGitCommitPrototype::info(), JSGitCommitPrototypeTableValues, *this);
    }
};

const ClassInfo JSGitCommitPrototype::s_info = { "Commit"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitCommitPrototype) };
const ClassInfo JSGitCommit::s_info = { "Commit"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitCommit) };

JSGitCommit* JSGitCommit::create(JSC::VM& vm, JSC::Structure* structure, git_commit* commit)
{
    JSGitCommit* ptr = new (NotNull, JSC::allocateCell<JSGitCommit>(vm)) JSGitCommit(vm, structure, commit);
    ptr->finishCreation(vm);
    return ptr;
}

void JSGitCommit::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
}

void JSGitCommit::destroy(JSC::JSCell* cell)
{
    JSGitCommit* thisObject = static_cast<JSGitCommit*>(cell);
    if (thisObject->m_commit) {
        git_commit_free(thisObject->m_commit);
        thisObject->m_commit = nullptr;
    }
    thisObject->~JSGitCommit();
}

JSC::Structure* createJSGitCommitStructure(JSC::JSGlobalObject* globalObject)
{
    JSC::Structure* prototypeStructure = JSGitCommitPrototype::createStructure(globalObject->vm(), globalObject, globalObject->objectPrototype());
    prototypeStructure->setMayBePrototype(true);
    JSGitCommitPrototype* prototype = JSGitCommitPrototype::create(globalObject->vm(), globalObject, prototypeStructure);
    return JSGitCommit::createStructure(globalObject->vm(), globalObject, prototype);
}

// ============================================================================
// Module Creation (called from $cpp in git.ts)
// ============================================================================

JSC::JSValue createJSGitModule(Zig::GlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();

    // Create the module object with Repository.open as a static method
    JSC::JSObject* module = JSC::constructEmptyObject(globalObject);

    // Add Repository class/namespace with static methods
    JSC::JSObject* repositoryObj = JSC::constructEmptyObject(globalObject);
    repositoryObj->putDirect(vm, JSC::Identifier::fromString(vm, "open"_s),
        JSC::JSFunction::create(vm, globalObject, 1, "open"_s, jsGitRepositoryOpen, ImplementationVisibility::Public));

    module->putDirect(vm, JSC::Identifier::fromString(vm, "Repository"_s), repositoryObj);

    return module;
}

} // namespace WebCore
