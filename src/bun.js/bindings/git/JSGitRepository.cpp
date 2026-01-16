#include "root.h"
#include "JSGit.h"

#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/DateInstance.h>
#include <JavaScriptCore/ArrayBuffer.h>

#include "BunClientData.h"
#include "ZigGlobalObject.h"
#include "wtf/text/WTFString.h"

#include <git2.h>

namespace WebCore {
using namespace JSC;

// Forward declarations
static JSC::JSValue createSignatureObject(JSC::JSGlobalObject*, const git_signature*);

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
// Repository Prototype Methods
// ============================================================================

JSC_DECLARE_HOST_FUNCTION(jsGitRepositoryProtoFunc_getCommit);
JSC_DECLARE_HOST_FUNCTION(jsGitRepositoryProtoFunc_getBranch);
JSC_DECLARE_HOST_FUNCTION(jsGitRepositoryProtoFunc_getRemote);
JSC_DECLARE_HOST_FUNCTION(jsGitRepositoryProtoFunc_status);
JSC_DECLARE_HOST_FUNCTION(jsGitRepositoryProtoFunc_diff);
JSC_DECLARE_HOST_FUNCTION(jsGitRepositoryProtoFunc_add);
JSC_DECLARE_HOST_FUNCTION(jsGitRepositoryProtoFunc_reset);
JSC_DECLARE_HOST_FUNCTION(jsGitRepositoryProtoFunc_commit);
JSC_DECLARE_HOST_FUNCTION(jsGitRepositoryProtoFunc_checkout);
JSC_DECLARE_HOST_FUNCTION(jsGitRepositoryProtoFunc_fetch);

JSC_DECLARE_CUSTOM_GETTER(jsGitRepositoryGetter_path);
JSC_DECLARE_CUSTOM_GETTER(jsGitRepositoryGetter_gitDir);
JSC_DECLARE_CUSTOM_GETTER(jsGitRepositoryGetter_isBare);
JSC_DECLARE_CUSTOM_GETTER(jsGitRepositoryGetter_head);
JSC_DECLARE_CUSTOM_GETTER(jsGitRepositoryGetter_branch);
JSC_DECLARE_CUSTOM_GETTER(jsGitRepositoryGetter_isClean);
JSC_DECLARE_CUSTOM_GETTER(jsGitRepositoryGetter_config);
JSC_DECLARE_CUSTOM_GETTER(jsGitRepositoryGetter_index);

// Repository Prototype Table
static const HashTableValue JSGitRepositoryPrototypeTableValues[] = {
    { "path"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetter_path, 0 } },
    { "gitDir"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetter_gitDir, 0 } },
    { "isBare"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetter_isBare, 0 } },
    { "head"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetter_head, 0 } },
    { "branch"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetter_branch, 0 } },
    { "isClean"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetter_isClean, 0 } },
    { "config"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetter_config, 0 } },
    { "index"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitRepositoryGetter_index, 0 } },
    { "getCommit"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryProtoFunc_getCommit, 1 } },
    { "getBranch"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryProtoFunc_getBranch, 1 } },
    { "getRemote"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryProtoFunc_getRemote, 1 } },
    { "status"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryProtoFunc_status, 0 } },
    { "diff"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryProtoFunc_diff, 0 } },
    { "add"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryProtoFunc_add, 1 } },
    { "reset"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryProtoFunc_reset, 0 } },
    { "commit"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryProtoFunc_commit, 1 } },
    { "checkout"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryProtoFunc_checkout, 1 } },
    { "fetch"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitRepositoryProtoFunc_fetch, 0 } },
};

// ============================================================================
// Repository Prototype Class
// ============================================================================

class JSGitRepositoryPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSGitRepositoryPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSGitRepositoryPrototype* prototype = new (NotNull, allocateCell<JSGitRepositoryPrototype>(vm)) JSGitRepositoryPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    template<typename, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm) { return &vm.plainObjectSpace(); }

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSGitRepositoryPrototype(JSC::VM& vm, JSC::Structure* structure) : Base(vm, structure) {}
    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        reifyStaticProperties(vm, JSGitRepository::info(), JSGitRepositoryPrototypeTableValues, *this);
        JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    }
};

const ClassInfo JSGitRepositoryPrototype::s_info = { "Repository"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitRepositoryPrototype) };

// ============================================================================
// Repository Constructor
// ============================================================================

class JSGitRepositoryConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSGitRepositoryConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype);

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm) { return &vm.internalFunctionSpace(); }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSGitRepositoryConstructor(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype);

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);
};

const ClassInfo JSGitRepositoryConstructor::s_info = { "Repository"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitRepositoryConstructor) };

// Static methods on constructor
JSC_DECLARE_HOST_FUNCTION(jsGitRepositoryConstructorFunc_find);
JSC_DECLARE_HOST_FUNCTION(jsGitRepositoryConstructorFunc_init);
JSC_DECLARE_HOST_FUNCTION(jsGitRepositoryConstructorFunc_clone);

JSGitRepositoryConstructor::JSGitRepositoryConstructor(VM& vm, Structure* structure)
    : Base(vm, structure, call, construct)
{
}

JSGitRepositoryConstructor* JSGitRepositoryConstructor::create(VM& vm, Structure* structure, JSObject* prototype)
{
    JSGitRepositoryConstructor* constructor = new (NotNull, allocateCell<JSGitRepositoryConstructor>(vm)) JSGitRepositoryConstructor(vm, structure);
    constructor->finishCreation(vm, prototype);
    return constructor;
}

void JSGitRepositoryConstructor::finishCreation(VM& vm, JSObject* prototype)
{
    Base::finishCreation(vm, 1, "Repository"_s);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);

    // Static methods
    JSC::JSGlobalObject* globalObject = prototype->globalObject();
    putDirect(vm, Identifier::fromString(vm, "find"_s), JSC::JSFunction::create(vm, globalObject, 1, "find"_s, jsGitRepositoryConstructorFunc_find, ImplementationVisibility::Public, NoIntrinsic), static_cast<unsigned>(PropertyAttribute::Function));
    putDirect(vm, Identifier::fromString(vm, "init"_s), JSC::JSFunction::create(vm, globalObject, 1, "init"_s, jsGitRepositoryConstructorFunc_init, ImplementationVisibility::Public, NoIntrinsic), static_cast<unsigned>(PropertyAttribute::Function));
    putDirect(vm, Identifier::fromString(vm, "clone"_s), JSC::JSFunction::create(vm, globalObject, 2, "clone"_s, jsGitRepositoryConstructorFunc_clone, ImplementationVisibility::Public, NoIntrinsic), static_cast<unsigned>(PropertyAttribute::Function));
}

