#include "root.h"
#include "JSGit.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSCJSValueInlines.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "wtf/text/WTFString.h"
#include "helpers.h"
#include <git2.h>

namespace Bun {
using namespace JSC;

// ============================================================================
// JSGitCommit Implementation
// ============================================================================

const ClassInfo JSGitCommit::s_info = { "Commit"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitCommit) };

JSGitCommit::~JSGitCommit()
{
    if (m_commit) {
        git_commit_free(m_commit);
        m_commit = nullptr;
    }
}

void JSGitCommit::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
}

template<typename Visitor>
void JSGitCommit::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<JSGitCommit*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_repo);
}

DEFINE_VISIT_CHILDREN(JSGitCommit);

JSC::GCClient::IsoSubspace* JSGitCommit::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSGitCommit, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSGitCommit.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSGitCommit = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSGitCommit.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSGitCommit = std::forward<decltype(space)>(space); });
}

// Helper to format OID as hex string
static WTF::String oidToString(const git_oid* oid)
{
    char buf[GIT_OID_SHA1_HEXSIZE + 1];
    git_oid_tostr(buf, sizeof(buf), oid);
    return WTF::String::fromUTF8(buf);
}

// Getter: sha
JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetter_sha, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitCommit*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Commit"_s, "sha"_s);
        return {};
    }

    const git_oid* oid = git_commit_id(thisObject->commit());
    return JSValue::encode(jsString(vm, oidToString(oid)));
}

// Getter: shortSha
JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetter_shortSha, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitCommit*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Commit"_s, "shortSha"_s);
        return {};
    }

    const git_oid* oid = git_commit_id(thisObject->commit());
    char buf[8];
    git_oid_tostr(buf, sizeof(buf), oid);
    return JSValue::encode(jsString(vm, WTF::String::fromUTF8(buf)));
}

// Getter: message
JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetter_message, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitCommit*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Commit"_s, "message"_s);
        return {};
    }

    const char* message = git_commit_message(thisObject->commit());
    return JSValue::encode(jsString(vm, WTF::String::fromUTF8(message ? message : "")));
}

// Getter: summary
JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetter_summary, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitCommit*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Commit"_s, "summary"_s);
        return {};
    }

    const char* summary = git_commit_summary(thisObject->commit());
    return JSValue::encode(jsString(vm, WTF::String::fromUTF8(summary ? summary : "")));
}

// Getter: author
JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetter_author, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    auto* thisObject = jsDynamicCast<JSGitCommit*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*lexicalGlobalObject, scope, "Commit"_s, "author"_s);
        return {};
    }

    const git_signature* author = git_commit_author(thisObject->commit());
    auto* structure = globalObject->JSGitSignatureStructure();
    return JSValue::encode(JSGitSignature::create(vm, lexicalGlobalObject, structure, author));
}

// Getter: committer
JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetter_committer, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    auto* thisObject = jsDynamicCast<JSGitCommit*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*lexicalGlobalObject, scope, "Commit"_s, "committer"_s);
        return {};
    }

    const git_signature* committer = git_commit_committer(thisObject->commit());
    auto* structure = globalObject->JSGitSignatureStructure();
    return JSValue::encode(JSGitSignature::create(vm, lexicalGlobalObject, structure, committer));
}

// Getter: tree
JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetter_tree, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitCommit*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Commit"_s, "tree"_s);
        return {};
    }

    const git_oid* treeId = git_commit_tree_id(thisObject->commit());
    return JSValue::encode(jsString(vm, oidToString(treeId)));
}

// Getter: parents
JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetter_parents, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    auto* thisObject = jsDynamicCast<JSGitCommit*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*lexicalGlobalObject, scope, "Commit"_s, "parents"_s);
        return {};
    }

    unsigned int parentCount = git_commit_parentcount(thisObject->commit());
    JSArray* result = constructEmptyArray(lexicalGlobalObject, nullptr, parentCount);
    RETURN_IF_EXCEPTION(scope, {});

    for (unsigned int i = 0; i < parentCount; i++) {
        git_commit* parent = nullptr;
        int error = git_commit_parent(&parent, thisObject->commit(), i);
        if (error < 0) {
            const git_error* err = git_error_last();
            throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, WTF::String::fromUTF8(err ? err->message : "Failed to get parent commit")));
            return {};
        }

        auto* structure = globalObject->JSGitCommitStructure();
        result->putDirectIndex(lexicalGlobalObject, i, JSGitCommit::create(vm, lexicalGlobalObject, structure, parent, thisObject->repository()));
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSValue::encode(result);
}

