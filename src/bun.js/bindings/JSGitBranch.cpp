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
// JSGitBranch Implementation
// ============================================================================

const ClassInfo JSGitBranch::s_info = { "Branch"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitBranch) };

JSGitBranch::~JSGitBranch()
{
    if (m_ref) {
        git_reference_free(m_ref);
        m_ref = nullptr;
    }
}

void JSGitBranch::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
}

template<typename Visitor>
void JSGitBranch::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<JSGitBranch*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_repo);
}

DEFINE_VISIT_CHILDREN(JSGitBranch);

JSC::GCClient::IsoSubspace* JSGitBranch::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSGitBranch, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSGitBranch.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSGitBranch = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSGitBranch.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSGitBranch = std::forward<decltype(space)>(space); });
}

// Getter: name
JSC_DEFINE_CUSTOM_GETTER(jsGitBranchGetter_name, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitBranch*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Branch"_s, "name"_s);
        return {};
    }

    const char* name = nullptr;
    int error = git_branch_name(&name, thisObject->ref());
    if (error < 0 || !name) {
        return JSValue::encode(jsNull());
    }
    return JSValue::encode(jsString(vm, WTF::String::fromUTF8(name)));
}

// Getter: fullName
JSC_DEFINE_CUSTOM_GETTER(jsGitBranchGetter_fullName, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitBranch*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Branch"_s, "fullName"_s);
        return {};
    }

    const char* name = git_reference_name(thisObject->ref());
    return JSValue::encode(jsString(vm, WTF::String::fromUTF8(name ? name : "")));
}

// Getter: isRemote
JSC_DEFINE_CUSTOM_GETTER(jsGitBranchGetter_isRemote, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitBranch*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Branch"_s, "isRemote"_s);
        return {};
    }

    return JSValue::encode(jsBoolean(thisObject->isRemote()));
}

// Getter: isHead
JSC_DEFINE_CUSTOM_GETTER(jsGitBranchGetter_isHead, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitBranch*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Branch"_s, "isHead"_s);
        return {};
    }

    return JSValue::encode(jsBoolean(git_branch_is_head(thisObject->ref())));
}

// Getter: commit
JSC_DEFINE_CUSTOM_GETTER(jsGitBranchGetter_commit, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    auto* thisObject = jsDynamicCast<JSGitBranch*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*lexicalGlobalObject, scope, "Branch"_s, "commit"_s);
        return {};
    }

    const git_oid* oid = git_reference_target(thisObject->ref());
    if (!oid) {
        // Symbolic reference, need to resolve
        git_reference* resolved = nullptr;
        int error = git_reference_resolve(&resolved, thisObject->ref());
        if (error < 0) {
            const git_error* err = git_error_last();
            throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, WTF::String::fromUTF8(err ? err->message : "Failed to resolve branch")));
            return {};
        }
        oid = git_reference_target(resolved);
        git_reference_free(resolved);
    }

    git_commit* commit = nullptr;
    int error = git_commit_lookup(&commit, thisObject->repository()->repo(), oid);
    if (error < 0) {
        const git_error* err = git_error_last();
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, WTF::String::fromUTF8(err ? err->message : "Failed to get commit")));
        return {};
    }

    auto* structure = globalObject->JSGitCommitStructure();
    return JSValue::encode(JSGitCommit::create(vm, lexicalGlobalObject, structure, commit, thisObject->repository()));
}

// Getter: upstream
JSC_DEFINE_CUSTOM_GETTER(jsGitBranchGetter_upstream, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    auto* thisObject = jsDynamicCast<JSGitBranch*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*lexicalGlobalObject, scope, "Branch"_s, "upstream"_s);
        return {};
    }

    git_reference* upstream = nullptr;
    int error = git_branch_upstream(&upstream, thisObject->ref());
    if (error < 0) {
        if (error == GIT_ENOTFOUND) {
            return JSValue::encode(jsNull());
        }
        const git_error* err = git_error_last();
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, WTF::String::fromUTF8(err ? err->message : "Failed to get upstream")));
        return {};
    }

    auto* structure = globalObject->JSGitBranchStructure();
    return JSValue::encode(JSGitBranch::create(vm, lexicalGlobalObject, structure, upstream, thisObject->repository(), true));
}

// Getter: ahead
JSC_DEFINE_CUSTOM_GETTER(jsGitBranchGetter_ahead, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitBranch*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Branch"_s, "ahead"_s);
        return {};
    }

    git_reference* upstream = nullptr;
    int error = git_branch_upstream(&upstream, thisObject->ref());
    if (error < 0) {
        return JSValue::encode(jsNumber(0));
    }

    size_t ahead = 0, behind = 0;
    const git_oid* localOid = git_reference_target(thisObject->ref());
    const git_oid* upstreamOid = git_reference_target(upstream);

    if (localOid && upstreamOid) {
        git_graph_ahead_behind(&ahead, &behind, thisObject->repository()->repo(), localOid, upstreamOid);
    }

    git_reference_free(upstream);
    return JSValue::encode(jsNumber(ahead));
}

