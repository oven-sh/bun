#include "root.h"
#include "JSGit.h"

#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSDestructibleObjectHeapCellType.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/DateInstance.h>

#include "BunClientData.h"
#include "wtf/text/WTFString.h"

#include <git2.h>

namespace WebCore {
using namespace JSC;

// ============================================================================
// Libgit2 initialization
// ============================================================================

static std::once_flag gitInitFlag;

void initializeGitLibrary()
{
    std::call_once(gitInitFlag, [] {
        git_libgit2_init();
    });
}

// Helper to throw git errors
static JSC::JSValue throwGitError(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, const char* operation)
{
    const git_error* error = git_error_last();
    WTF::String message;
    if (error && error->message) {
        message = WTF::String::fromUTF8(error->message);
    } else {
        message = makeString(operation, " failed"_s);
    }
    throwException(globalObject, scope, createError(globalObject, message));
    return {};
}

// Helper to convert git_oid to hex string
static WTF::String oidToString(const git_oid* oid)
{
    char hex[GIT_OID_SHA1_HEXSIZE + 1];
    git_oid_tostr(hex, sizeof(hex), oid);
    return WTF::String::fromUTF8(hex, GIT_OID_SHA1_HEXSIZE);
}

// ============================================================================
// JSGitRepository Implementation
// ============================================================================

const ClassInfo JSGitRepository::s_info = { "Repository"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitRepository) };

JSGitRepository* JSGitRepository::create(VM& vm, Structure* structure, git_repository* repo)
{
    JSGitRepository* instance = new (NotNull, allocateCell<JSGitRepository>(vm)) JSGitRepository(vm, structure, repo);
    instance->finishCreation(vm);
    return instance;
}

JSGitRepository::JSGitRepository(VM& vm, Structure* structure, git_repository* repo)
    : Base(vm, structure)
    , m_repository(repo)
{
}

void JSGitRepository::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
}

void JSGitRepository::destroy(JSCell* cell)
{
    JSGitRepository* thisObject = static_cast<JSGitRepository*>(cell);
    if (thisObject->m_repository) {
        git_repository_free(thisObject->m_repository);
        thisObject->m_repository = nullptr;
    }
    thisObject->~JSGitRepository();
}

Structure* JSGitRepository::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

template<typename, SubspaceAccess mode>
GCClient::IsoSubspace* JSGitRepository::subspaceFor(VM& vm)
{
    if constexpr (mode == SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<JSGitRepository, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSGitRepository.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSGitRepository = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSGitRepository.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSGitRepository = std::forward<decltype(space)>(space); });
}

template GCClient::IsoSubspace* JSGitRepository::subspaceFor<JSGitRepository, SubspaceAccess::OnMainThread>(VM&);
template GCClient::IsoSubspace* JSGitRepository::subspaceFor<JSGitRepository, SubspaceAccess::Concurrently>(VM&);

template<typename Visitor>
void JSGitRepository::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSGitRepository* thisObject = jsCast<JSGitRepository*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(JSGitRepository);

// ============================================================================
// JSGitCommit Implementation
// ============================================================================

const ClassInfo JSGitCommit::s_info = { "Commit"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitCommit) };

JSGitCommit* JSGitCommit::create(VM& vm, Structure* structure, git_commit* commit, JSGitRepository* repo)
{
    JSGitCommit* instance = new (NotNull, allocateCell<JSGitCommit>(vm)) JSGitCommit(vm, structure, commit, repo);
    instance->finishCreation(vm);
    return instance;
}

JSGitCommit::JSGitCommit(VM& vm, Structure* structure, git_commit* commit, JSGitRepository* repo)
    : Base(vm, structure)
    , m_commit(commit)
{
    m_repo.set(vm, this, repo);
}

void JSGitCommit::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
}

void JSGitCommit::destroy(JSCell* cell)
{
    JSGitCommit* thisObject = static_cast<JSGitCommit*>(cell);
    if (thisObject->m_commit) {
        git_commit_free(thisObject->m_commit);
        thisObject->m_commit = nullptr;
    }
    thisObject->~JSGitCommit();
}

Structure* JSGitCommit::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

template<typename, SubspaceAccess mode>
GCClient::IsoSubspace* JSGitCommit::subspaceFor(VM& vm)
{
    if constexpr (mode == SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<JSGitCommit, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSGitCommit.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSGitCommit = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSGitCommit.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSGitCommit = std::forward<decltype(space)>(space); });
}

template GCClient::IsoSubspace* JSGitCommit::subspaceFor<JSGitCommit, SubspaceAccess::OnMainThread>(VM&);
template GCClient::IsoSubspace* JSGitCommit::subspaceFor<JSGitCommit, SubspaceAccess::Concurrently>(VM&);

