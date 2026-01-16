#include "root.h"
#include "JSGit.h"

#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/DateInstance.h>

#include "ZigGlobalObject.h"
#include "wtf/text/WTFString.h"

#include <git2.h>

namespace WebCore {
using namespace JSC;

// Helper to convert git_oid to hex string
static WTF::String oidToString(const git_oid* oid)
{
    char hex[GIT_OID_SHA1_HEXSIZE + 1];
    git_oid_tostr(hex, sizeof(hex), oid);
    return WTF::String::fromUTF8(hex, GIT_OID_SHA1_HEXSIZE);
}

// Create signature object
static JSC::JSObject* createSignatureObject(JSC::JSGlobalObject* globalObject, const git_signature* sig)
{
    VM& vm = globalObject->vm();
    JSObject* obj = constructEmptyObject(globalObject);

    obj->putDirect(vm, Identifier::fromString(vm, "name"_s), jsString(vm, WTF::String::fromUTF8(sig->name)));
    obj->putDirect(vm, Identifier::fromString(vm, "email"_s), jsString(vm, WTF::String::fromUTF8(sig->email)));

    double timestamp = static_cast<double>(sig->when.time) * 1000.0;
    obj->putDirect(vm, Identifier::fromString(vm, "date"_s), DateInstance::create(vm, globalObject->dateStructure(), timestamp));

    int offsetMinutes = sig->when.offset;
    int hours = offsetMinutes / 60;
    int mins = abs(offsetMinutes % 60);
    WTF::String timezone = makeString(offsetMinutes >= 0 ? "+"_s : "-"_s,
        hours < 10 ? "0"_s : ""_s, String::number(abs(hours)),
        mins < 10 ? "0"_s : ""_s, String::number(mins));
    obj->putDirect(vm, Identifier::fromString(vm, "timezone"_s), jsString(vm, timezone));

    return obj;
}

// ============================================================================
// Commit Prototype Methods
// ============================================================================

JSC_DECLARE_CUSTOM_GETTER(jsGitCommitGetter_sha);
JSC_DECLARE_CUSTOM_GETTER(jsGitCommitGetter_shortSha);
JSC_DECLARE_CUSTOM_GETTER(jsGitCommitGetter_message);
JSC_DECLARE_CUSTOM_GETTER(jsGitCommitGetter_summary);
JSC_DECLARE_CUSTOM_GETTER(jsGitCommitGetter_author);
JSC_DECLARE_CUSTOM_GETTER(jsGitCommitGetter_committer);
JSC_DECLARE_CUSTOM_GETTER(jsGitCommitGetter_parents);
JSC_DECLARE_CUSTOM_GETTER(jsGitCommitGetter_tree);

JSC_DECLARE_HOST_FUNCTION(jsGitCommitProtoFunc_parent);
JSC_DECLARE_HOST_FUNCTION(jsGitCommitProtoFunc_diff);
JSC_DECLARE_HOST_FUNCTION(jsGitCommitProtoFunc_getFile);
JSC_DECLARE_HOST_FUNCTION(jsGitCommitProtoFunc_listFiles);
JSC_DECLARE_HOST_FUNCTION(jsGitCommitProtoFunc_isAncestorOf);

static const HashTableValue JSGitCommitPrototypeTableValues[] = {
    { "sha"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetter_sha, 0 } },
    { "shortSha"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetter_shortSha, 0 } },
    { "message"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetter_message, 0 } },
    { "summary"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetter_summary, 0 } },
    { "author"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetter_author, 0 } },
    { "committer"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetter_committer, 0 } },
    { "parents"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetter_parents, 0 } },
    { "tree"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsGitCommitGetter_tree, 0 } },
    { "parent"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitCommitProtoFunc_parent, 0 } },
    { "diff"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitCommitProtoFunc_diff, 0 } },
    { "getFile"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitCommitProtoFunc_getFile, 1 } },
    { "listFiles"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitCommitProtoFunc_listFiles, 0 } },
    { "isAncestorOf"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGitCommitProtoFunc_isAncestorOf, 1 } },
};

// ============================================================================
// Commit Prototype Class
// ============================================================================

class JSGitCommitPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSGitCommitPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSGitCommitPrototype* prototype = new (NotNull, allocateCell<JSGitCommitPrototype>(vm)) JSGitCommitPrototype(vm, structure);
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
    JSGitCommitPrototype(JSC::VM& vm, JSC::Structure* structure) : Base(vm, structure) {}
    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        reifyStaticProperties(vm, JSGitCommit::info(), JSGitCommitPrototypeTableValues, *this);
        JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    }
};

const ClassInfo JSGitCommitPrototype::s_info = { "Commit"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGitCommitPrototype) };

// ============================================================================
// Commit Property Getters
// ============================================================================

JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetter_sha, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = jsDynamicCast<JSGitCommit*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Commit object"_s));
        return {};
    }

    const git_oid* oid = git_commit_id(thisObject->commit());
    return JSValue::encode(jsString(vm, oidToString(oid)));
}

JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetter_shortSha, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = jsDynamicCast<JSGitCommit*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Commit object"_s));
        return {};
    }

    const git_oid* oid = git_commit_id(thisObject->commit());
    char hex[8];
    git_oid_tostr(hex, sizeof(hex), oid);
    return JSValue::encode(jsString(vm, WTF::String::fromUTF8(hex, 7)));
}

JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetter_message, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = jsDynamicCast<JSGitCommit*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Commit object"_s));
        return {};
    }

    const char* message = git_commit_message(thisObject->commit());
    return JSValue::encode(jsString(vm, WTF::String::fromUTF8(message)));
}

JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetter_summary, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = jsDynamicCast<JSGitCommit*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Commit object"_s));
        return {};
    }

    const char* summary = git_commit_summary(thisObject->commit());
    return JSValue::encode(jsString(vm, WTF::String::fromUTF8(summary)));
}

JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetter_author, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = jsDynamicCast<JSGitCommit*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Commit object"_s));
        return {};
    }

    const git_signature* sig = git_commit_author(thisObject->commit());
    return JSValue::encode(createSignatureObject(globalObject, sig));
}

JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetter_committer, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = jsDynamicCast<JSGitCommit*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Commit object"_s));
        return {};
    }

    const git_signature* sig = git_commit_committer(thisObject->commit());
    return JSValue::encode(createSignatureObject(globalObject, sig));
}

JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetter_parents, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = jsDynamicCast<JSGitCommit*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Commit object"_s));
        return {};
    }

    unsigned int count = git_commit_parentcount(thisObject->commit());
    JSArray* arr = constructEmptyArray(globalObject, nullptr, count);
    RETURN_IF_EXCEPTION(scope, {});

    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSGitCommitStructure();

    for (unsigned int i = 0; i < count; i++) {
        git_commit* parent = nullptr;
        int error = git_commit_parent(&parent, thisObject->commit(), i);
        if (error >= 0) {
            JSGitCommit* parentObj = JSGitCommit::create(vm, structure, parent, thisObject->repo());
            arr->putDirectIndex(globalObject, i, parentObj);
        }
    }

    return JSValue::encode(arr);
}

JSC_DEFINE_CUSTOM_GETTER(jsGitCommitGetter_tree, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = jsDynamicCast<JSGitCommit*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Commit object"_s));
        return {};
    }

    const git_oid* treeId = git_commit_tree_id(thisObject->commit());
    return JSValue::encode(jsString(vm, oidToString(treeId)));
}

// ============================================================================
// Commit Instance Methods
// ============================================================================

JSC_DEFINE_HOST_FUNCTION(jsGitCommitProtoFunc_parent, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = jsDynamicCast<JSGitCommit*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Commit object"_s));
        return {};
    }

    unsigned int n = 0;
    if (callFrame->argumentCount() > 0 && callFrame->argument(0).isNumber()) {
        n = callFrame->argument(0).toUInt32(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    git_commit* parent = nullptr;
    int error = git_commit_parent(&parent, thisObject->commit(), n);
    if (error < 0) {
        return JSValue::encode(jsNull());
    }

    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSGitCommitStructure();

    JSGitCommit* result = JSGitCommit::create(vm, structure, parent, thisObject->repo());
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsGitCommitProtoFunc_diff, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = jsDynamicCast<JSGitCommit*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Commit object"_s));
        return {};
    }

    git_tree* thisTree = nullptr;
    int error = git_commit_tree(&thisTree, thisObject->commit());
    if (error < 0) {
        throwException(globalObject, scope, createError(globalObject, "Failed to get commit tree"_s));
        return {};
    }

    git_tree* parentTree = nullptr;
    git_commit* parent = nullptr;

    if (callFrame->argumentCount() > 0) {
        JSGitCommit* otherCommit = jsDynamicCast<JSGitCommit*>(callFrame->argument(0));
        if (otherCommit) {
            error = git_commit_tree(&parentTree, otherCommit->commit());
        }
    } else {
        error = git_commit_parent(&parent, thisObject->commit(), 0);
        if (error >= 0) {
            error = git_commit_tree(&parentTree, parent);
        }
    }

    git_diff* diff = nullptr;
    git_diff_options opts = GIT_DIFF_OPTIONS_INIT;

    error = git_diff_tree_to_tree(&diff, thisObject->repo()->repository(), parentTree, thisTree, &opts);

    if (thisTree) git_tree_free(thisTree);
    if (parentTree) git_tree_free(parentTree);
    if (parent) git_commit_free(parent);

    if (error < 0) {
        throwException(globalObject, scope, createError(globalObject, "Failed to create diff"_s));
        return {};
    }

    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSGitDiffStructure();

    JSGitDiff* result = JSGitDiff::create(vm, structure, diff, thisObject->repo());
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsGitCommitProtoFunc_getFile, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = jsDynamicCast<JSGitCommit*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Commit object"_s));
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        throwException(globalObject, scope, createError(globalObject, "getFile requires a path argument"_s));
        return {};
    }

    WTF::String path = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    git_tree* tree = nullptr;
    int error = git_commit_tree(&tree, thisObject->commit());
    if (error < 0) {
        return JSValue::encode(jsNull());
    }

    git_tree_entry* entry = nullptr;
    error = git_tree_entry_bypath(&entry, tree, path.utf8().data());
    git_tree_free(tree);

    if (error < 0) {
        return JSValue::encode(jsNull());
    }

    if (git_tree_entry_type(entry) != GIT_OBJECT_BLOB) {
        git_tree_entry_free(entry);
        return JSValue::encode(jsNull());
    }

    git_blob* blob = nullptr;
    error = git_blob_lookup(&blob, thisObject->repo()->repository(), git_tree_entry_id(entry));
    git_tree_entry_free(entry);

    if (error < 0) {
        return JSValue::encode(jsNull());
    }

    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSGitBlobStructure();

    JSGitBlob* result = JSGitBlob::create(vm, structure, blob, thisObject->repo());
    return JSValue::encode(result);
}

