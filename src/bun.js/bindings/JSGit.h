#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSNonFinalObject.h>
#include <JavaScriptCore/InternalFunction.h>
#include <git2.h>

namespace Bun {
using namespace JSC;

// Forward declarations
class JSGitRepository;
class JSGitCommit;
class JSGitBranch;
class JSGitRemote;
class JSGitDiff;
class JSGitStatusEntry;
class JSGitIndex;
class JSGitConfig;
class JSGitStash;
class JSGitWorktree;
class JSGitBlob;
class JSGitSignature;

// Initialize libgit2 (call once at startup)
void initializeLibgit2();
void shutdownLibgit2();

// ============================================================================
// JSGitRepository - Core repository class
// ============================================================================

class JSGitRepository : public JSC::JSDestructibleObject {
    using Base = JSC::JSDestructibleObject;

public:
    JSGitRepository(JSC::VM& vm, JSC::Structure* structure, git_repository* repo)
        : Base(vm, structure)
        , m_repo(repo)
    {
    }

    DECLARE_INFO;

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }

    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSGitRepository* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, git_repository* repo)
    {
        JSGitRepository* object = new (NotNull, JSC::allocateCell<JSGitRepository>(vm)) JSGitRepository(vm, structure, repo);
        object->finishCreation(vm, globalObject);
        return object;
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

    static void destroy(JSCell* thisObject)
    {
        static_cast<JSGitRepository*>(thisObject)->~JSGitRepository();
    }

    ~JSGitRepository();

    git_repository* repo() const { return m_repo; }

private:
    git_repository* m_repo;
};

class JSGitRepositoryPrototype : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSGitRepositoryPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSGitRepositoryPrototype* ptr = new (NotNull, JSC::allocateCell<JSGitRepositoryPrototype>(vm)) JSGitRepositoryPrototype(vm, structure);
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
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSGitRepositoryPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

class JSGitRepositoryConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static JSGitRepositoryConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSGitRepositoryPrototype* prototype);

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    void initializeProperties(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSGitRepositoryPrototype* prototype);

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);

    DECLARE_EXPORT_INFO;

private:
    JSGitRepositoryConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, call, construct)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject* globalObject, JSGitRepositoryPrototype* prototype);
};

// ============================================================================
// JSGitCommit - Commit class
// ============================================================================

class JSGitCommit : public JSC::JSDestructibleObject {
    using Base = JSC::JSDestructibleObject;

public:
    JSGitCommit(JSC::VM& vm, JSC::Structure* structure, git_commit* commit, JSGitRepository* repo)
        : Base(vm, structure)
        , m_commit(commit)
        , m_repo(repo)
    {
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }

    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSGitCommit* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, git_commit* commit, JSGitRepository* repo)
    {
        JSGitCommit* object = new (NotNull, JSC::allocateCell<JSGitCommit>(vm)) JSGitCommit(vm, structure, commit, repo);
        object->finishCreation(vm, globalObject);
        return object;
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

    static void destroy(JSCell* thisObject)
    {
        static_cast<JSGitCommit*>(thisObject)->~JSGitCommit();
    }

    ~JSGitCommit();

    git_commit* commit() const { return m_commit; }
    JSGitRepository* repository() const { return m_repo; }

private:
    git_commit* m_commit;
    JSGitRepository* m_repo;
};

class JSGitCommitPrototype : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSGitCommitPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSGitCommitPrototype* ptr = new (NotNull, JSC::allocateCell<JSGitCommitPrototype>(vm)) JSGitCommitPrototype(vm, structure);
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
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSGitCommitPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

class JSGitCommitConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static JSGitCommitConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSGitCommitPrototype* prototype);

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);

    DECLARE_EXPORT_INFO;

private:
    JSGitCommitConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, call, construct)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject* globalObject, JSGitCommitPrototype* prototype);
};

// ============================================================================
// JSGitBranch - Branch class
// ============================================================================

class JSGitBranch : public JSC::JSDestructibleObject {
    using Base = JSC::JSDestructibleObject;

public:
    JSGitBranch(JSC::VM& vm, JSC::Structure* structure, git_reference* ref, JSGitRepository* repo, bool isRemote)
        : Base(vm, structure)
        , m_ref(ref)
        , m_repo(repo)
        , m_isRemote(isRemote)
    {
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }

    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSGitBranch* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, git_reference* ref, JSGitRepository* repo, bool isRemote)
    {
        JSGitBranch* object = new (NotNull, JSC::allocateCell<JSGitBranch>(vm)) JSGitBranch(vm, structure, ref, repo, isRemote);
        object->finishCreation(vm, globalObject);
        return object;
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

    static void destroy(JSCell* thisObject)
    {
        static_cast<JSGitBranch*>(thisObject)->~JSGitBranch();
    }

    ~JSGitBranch();

    git_reference* ref() const { return m_ref; }
    JSGitRepository* repository() const { return m_repo; }
    bool isRemote() const { return m_isRemote; }

private:
    git_reference* m_ref;
    JSGitRepository* m_repo;
    bool m_isRemote;
};

class JSGitBranchPrototype : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSGitBranchPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSGitBranchPrototype* ptr = new (NotNull, JSC::allocateCell<JSGitBranchPrototype>(vm)) JSGitBranchPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSGitBranchPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSGitBranchPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

class JSGitBranchConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static JSGitBranchConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSGitBranchPrototype* prototype);

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);

    DECLARE_EXPORT_INFO;

private:
    JSGitBranchConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, call, construct)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject* globalObject, JSGitBranchPrototype* prototype);
};

// ============================================================================
// JSGitSignature - Signature class (author/committer info)
// ============================================================================

class JSGitSignature : public JSC::JSNonFinalObject {
    using Base = JSC::JSNonFinalObject;

public:
    JSGitSignature(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
        , m_name()
        , m_email()
        , m_time(0)
        , m_offset(0)
    {
    }

    DECLARE_INFO;

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSGitSignature, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSGitSignature* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, const git_signature* sig)
    {
        JSGitSignature* object = new (NotNull, JSC::allocateCell<JSGitSignature>(vm)) JSGitSignature(vm, structure);
        object->finishCreation(vm, globalObject, sig);
        return object;
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, const git_signature* sig);

    const String& name() const { return m_name; }
    const String& email() const { return m_email; }
    git_time_t time() const { return m_time; }
    int offset() const { return m_offset; }

private:
    String m_name;
    String m_email;
    git_time_t m_time;
    int m_offset;
};

class JSGitSignaturePrototype : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSGitSignaturePrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSGitSignaturePrototype* ptr = new (NotNull, JSC::allocateCell<JSGitSignaturePrototype>(vm)) JSGitSignaturePrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSGitSignaturePrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSGitSignaturePrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

class JSGitSignatureConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static JSGitSignatureConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSGitSignaturePrototype* prototype);

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);

    DECLARE_EXPORT_INFO;

private:
    JSGitSignatureConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, call, construct)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject* globalObject, JSGitSignaturePrototype* prototype);
};

// ============================================================================
// Helper functions for class structure initialization
// ============================================================================

void initJSGitRepositoryClassStructure(JSC::LazyClassStructure::Initializer& init);
void initJSGitCommitClassStructure(JSC::LazyClassStructure::Initializer& init);
void initJSGitBranchClassStructure(JSC::LazyClassStructure::Initializer& init);
void initJSGitSignatureClassStructure(JSC::LazyClassStructure::Initializer& init);

} // namespace Bun