template<typename Visitor>
void JSGitCommit::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSGitCommit* thisObject = jsCast<JSGitCommit*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_repo);
}

DEFINE_VISIT_CHILDREN(JSGitCommit);

// ============================================================================
// JSGitBranch Implementation
// ============================================================================

const ClassInfo JSGitBranch::s_info = { "Branch"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitBranch) };

JSGitBranch* JSGitBranch::create(VM& vm, Structure* structure, git_reference* ref, JSGitRepository* repo)
{
    JSGitBranch* instance = new (NotNull, allocateCell<JSGitBranch>(vm)) JSGitBranch(vm, structure, ref, repo);
    instance->finishCreation(vm);
    return instance;
}

JSGitBranch::JSGitBranch(VM& vm, Structure* structure, git_reference* ref, JSGitRepository* repo)
    : Base(vm, structure)
    , m_reference(ref)
{
    m_repo.set(vm, this, repo);
}

void JSGitBranch::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
}

void JSGitBranch::destroy(JSCell* cell)
{
    JSGitBranch* thisObject = static_cast<JSGitBranch*>(cell);
    if (thisObject->m_reference) {
        git_reference_free(thisObject->m_reference);
        thisObject->m_reference = nullptr;
    }
    thisObject->~JSGitBranch();
}

Structure* JSGitBranch::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

template<typename, SubspaceAccess mode>
GCClient::IsoSubspace* JSGitBranch::subspaceFor(VM& vm)
{
    if constexpr (mode == SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<JSGitBranch, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSGitBranch.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSGitBranch = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSGitBranch.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSGitBranch = std::forward<decltype(space)>(space); });
}

template GCClient::IsoSubspace* JSGitBranch::subspaceFor<JSGitBranch, SubspaceAccess::OnMainThread>(VM&);
template GCClient::IsoSubspace* JSGitBranch::subspaceFor<JSGitBranch, SubspaceAccess::Concurrently>(VM&);

template<typename Visitor>
void JSGitBranch::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSGitBranch* thisObject = jsCast<JSGitBranch*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_repo);
}

DEFINE_VISIT_CHILDREN(JSGitBranch);

// ============================================================================
// JSGitRemote Implementation
// ============================================================================

const ClassInfo JSGitRemote::s_info = { "Remote"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitRemote) };

JSGitRemote* JSGitRemote::create(VM& vm, Structure* structure, git_remote* remote, JSGitRepository* repo)
{
    JSGitRemote* instance = new (NotNull, allocateCell<JSGitRemote>(vm)) JSGitRemote(vm, structure, remote, repo);
    instance->finishCreation(vm);
    return instance;
}

JSGitRemote::JSGitRemote(VM& vm, Structure* structure, git_remote* remote, JSGitRepository* repo)
    : Base(vm, structure)
    , m_remote(remote)
{
    m_repo.set(vm, this, repo);
}

void JSGitRemote::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
}

void JSGitRemote::destroy(JSCell* cell)
{
    JSGitRemote* thisObject = static_cast<JSGitRemote*>(cell);
    if (thisObject->m_remote) {
        git_remote_free(thisObject->m_remote);
        thisObject->m_remote = nullptr;
    }
    thisObject->~JSGitRemote();
}

Structure* JSGitRemote::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

template<typename, SubspaceAccess mode>
GCClient::IsoSubspace* JSGitRemote::subspaceFor(VM& vm)
{
    if constexpr (mode == SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<JSGitRemote, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSGitRemote.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSGitRemote = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSGitRemote.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSGitRemote = std::forward<decltype(space)>(space); });
}

template GCClient::IsoSubspace* JSGitRemote::subspaceFor<JSGitRemote, SubspaceAccess::OnMainThread>(VM&);
template GCClient::IsoSubspace* JSGitRemote::subspaceFor<JSGitRemote, SubspaceAccess::Concurrently>(VM&);

template<typename Visitor>
void JSGitRemote::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSGitRemote* thisObject = jsCast<JSGitRemote*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_repo);
}

DEFINE_VISIT_CHILDREN(JSGitRemote);

// ============================================================================
// JSGitConfig Implementation
// ============================================================================

const ClassInfo JSGitConfig::s_info = { "Config"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitConfig) };

JSGitConfig* JSGitConfig::create(VM& vm, Structure* structure, git_config* config, JSGitRepository* repo)
{
    JSGitConfig* instance = new (NotNull, allocateCell<JSGitConfig>(vm)) JSGitConfig(vm, structure, config, repo);
    instance->finishCreation(vm);
    return instance;
}

