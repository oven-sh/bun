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

static const HashTableValue JSGitRepositoryPrototypeTableValues[] = {
    { "head"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryHead, 0 } },
    { "path"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetPath, 0 } },
    { "workdir"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetWorkdir, 0 } },
    { "isBare"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryIsBare, 0 } },
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