// Getter: behind
JSC_DEFINE_CUSTOM_GETTER(jsGitBranchGetter_behind, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitBranch*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Branch"_s, "behind"_s);
        return {};
    }

    git_reference* upstream = nullptr;
    int error = git_branch_upstream(&upstream, thisObject->ref());
    if (error < 0) {
        return JSValue::encode(jsNumber(0));
    }

    size_t ahead = 0, behind = 0;
    const git_oid* localOid = git_reference_target(thisObject->ref());
    const git_oid* upstreamOid = git_reference_target(upstream);

    if (localOid && upstreamOid) {
        git_graph_ahead_behind(&ahead, &behind, thisObject->repository()->repo(), localOid, upstreamOid);
    }

    git_reference_free(upstream);
    return JSValue::encode(jsNumber(behind));
}

// Method: delete(force?)
JSC_DEFINE_HOST_FUNCTION(jsGitBranchProtoFunc_delete, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitBranch*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Branch"_s, "delete"_s);
        return {};
    }

    int error = git_branch_delete(thisObject->ref());
    if (error < 0) {
        const git_error* err = git_error_last();
        throwException(globalObject, scope, createError(globalObject, WTF::String::fromUTF8(err ? err->message : "Failed to delete branch")));
        return {};
    }

    return JSValue::encode(jsUndefined());
}

// Method: rename(newName: string)
JSC_DEFINE_HOST_FUNCTION(jsGitBranchProtoFunc_rename, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSGitBranch*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        throwThisTypeError(*globalObject, scope, "Branch"_s, "rename"_s);
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        throwException(globalObject, scope, createError(globalObject, "rename requires a newName argument"_s));
        return {};
    }

    auto newName = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    git_reference* newRef = nullptr;
    int error = git_branch_move(&newRef, thisObject->ref(), newName.utf8().data(), 0);
    if (error < 0) {
        const git_error* err = git_error_last();
        throwException(globalObject, scope, createError(globalObject, WTF::String::fromUTF8(err ? err->message : "Failed to rename branch")));
        return {};
    }

    git_reference_free(newRef);
    return JSValue::encode(jsUndefined());
}

// ============================================================================
// JSGitBranch Prototype Table
// ============================================================================

static const HashTableValue JSGitBranchPrototypeTableValues[] = {
    { "name"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitBranchGetter_name, 0 } },
    { "fullName"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitBranchGetter_fullName, 0 } },
    { "isRemote"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitBranchGetter_isRemote, 0 } },
    { "isHead"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitBranchGetter_isHead, 0 } },
    { "commit"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitBranchGetter_commit, 0 } },
    { "upstream"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitBranchGetter_upstream, 0 } },
    { "ahead"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitBranchGetter_ahead, 0 } },
    { "behind"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitBranchGetter_behind, 0 } },
    { "delete"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitBranchProtoFunc_delete, 0 } },
    { "rename"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitBranchProtoFunc_rename, 1 } },
};

// ============================================================================
// JSGitBranchPrototype Implementation
// ============================================================================

const ClassInfo JSGitBranchPrototype::s_info = { "Branch"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitBranchPrototype) };

void JSGitBranchPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSGitBranch::info(), JSGitBranchPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// ============================================================================
// JSGitBranchConstructor Implementation
// ============================================================================

const ClassInfo JSGitBranchConstructor::s_info = { "Branch"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitBranchConstructor) };

JSGitBranchConstructor* JSGitBranchConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSGitBranchPrototype* prototype)
{
    JSGitBranchConstructor* constructor = new (NotNull, allocateCell<JSGitBranchConstructor>(vm)) JSGitBranchConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

void JSGitBranchConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSGitBranchPrototype* prototype)
{
    Base::finishCreation(vm, 0, "Branch"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSGitBranchConstructor::construct(JSGlobalObject* globalObject, CallFrame*)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwException(globalObject, scope, createTypeError(globalObject, "Branch cannot be directly constructed"_s));
    return {};
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSGitBranchConstructor::call(JSGlobalObject* globalObject, CallFrame*)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwException(globalObject, scope, createTypeError(globalObject, "Branch cannot be called as a function"_s));
    return {};
}

// ============================================================================
// Class Structure Initialization
// ============================================================================

void initJSGitBranchClassStructure(LazyClassStructure::Initializer& init)
{
    auto* prototype = JSGitBranchPrototype::create(init.vm, init.global, JSGitBranchPrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
    auto* structure = JSGitBranch::createStructure(init.vm, init.global, prototype);
    auto* constructor = JSGitBranchConstructor::create(init.vm, init.global, JSGitBranchConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