JSGitConfig::JSGitConfig(VM& vm, Structure* structure, git_config* config, JSGitRepository* repo)
    : Base(vm, structure)
    , m_config(config)
{
    if (repo)
        m_repo.set(vm, this, repo);
}

void JSGitConfig::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
}

void JSGitConfig::destroy(JSCell* cell)
{
    JSGitConfig* thisObject = static_cast<JSGitConfig*>(cell);
    if (thisObject->m_config) {
        git_config_free(thisObject->m_config);
        thisObject->m_config = nullptr;
    }
    thisObject->~JSGitConfig();
}

Structure* JSGitConfig::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

template<typename, SubspaceAccess mode>
GCClient::IsoSubspace* JSGitConfig::subspaceFor(VM& vm)
{
    if constexpr (mode == SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<JSGitConfig, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSGitConfig.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSGitConfig = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSGitConfig.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSGitConfig = std::forward<decltype(space)>(space); });
}

template GCClient::IsoSubspace* JSGitConfig::subspaceFor<JSGitConfig, SubspaceAccess::OnMainThread>(VM&);
template GCClient::IsoSubspace* JSGitConfig::subspaceFor<JSGitConfig, SubspaceAccess::Concurrently>(VM&);

template<typename Visitor>
void JSGitConfig::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSGitConfig* thisObject = jsCast<JSGitConfig*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_repo);
}

DEFINE_VISIT_CHILDREN(JSGitConfig);

// ============================================================================
// JSGitIndex Implementation
// ============================================================================

const ClassInfo JSGitIndex::s_info = { "Index"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitIndex) };

JSGitIndex* JSGitIndex::create(VM& vm, Structure* structure, git_index* index, JSGitRepository* repo)
{
    JSGitIndex* instance = new (NotNull, allocateCell<JSGitIndex>(vm)) JSGitIndex(vm, structure, index, repo);
    instance->finishCreation(vm);
    return instance;
}

JSGitIndex::JSGitIndex(VM& vm, Structure* structure, git_index* index, JSGitRepository* repo)
    : Base(vm, structure)
    , m_index(index)
{
    m_repo.set(vm, this, repo);
}

void JSGitIndex::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
}

void JSGitIndex::destroy(JSCell* cell)
{
    JSGitIndex* thisObject = static_cast<JSGitIndex*>(cell);
    if (thisObject->m_index) {
        git_index_free(thisObject->m_index);
        thisObject->m_index = nullptr;
    }
    thisObject->~JSGitIndex();
}

Structure* JSGitIndex::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

template<typename, SubspaceAccess mode>
GCClient::IsoSubspace* JSGitIndex::subspaceFor(VM& vm)
{
    if constexpr (mode == SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<JSGitIndex, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSGitIndex.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSGitIndex = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSGitIndex.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSGitIndex = std::forward<decltype(space)>(space); });
}

template GCClient::IsoSubspace* JSGitIndex::subspaceFor<JSGitIndex, SubspaceAccess::OnMainThread>(VM&);
template GCClient::IsoSubspace* JSGitIndex::subspaceFor<JSGitIndex, SubspaceAccess::Concurrently>(VM&);

template<typename Visitor>
void JSGitIndex::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSGitIndex* thisObject = jsCast<JSGitIndex*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_repo);
}

DEFINE_VISIT_CHILDREN(JSGitIndex);

// ============================================================================
// JSGitDiff Implementation
// ============================================================================

const ClassInfo JSGitDiff::s_info = { "Diff"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitDiff) };

JSGitDiff* JSGitDiff::create(VM& vm, Structure* structure, git_diff* diff, JSGitRepository* repo)
{
    JSGitDiff* instance = new (NotNull, allocateCell<JSGitDiff>(vm)) JSGitDiff(vm, structure, diff, repo);
    instance->finishCreation(vm);
    return instance;
}

JSGitDiff::JSGitDiff(VM& vm, Structure* structure, git_diff* diff, JSGitRepository* repo)
    : Base(vm, structure)
    , m_diff(diff)
{
    m_repo.set(vm, this, repo);
}

void JSGitDiff::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
}

void JSGitDiff::destroy(JSCell* cell)
{
    JSGitDiff* thisObject = static_cast<JSGitDiff*>(cell);
    if (thisObject->m_diff) {
        git_diff_free(thisObject->m_diff);
        thisObject->m_diff = nullptr;
    }
    thisObject->~JSGitDiff();
}

Structure* JSGitDiff::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

template<typename, SubspaceAccess mode>
GCClient::IsoSubspace* JSGitDiff::subspaceFor(VM& vm)
{
    if constexpr (mode == SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<JSGitDiff, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSGitDiff.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSGitDiff = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSGitDiff.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSGitDiff = std::forward<decltype(space)>(space); });
}