// Tree walk callback data
struct ListFilesData {
    JSC::VM* vm;
    JSC::JSGlobalObject* globalObject;
    JSArray* array;
    unsigned index;
};

static int listFilesCallback(const char* root, const git_tree_entry* entry, void* payload)
{
    ListFilesData* data = static_cast<ListFilesData*>(payload);

    if (git_tree_entry_type(entry) == GIT_OBJECT_BLOB) {
        WTF::String path;
        if (root && root[0]) {
            path = makeString(WTF::String::fromUTF8(root), WTF::String::fromUTF8(git_tree_entry_name(entry)));
        } else {
            path = WTF::String::fromUTF8(git_tree_entry_name(entry));
        }
        data->array->putDirectIndex(data->globalObject, data->index++, jsString(*data->vm, path));
    }

    return 0;
}

JSC_DEFINE_HOST_FUNCTION(jsGitCommitProtoFunc_listFiles, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = jsDynamicCast<JSGitCommit*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Commit object"_s));
        return {};
    }

    git_tree* tree = nullptr;
    int error = git_commit_tree(&tree, thisObject->commit());
    if (error < 0) {
        throwException(globalObject, scope, createError(globalObject, "Failed to get commit tree"_s));
        return {};
    }

    JSArray* arr = constructEmptyArray(globalObject, nullptr);
    RETURN_IF_EXCEPTION(scope, {});

    ListFilesData data = { &vm, globalObject, arr, 0 };
    git_tree_walk(tree, GIT_TREEWALK_PRE, listFilesCallback, &data);

    git_tree_free(tree);

    return JSValue::encode(arr);
}

JSC_DEFINE_HOST_FUNCTION(jsGitCommitProtoFunc_isAncestorOf, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGitCommit* thisObject = jsDynamicCast<JSGitCommit*>(callFrame->thisValue());
    if (!thisObject) {
        throwException(globalObject, scope, createTypeError(globalObject, "Not a Commit object"_s));
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        throwException(globalObject, scope, createError(globalObject, "isAncestorOf requires a commit argument"_s));
        return {};
    }

    const git_oid* ancestorOid = git_commit_id(thisObject->commit());
    git_oid descendantOid;

    JSGitCommit* otherCommit = jsDynamicCast<JSGitCommit*>(callFrame->argument(0));
    if (otherCommit) {
        descendantOid = *git_commit_id(otherCommit->commit());
    } else {
        WTF::String ref = callFrame->argument(0).toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        int error = git_oid_fromstr(&descendantOid, ref.utf8().data());
        if (error < 0) {
            git_object* obj = nullptr;
            error = git_revparse_single(&obj, thisObject->repo()->repository(), ref.utf8().data());
            if (error >= 0) {
                descendantOid = *git_object_id(obj);
                git_object_free(obj);
            } else {
                return JSValue::encode(jsBoolean(false));
            }
        }
    }

    int result = git_graph_descendant_of(thisObject->repo()->repository(), &descendantOid, ancestorOid);
    return JSValue::encode(jsBoolean(result > 0));
}

// ============================================================================
// Global function to create Commit prototype structure
// ============================================================================

JSC::Structure* createJSGitCommitStructure(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();

    JSGitCommitPrototype* prototype = JSGitCommitPrototype::create(vm, globalObject, JSGitCommitPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));

    return JSGitCommit::createStructure(vm, globalObject, prototype);
}

} // namespace WebCore