// Constructor call - new Repository(path)
JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSGitRepositoryConstructor::construct(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    initializeGitLibrary();

    WTF::String path = "."_s;
    if (callFrame->argumentCount() > 0 && !callFrame->argument(0).isUndefined()) {
        path = callFrame->argument(0).toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    git_repository* repo = nullptr;
    int error = git_repository_open_ext(&repo, path.utf8().data(), 0, nullptr);
    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to open repository").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSGitRepositoryStructure();

    JSGitRepository* result = JSGitRepository::create(vm, structure, repo);
    return JSValue::encode(result);
}

// Function call - Repository(path) without new
JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSGitRepositoryConstructor::call(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwException(globalObject, scope, createError(globalObject, "Repository constructor must be called with 'new'"_s));
    return {};
}

// ============================================================================
// Repository Static Methods
// ============================================================================

// Repository.find(path?) - Find repository without throwing
JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryConstructorFunc_find, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    initializeGitLibrary();

    WTF::String path = "."_s;
    if (callFrame->argumentCount() > 0 && !callFrame->argument(0).isUndefined()) {
        path = callFrame->argument(0).toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    git_repository* repo = nullptr;
    int error = git_repository_open_ext(&repo, path.utf8().data(), 0, nullptr);
    if (error < 0) {
        return JSValue::encode(jsNull());
    }

    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSGitRepositoryStructure();

    JSGitRepository* result = JSGitRepository::create(vm, structure, repo);
    return JSValue::encode(result);
}

// Repository.init(path, options?)
JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryConstructorFunc_init, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    initializeGitLibrary();

    if (callFrame->argumentCount() < 1) {
        throwException(globalObject, scope, createError(globalObject, "Repository.init requires a path argument"_s));
        return {};
    }

    WTF::String path = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    bool isBare = false;
    WTF::String initialBranch;

    if (callFrame->argumentCount() > 1 && callFrame->argument(1).isObject()) {
        JSObject* options = callFrame->argument(1).getObject();
        JSValue bareValue = options->get(globalObject, Identifier::fromString(vm, "bare"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (bareValue.isBoolean()) {
            isBare = bareValue.asBoolean();
        }

        JSValue branchValue = options->get(globalObject, Identifier::fromString(vm, "initialBranch"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (branchValue.isString()) {
            initialBranch = branchValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    git_repository_init_options opts = GIT_REPOSITORY_INIT_OPTIONS_INIT;
    opts.flags = GIT_REPOSITORY_INIT_MKPATH;
    if (isBare)
        opts.flags |= GIT_REPOSITORY_INIT_BARE;
    if (!initialBranch.isEmpty())
        opts.initial_head = initialBranch.utf8().data();

    git_repository* repo = nullptr;
    int error = git_repository_init_ext(&repo, path.utf8().data(), &opts);
    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to initialize repository").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSGitRepositoryStructure();

    JSGitRepository* result = JSGitRepository::create(vm, structure, repo);
    return JSValue::encode(result);
}

// Repository.clone(url, targetPath, options?)
JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryConstructorFunc_clone, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    initializeGitLibrary();

    if (callFrame->argumentCount() < 2) {
        throwException(globalObject, scope, createError(globalObject, "Repository.clone requires url and targetPath arguments"_s));
        return {};
    }

    WTF::String url = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    WTF::String targetPath = callFrame->argument(1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    git_clone_options opts = GIT_CLONE_OPTIONS_INIT;

    if (callFrame->argumentCount() > 2 && callFrame->argument(2).isObject()) {
        JSObject* options = callFrame->argument(2).getObject();

        JSValue bareValue = options->get(globalObject, Identifier::fromString(vm, "bare"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (bareValue.isBoolean() && bareValue.asBoolean()) {
            opts.bare = 1;
        }

        JSValue depthValue = options->get(globalObject, Identifier::fromString(vm, "depth"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (depthValue.isNumber()) {
            opts.fetch_opts.depth = depthValue.toInt32(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    git_repository* repo = nullptr;
    int error = git_clone(&repo, url.utf8().data(), targetPath.utf8().data(), &opts);
    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to clone repository").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSGitRepositoryStructure();

    JSGitRepository* result = JSGitRepository::create(vm, structure, repo);
    return JSValue::encode(result);
}

// ============================================================================
// Repository Property Getters
// ============================================================================

JSC_DEFINE_CUSTOM_GETTER(jsGitRepositoryGetter_path, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    const char* path = git_repository_workdir(thisObject->repository());
    if (!path) {
        path = git_repository_path(thisObject->repository());
    }

    return JSValue::encode(jsString(vm, WTF::String::fromUTF8(path)));
}

JSC_DEFINE_CUSTOM_GETTER(jsGitRepositoryGetter_gitDir, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    const char* path = git_repository_path(thisObject->repository());
    return JSValue::encode(jsString(vm, WTF::String::fromUTF8(path)));
}

JSC_DEFINE_CUSTOM_GETTER(jsGitRepositoryGetter_isBare, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    return JSValue::encode(jsBoolean(git_repository_is_bare(thisObject->repository())));
}

JSC_DEFINE_CUSTOM_GETTER(jsGitRepositoryGetter_head, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    git_reference* head = nullptr;
    int error = git_repository_head(&head, thisObject->repository());
    if (error < 0) {
        return JSValue::encode(jsNull());
    }

    const git_oid* oid = git_reference_target(head);
    if (!oid) {
        oid = git_reference_target(git_reference_resolve(&head, head) == 0 ? head : nullptr);
    }

    git_commit* commit = nullptr;
    if (oid) {
        error = git_commit_lookup(&commit, thisObject->repository(), oid);
    }

    git_reference_free(head);

    if (error < 0 || !commit) {
        return JSValue::encode(jsNull());
    }

    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSGitCommitStructure();

    JSGitCommit* result = JSGitCommit::create(vm, structure, commit, thisObject);
    return JSValue::encode(result);
}

JSC_DEFINE_CUSTOM_GETTER(jsGitRepositoryGetter_branch, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    git_reference* head = nullptr;
    int error = git_repository_head(&head, thisObject->repository());
    if (error < 0 || git_repository_head_detached(thisObject->repository())) {
        if (head) git_reference_free(head);
        return JSValue::encode(jsNull());
    }

    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSGitBranchStructure();

    JSGitBranch* result = JSGitBranch::create(vm, structure, head, thisObject);
    return JSValue::encode(result);
}

JSC_DEFINE_CUSTOM_GETTER(jsGitRepositoryGetter_isClean, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    git_status_options opts = GIT_STATUS_OPTIONS_INIT;
    opts.show = GIT_STATUS_SHOW_INDEX_AND_WORKDIR;
    opts.flags = GIT_STATUS_OPT_INCLUDE_UNTRACKED;

    git_status_list* status = nullptr;
    int error = git_status_list_new(&status, thisObject->repository(), &opts);
    if (error < 0) {
        return JSValue::encode(jsBoolean(false));
    }

    size_t count = git_status_list_entrycount(status);
    git_status_list_free(status);

    return JSValue::encode(jsBoolean(count == 0));
}

JSC_DEFINE_CUSTOM_GETTER(jsGitRepositoryGetter_config, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    git_config* config = nullptr;
    int error = git_repository_config(&config, thisObject->repository());
    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to get config").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSGitConfigStructure();

    JSGitConfig* result = JSGitConfig::create(vm, structure, config, thisObject);
    return JSValue::encode(result);
}

JSC_DEFINE_CUSTOM_GETTER(jsGitRepositoryGetter_index, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    git_index* index = nullptr;
    int error = git_repository_index(&index, thisObject->repository());
    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to get index").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSGitIndexStructure();

    JSGitIndex* result = JSGitIndex::create(vm, structure, index, thisObject);
    return JSValue::encode(result);
}

// ============================================================================
// Repository Instance Methods
// ============================================================================

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryProtoFunc_getCommit, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        throwException(globalObject, scope, createError(globalObject, "getCommit requires a ref argument"_s));
        return {};
    }

    WTF::String ref = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    git_oid oid;
    int error = git_oid_fromstr(&oid, ref.utf8().data());

    git_commit* commit = nullptr;
    if (error == 0) {
        error = git_commit_lookup(&commit, thisObject->repository(), &oid);
    } else {
        git_object* obj = nullptr;
        error = git_revparse_single(&obj, thisObject->repository(), ref.utf8().data());
        if (error == 0 && git_object_type(obj) == GIT_OBJECT_COMMIT) {
            commit = (git_commit*)obj;
        } else if (obj) {
            git_object_free(obj);
            error = -1;
        }
    }

    if (error < 0 || !commit) {
        return JSValue::encode(jsNull());
    }

    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSGitCommitStructure();

    JSGitCommit* result = JSGitCommit::create(vm, structure, commit, thisObject);
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryProtoFunc_getBranch, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        throwException(globalObject, scope, createError(globalObject, "getBranch requires a name argument"_s));
        return {};
    }

    WTF::String name = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    git_reference* ref = nullptr;
    int error = git_branch_lookup(&ref, thisObject->repository(), name.utf8().data(), GIT_BRANCH_LOCAL);
    if (error < 0) {
        error = git_branch_lookup(&ref, thisObject->repository(), name.utf8().data(), GIT_BRANCH_REMOTE);
    }

    if (error < 0 || !ref) {
        return JSValue::encode(jsNull());
    }

    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSGitBranchStructure();

    JSGitBranch* result = JSGitBranch::create(vm, structure, ref, thisObject);
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryProtoFunc_getRemote, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    WTF::String name = "origin"_s;
    if (callFrame->argumentCount() > 0 && !callFrame->argument(0).isUndefined()) {
        name = callFrame->argument(0).toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    git_remote* remote = nullptr;
    int error = git_remote_lookup(&remote, thisObject->repository(), name.utf8().data());
    if (error < 0 || !remote) {
        return JSValue::encode(jsNull());
    }

    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSGitRemoteStructure();

    JSGitRemote* result = JSGitRemote::create(vm, structure, remote, thisObject);
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryProtoFunc_status, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    git_status_options opts = GIT_STATUS_OPTIONS_INIT;
    opts.show = GIT_STATUS_SHOW_INDEX_AND_WORKDIR;
    opts.flags = GIT_STATUS_OPT_INCLUDE_UNTRACKED | GIT_STATUS_OPT_RENAMES_HEAD_TO_INDEX;

    git_status_list* status = nullptr;
    int error = git_status_list_new(&status, thisObject->repository(), &opts);
    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to get status").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    size_t count = git_status_list_entrycount(status);
    JSArray* result = constructEmptyArray(globalObject, nullptr, count);
    RETURN_IF_EXCEPTION(scope, {});

    for (size_t i = 0; i < count; i++) {
        const git_status_entry* entry = git_status_byindex(status, i);

        JSObject* obj = constructEmptyObject(globalObject);

        const char* path = entry->head_to_index ? entry->head_to_index->new_file.path :
                          (entry->index_to_workdir ? entry->index_to_workdir->new_file.path : nullptr);
        if (path) {
            obj->putDirect(vm, Identifier::fromString(vm, "path"_s), jsString(vm, WTF::String::fromUTF8(path)));
        }

        // Index status
        WTF::String indexStatus = "unmodified"_s;
        if (entry->status & GIT_STATUS_INDEX_NEW) indexStatus = "added"_s;
        else if (entry->status & GIT_STATUS_INDEX_MODIFIED) indexStatus = "modified"_s;
        else if (entry->status & GIT_STATUS_INDEX_DELETED) indexStatus = "deleted"_s;
        else if (entry->status & GIT_STATUS_INDEX_RENAMED) indexStatus = "renamed"_s;
        obj->putDirect(vm, Identifier::fromString(vm, "indexStatus"_s), jsString(vm, indexStatus));

        // Worktree status
        WTF::String workTreeStatus = "unmodified"_s;
        if (entry->status & GIT_STATUS_WT_NEW) workTreeStatus = "untracked"_s;
        else if (entry->status & GIT_STATUS_WT_MODIFIED) workTreeStatus = "modified"_s;
        else if (entry->status & GIT_STATUS_WT_DELETED) workTreeStatus = "deleted"_s;
        else if (entry->status & GIT_STATUS_WT_RENAMED) workTreeStatus = "renamed"_s;
        obj->putDirect(vm, Identifier::fromString(vm, "workTreeStatus"_s), jsString(vm, workTreeStatus));

        // Helper booleans
        obj->putDirect(vm, Identifier::fromString(vm, "isStaged"_s), jsBoolean(entry->status & (GIT_STATUS_INDEX_NEW | GIT_STATUS_INDEX_MODIFIED | GIT_STATUS_INDEX_DELETED | GIT_STATUS_INDEX_RENAMED)));
        obj->putDirect(vm, Identifier::fromString(vm, "isUntracked"_s), jsBoolean(entry->status & GIT_STATUS_WT_NEW));

        result->putDirectIndex(globalObject, i, obj);
    }

    git_status_list_free(status);
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryProtoFunc_diff, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    git_diff* diff = nullptr;
    git_diff_options opts = GIT_DIFF_OPTIONS_INIT;

    int error = git_diff_index_to_workdir(&diff, thisObject->repository(), nullptr, &opts);
    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to create diff").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSGitDiffStructure();

    JSGitDiff* result = JSGitDiff::create(vm, structure, diff, thisObject);
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryProtoFunc_add, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        throwException(globalObject, scope, createError(globalObject, "add requires paths argument"_s));
        return {};
    }

    git_index* index = nullptr;
    int error = git_repository_index(&index, thisObject->repository());
    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to get index").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    JSValue pathsArg = callFrame->argument(0);
    if (pathsArg.isString()) {
        WTF::String path = pathsArg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        error = git_index_add_bypath(index, path.utf8().data());
    } else if (isArray(globalObject, pathsArg)) {
        JSArray* arr = jsCast<JSArray*>(pathsArg);
        for (unsigned i = 0; i < arr->length(); i++) {
            JSValue item = arr->getIndex(globalObject, i);
            RETURN_IF_EXCEPTION(scope, {});
            WTF::String path = item.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            error = git_index_add_bypath(index, path.utf8().data());
            if (error < 0) break;
        }
    }

    if (error >= 0) {
        error = git_index_write(index);
    }

    git_index_free(index);

    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to add files").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryProtoFunc_reset, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    git_index* index = nullptr;
    int error = git_repository_index(&index, thisObject->repository());
    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to get index").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    git_reference* head = nullptr;
    git_object* headCommit = nullptr;

    error = git_repository_head(&head, thisObject->repository());
    if (error >= 0) {
        error = git_reference_peel(&headCommit, head, GIT_OBJECT_COMMIT);
    }

    if (error >= 0) {
        if (callFrame->argumentCount() > 0 && !callFrame->argument(0).isUndefined()) {
            JSValue pathsArg = callFrame->argument(0);
            git_strarray paths = { nullptr, 0 };

            if (pathsArg.isString()) {
                WTF::String path = pathsArg.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                char* pathStr = strdup(path.utf8().data());
                paths.strings = &pathStr;
                paths.count = 1;
                error = git_reset_default(thisObject->repository(), headCommit, &paths);
                free(pathStr);
            } else if (isArray(globalObject, pathsArg)) {
                JSArray* arr = jsCast<JSArray*>(pathsArg);
                paths.count = arr->length();
                paths.strings = (char**)malloc(sizeof(char*) * paths.count);
                for (unsigned i = 0; i < arr->length(); i++) {
                    JSValue item = arr->getIndex(globalObject, i);
                    RETURN_IF_EXCEPTION(scope, {});
                    WTF::String path = item.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, {});
                    paths.strings[i] = strdup(path.utf8().data());
                }
                error = git_reset_default(thisObject->repository(), headCommit, &paths);
                for (size_t i = 0; i < paths.count; i++) {
                    free(paths.strings[i]);
                }
                free(paths.strings);
            }
        } else {
            error = git_reset_default(thisObject->repository(), headCommit, nullptr);
        }
    }

    if (headCommit) git_object_free(headCommit);
    if (head) git_reference_free(head);
    git_index_free(index);

    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to reset").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryProtoFunc_commit, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        throwException(globalObject, scope, createError(globalObject, "commit requires a message argument"_s));
        return {};
    }

    WTF::String message = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    git_index* index = nullptr;
    int error = git_repository_index(&index, thisObject->repository());
    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to get index").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    git_oid treeId;
    error = git_index_write_tree(&treeId, index);
    git_index_free(index);

    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to write tree").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    git_tree* tree = nullptr;
    error = git_tree_lookup(&tree, thisObject->repository(), &treeId);
    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to lookup tree").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    git_signature* sig = nullptr;
    error = git_signature_default(&sig, thisObject->repository());
    if (error < 0) {
        git_tree_free(tree);
        return throwGitError(globalObject, scope, "Failed to get signature").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    git_commit* parent = nullptr;
    git_reference* head = nullptr;

    error = git_repository_head(&head, thisObject->repository());
    if (error >= 0) {
        const git_oid* oid = git_reference_target(head);
        if (oid) {
            git_commit_lookup(&parent, thisObject->repository(), oid);
        }
        git_reference_free(head);
    }

    git_oid commitId;
    const git_commit* parents[1] = { parent };
    int parentCount = parent ? 1 : 0;

    error = git_commit_create(&commitId, thisObject->repository(), "HEAD", sig, sig, nullptr, message.utf8().data(), tree, parentCount, parents);

    if (parent) git_commit_free(parent);
    git_tree_free(tree);
    git_signature_free(sig);

    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to create commit").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    git_commit* newCommit = nullptr;
    error = git_commit_lookup(&newCommit, thisObject->repository(), &commitId);
    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to lookup new commit").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSGitCommitStructure();

    JSGitCommit* result = JSGitCommit::create(vm, structure, newCommit, thisObject);
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryProtoFunc_checkout, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        throwException(globalObject, scope, createError(globalObject, "checkout requires a ref argument"_s));
        return {};
    }

    WTF::String ref = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    git_checkout_options opts = GIT_CHECKOUT_OPTIONS_INIT;
    opts.checkout_strategy = GIT_CHECKOUT_SAFE;

    git_object* target = nullptr;
    int error = git_revparse_single(&target, thisObject->repository(), ref.utf8().data());
    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to resolve ref").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    error = git_checkout_tree(thisObject->repository(), target, &opts);
    if (error < 0) {
        git_object_free(target);
        return throwGitError(globalObject, scope, "Failed to checkout").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    WTF::String fullRef = makeString("refs/heads/"_s, ref);
    error = git_repository_set_head(thisObject->repository(), fullRef.utf8().data());

    git_object_free(target);

    if (error < 0) {
        const git_oid* oid = git_object_id(target);
        error = git_repository_set_head_detached(thisObject->repository(), oid);
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsGitRepositoryProtoFunc_fetch, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitRepository* thisObject = jsDynamicCast<JSGitRepository*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Repository object"_s));
        return {};
    }

    WTF::String remoteName = "origin"_s;
    if (callFrame->argumentCount() > 0 && !callFrame->argument(0).isUndefined()) {
        remoteName = callFrame->argument(0).toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    git_remote* remote = nullptr;
    int error = git_remote_lookup(&remote, thisObject->repository(), remoteName.utf8().data());
    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to lookup remote").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    git_fetch_options opts = GIT_FETCH_OPTIONS_INIT;
    error = git_remote_fetch(remote, nullptr, &opts, nullptr);

    git_remote_free(remote);

    if (error < 0) {
        return throwGitError(globalObject, scope, "Failed to fetch").asCell() ? JSValue::encode(jsUndefined()) : JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsUndefined());
}

// ============================================================================
// Global function to create Repository constructor
// ============================================================================

JSC::JSValue createJSGitRepositoryConstructor(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();

    JSGitRepositoryPrototype* prototype = JSGitRepositoryPrototype::create(vm, globalObject, JSGitRepositoryPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));

    auto* constructor = JSGitRepositoryConstructor::create(vm, JSGitRepositoryConstructor::createStructure(vm, globalObject, globalObject->functionPrototype()), prototype);

    JSObject* result = JSC::constructEmptyObject(globalObject);
    result->putDirectIndex(globalObject, 0, constructor);

    return result;
}

} // namespace WebCore