template GCClient::IsoSubspace* JSGitDiff::subspaceFor<JSGitDiff, SubspaceAccess::OnMainThread>(VM&);
template GCClient::IsoSubspace* JSGitDiff::subspaceFor<JSGitDiff, SubspaceAccess::Concurrently>(VM&);

template<typename Visitor>
void JSGitDiff::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSGitDiff* thisObject = jsCast<JSGitDiff*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_repo);
}

DEFINE_VISIT_CHILDREN(JSGitDiff);

// ============================================================================
// JSGitBlob Implementation
// ============================================================================

const ClassInfo JSGitBlob::s_info = { "Blob"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitBlob) };

JSGitBlob* JSGitBlob::create(VM& vm, Structure* structure, git_blob* blob, JSGitRepository* repo)
{
    JSGitBlob* instance = new (NotNull, allocateCell<JSGitBlob>(vm)) JSGitBlob(vm, structure, blob, repo);
    instance->finishCreation(vm);
    return instance;
}

JSGitBlob::JSGitBlob(VM& vm, Structure* structure, git_blob* blob, JSGitRepository* repo)
    : Base(vm, structure)
    , m_blob(blob)
{
    m_repo.set(vm, this, repo);
}

void JSGitBlob::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
}

void JSGitBlob::destroy(JSCell* cell)
{
    JSGitBlob* thisObject = static_cast<JSGitBlob*>(cell);
    if (thisObject->m_blob) {
        git_blob_free(thisObject->m_blob);
        thisObject->m_blob = nullptr;
    }
    thisObject->~JSGitBlob();
}

Structure* JSGitBlob::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

template<typename, SubspaceAccess mode>
GCClient::IsoSubspace* JSGitBlob::subspaceFor(VM& vm)
{
    if constexpr (mode == SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<JSGitBlob, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSGitBlob.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSGitBlob = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSGitBlob.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSGitBlob = std::forward<decltype(space)>(space); });
}

template GCClient::IsoSubspace* JSGitBlob::subspaceFor<JSGitBlob, SubspaceAccess::OnMainThread>(VM&);
template GCClient::IsoSubspace* JSGitBlob::subspaceFor<JSGitBlob, SubspaceAccess::Concurrently>(VM&);

template<typename Visitor>
void JSGitBlob::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSGitBlob* thisObject = jsCast<JSGitBlob*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_repo);
}

DEFINE_VISIT_CHILDREN(JSGitBlob);

// ============================================================================
// JSGitWorktree Implementation
// ============================================================================

const ClassInfo JSGitWorktree::s_info = { "Worktree"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitWorktree) };

JSGitWorktree* JSGitWorktree::create(VM& vm, Structure* structure, git_worktree* worktree, JSGitRepository* repo)
{
    JSGitWorktree* instance = new (NotNull, allocateCell<JSGitWorktree>(vm)) JSGitWorktree(vm, structure, worktree, repo);
    instance->finishCreation(vm);
    return instance;
}

JSGitWorktree::JSGitWorktree(VM& vm, Structure* structure, git_worktree* worktree, JSGitRepository* repo)
    : Base(vm, structure)
    , m_worktree(worktree)
{
    m_repo.set(vm, this, repo);
}

void JSGitWorktree::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
}

void JSGitWorktree::destroy(JSCell* cell)
{
    JSGitWorktree* thisObject = static_cast<JSGitWorktree*>(cell);
    if (thisObject->m_worktree) {
        git_worktree_free(thisObject->m_worktree);
        thisObject->m_worktree = nullptr;
    }
    thisObject->~JSGitWorktree();
}

Structure* JSGitWorktree::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

template<typename, SubspaceAccess mode>
GCClient::IsoSubspace* JSGitWorktree::subspaceFor(VM& vm)
{
    if constexpr (mode == SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<JSGitWorktree, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSGitWorktree.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSGitWorktree = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSGitWorktree.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSGitWorktree = std::forward<decltype(space)>(space); });
}

template GCClient::IsoSubspace* JSGitWorktree::subspaceFor<JSGitWorktree, SubspaceAccess::OnMainThread>(VM&);
template GCClient::IsoSubspace* JSGitWorktree::subspaceFor<JSGitWorktree, SubspaceAccess::Concurrently>(VM&);

template<typename Visitor>
void JSGitWorktree::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSGitWorktree* thisObject = jsCast<JSGitWorktree*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_repo);
}

DEFINE_VISIT_CHILDREN(JSGitWorktree);

} // namespace WebCore