// Method: parent(n?) -> Commit | null
JSC_DEFINE_HOST_FUNCTION(jsGitCommitProtoFunc_parent, (JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    auto* thisObject = jsDynamicCast<JSGitCommit*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*lexicalGlobalObject, scope, "Commit"_s, "parent"_s);
        return {};
    }

    unsigned int n = 0;
    if (callFrame->argumentCount() > 0 && !callFrame->argument(0).isUndefined()) {
        n = callFrame->argument(0).toUInt32(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    git_commit* parent = nullptr;
    int error = git_commit_parent(&parent, thisObject->commit(), n);
    if (error < 0) {
        if (error == GIT_ENOTFOUND) {
            return JSValue::encode(jsNull());
        }
        const git_error* err = git_error_last();
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, WTF::String::fromUTF8(err ? err->message : "Failed to get parent commit")));
        return {};
    }

    auto* structure = globalObject->JSGitCommitStructure();
    return JSValue::encode(JSGitCommit::create(vm, lexicalGlobalObject, structure, parent, thisObject->repository()));
}

// Method: isAncestorOf(other: Commit | string) -> boolean
JSC_DEFINE_HOST_FUNCTION(jsGitCommitProtoFunc_isAncestorOf, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitCommit*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Commit"_s, "isAncestorOf"_s);
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        throwException(globalObject, scope, createError(globalObject, "isAncestorOf requires a commit argument"_s));
        return {};
    }

    const git_oid* ancestorOid = git_commit_id(thisObject->commit());
    git_oid descendantOid;

    JSValue otherArg = callFrame->argument(0);
    if (auto* otherCommit = jsDynamicCast<JSGitCommit*>(otherArg)) {
        git_oid_cpy(&descendantOid, git_commit_id(otherCommit->commit()));
    } else {
        auto refString = otherArg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        git_object* obj = nullptr;
        int error = git_revparse_single(&obj, thisObject->repository()->repo(), refString.utf8().data());
        if (error < 0) {
            const git_error* err = git_error_last();
            throwException(globalObject, scope, createError(globalObject, WTF::String::fromUTF8(err ? err->message : "Invalid ref")));
            return {};
        }
        git_oid_cpy(&descendantOid, git_object_id(obj));
        git_object_free(obj);
    }

    int result = git_graph_descendant_of(thisObject->repository()->repo(), &descendantOid, ancestorOid);
    if (result < 0) {
        const git_error* err = git_error_last();
        throwException(globalObject, scope, createError(globalObject, WTF::String::fromUTF8(err ? err->message : "Failed to check ancestry")));
        return {};
    }

    return JSValue::encode(jsBoolean(result == 1));
}

// ============================================================================
// JSGitCommit Prototype Table
// ============================================================================

static const HashTableValue JSGitCommitPrototypeTableValues[] = {
    { "sha"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetter_sha, 0 } },
    { "shortSha"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetter_shortSha, 0 } },
    { "message"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetter_message, 0 } },
    { "summary"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetter_summary, 0 } },
    { "author"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetter_author, 0 } },
    { "committer"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetter_committer, 0 } },
    { "tree"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetter_tree, 0 } },
    { "parents"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetter_parents, 0 } },
    { "parent"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitCommitProtoFunc_parent, 0 } },
    { "isAncestorOf"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitCommitProtoFunc_isAncestorOf, 1 } },
};

// ============================================================================
// JSGitCommitPrototype Implementation
// ============================================================================

const ClassInfo JSGitCommitPrototype::s_info = { "Commit"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitCommitPrototype) };

void JSGitCommitPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSGitCommit::info(), JSGitCommitPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// ============================================================================
// JSGitCommitConstructor Implementation
// ============================================================================

const ClassInfo JSGitCommitConstructor::s_info = { "Commit"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitCommitConstructor) };

JSGitCommitConstructor* JSGitCommitConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSGitCommitPrototype* prototype)
{
    JSGitCommitConstructor* constructor = new (NotNull, allocateCell<JSGitCommitConstructor>(vm)) JSGitCommitConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

void JSGitCommitConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSGitCommitPrototype* prototype)
{
    Base::finishCreation(vm, 0, "Commit"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSGitCommitConstructor::construct(JSGlobalObject* globalObject, CallFrame*)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwException(globalObject, scope, createTypeError(globalObject, "Commit cannot be directly constructed"_s));
    return {};
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSGitCommitConstructor::call(JSGlobalObject* globalObject, CallFrame*)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwException(globalObject, scope, createTypeError(globalObject, "Commit cannot be called as a function"_s));
    return {};
}

// ============================================================================
// Class Structure Initialization
// ============================================================================

void initJSGitCommitClassStructure(LazyClassStructure::Initializer& init)
{
    auto* prototype = JSGitCommitPrototype::create(init.vm, init.global, JSGitCommitPrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
    auto* structure = JSGitCommit::createStructure(init.vm, init.global, prototype);
    auto* constructor = JSGitCommitConstructor::create(init.vm, init.global, JSGitCommitConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
