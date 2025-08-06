#include "root.h"

#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/JSBigInt.h"
#include "JavaScriptCore/Structure.h"
#include "JavaScriptCore/ThrowScope.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "JavaScriptCore/JSType.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/HeapAnalyzer.h"
#include "JavaScriptCore/JSDestructibleObjectHeapCellType.h"
#include "JavaScriptCore/SlotVisitorMacros.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/SubspaceInlines.h"
#include "JavaScriptCore/PropertyNameArray.h"
#include "JavaScriptCore/ObjectPrototype.h"

#include "JSNodeSQLiteDatabaseSync.h"
#include "JSNodeSQLiteStatementSync.h"
#include "ZigGlobalObject.h"
#include "BunBuiltinNames.h"
#include "ErrorCode.h"

#include "sqlite3_local.h"
#include <wtf/text/WTFString.h>

namespace Bun {

using namespace JSC;
using namespace WebCore;

static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncConstructor);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncOpen);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncClose);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncExec);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncPrepare);

static JSC_DECLARE_CUSTOM_GETTER(jsNodeSQLiteDatabaseSyncGetter_isOpen);
static JSC_DECLARE_CUSTOM_GETTER(jsNodeSQLiteDatabaseSyncGetter_inTransaction);

const ClassInfo JSNodeSQLiteDatabaseSync::s_info = { "DatabaseSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteDatabaseSync) };

static const HashTableValue JSNodeSQLiteDatabaseSyncPrototypeTableValues[] = {
    { "open"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteDatabaseSyncProtoFuncOpen, 0 } },
    { "close"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteDatabaseSyncProtoFuncClose, 0 } },
    { "exec"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteDatabaseSyncProtoFuncExec, 1 } },
    { "prepare"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteDatabaseSyncProtoFuncPrepare, 1 } },
    { "open"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodeSQLiteDatabaseSyncGetter_isOpen, 0 } },
    { "inTransaction"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodeSQLiteDatabaseSyncGetter_inTransaction, 0 } },
};

class JSNodeSQLiteDatabaseSyncPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSNodeSQLiteDatabaseSyncPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSNodeSQLiteDatabaseSyncPrototype* prototype = new (NotNull, allocateCell<JSNodeSQLiteDatabaseSyncPrototype>(vm)) JSNodeSQLiteDatabaseSyncPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    template<typename, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSNodeSQLiteDatabaseSyncPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm);
};

const ClassInfo JSNodeSQLiteDatabaseSyncPrototype::s_info = { "DatabaseSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteDatabaseSyncPrototype) };

void JSNodeSQLiteDatabaseSyncPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSNodeSQLiteDatabaseSync::info(), JSNodeSQLiteDatabaseSyncPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

class JSNodeSQLiteDatabaseSyncConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSNodeSQLiteDatabaseSyncConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSNodeSQLiteDatabaseSyncConstructor* constructor = new (NotNull, JSC::allocateCell<JSNodeSQLiteDatabaseSyncConstructor>(vm)) JSNodeSQLiteDatabaseSyncConstructor(vm, structure);
        constructor->finishCreation(vm, prototype);
        return constructor;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSNodeSQLiteDatabaseSyncConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, jsNodeSQLiteDatabaseSyncConstructor, jsNodeSQLiteDatabaseSyncConstructor)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
    {
        Base::finishCreation(vm, 1, "DatabaseSync"_s);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    }
};

const ClassInfo JSNodeSQLiteDatabaseSyncConstructor::s_info = { "DatabaseSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteDatabaseSyncConstructor) };

void JSNodeSQLiteDatabaseSync::destroy(JSC::JSCell* cell)
{
    JSNodeSQLiteDatabaseSync* thisObject = static_cast<JSNodeSQLiteDatabaseSync*>(cell);
    thisObject->JSNodeSQLiteDatabaseSync::~JSNodeSQLiteDatabaseSync();
}

template<typename Visitor>
void JSNodeSQLiteDatabaseSync::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSNodeSQLiteDatabaseSync* thisObject = jsCast<JSNodeSQLiteDatabaseSync*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(JSNodeSQLiteDatabaseSync);

template<typename MyClassT, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSNodeSQLiteDatabaseSync::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<MyClassT, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSNodeSQLiteDatabaseSync.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSNodeSQLiteDatabaseSync = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSNodeSQLiteDatabaseSync.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSNodeSQLiteDatabaseSync = std::forward<decltype(space)>(space); });
}

JSNodeSQLiteDatabaseSync::JSNodeSQLiteDatabaseSync(VM& vm, Structure* structure)
    : Base(vm, structure)
    , m_db(nullptr)
{
}

void JSNodeSQLiteDatabaseSync::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSNodeSQLiteDatabaseSync::~JSNodeSQLiteDatabaseSync()
{
    closeDatabase();
}

void JSNodeSQLiteDatabaseSync::closeDatabase()
{
    if (m_db) {
        sqlite3_close(m_db);
        m_db = nullptr;
    }
}

JSNodeSQLiteDatabaseSync* JSNodeSQLiteDatabaseSync::create(VM& vm, Structure* structure)
{
    JSNodeSQLiteDatabaseSync* object = new (NotNull, allocateCell<JSNodeSQLiteDatabaseSync>(vm)) JSNodeSQLiteDatabaseSync(vm, structure);
    object->finishCreation(vm);
    return object;
}

Structure* JSNodeSQLiteDatabaseSync::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

void setupJSNodeSQLiteDatabaseSyncClassStructure(LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSNodeSQLiteDatabaseSyncPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSNodeSQLiteDatabaseSyncPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSNodeSQLiteDatabaseSyncConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSNodeSQLiteDatabaseSyncConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSNodeSQLiteDatabaseSync::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncConstructor, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!callFrame->newTarget()) {
        throwTypeError(globalObject, scope, "Class constructor DatabaseSync cannot be invoked without 'new'"_s);
        return {};
    }

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    Structure* structure = zigGlobalObject->JSNodeSQLiteDatabaseSyncStructure();

    JSValue newTarget = callFrame->newTarget();
    if (zigGlobalObject->JSNodeSQLiteDatabaseSyncConstructor() != newTarget) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(), functionGlobalObject->JSNodeSQLiteDatabaseSyncStructure());
        RETURN_IF_EXCEPTION(scope, {});
    }

    auto* object = JSNodeSQLiteDatabaseSync::create(vm, structure);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(object);
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncOpen, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteDatabaseSync* thisObject = jsDynamicCast<JSNodeSQLiteDatabaseSync*>(callFrame->thisValue());
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Method DatabaseSync.prototype.open called on incompatible receiver"_s);
        return {};
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncClose, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteDatabaseSync* thisObject = jsDynamicCast<JSNodeSQLiteDatabaseSync*>(callFrame->thisValue());
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Method DatabaseSync.prototype.close called on incompatible receiver"_s);
        return {};
    }

    thisObject->closeDatabase();

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncExec, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteDatabaseSync* thisObject = jsDynamicCast<JSNodeSQLiteDatabaseSync*>(callFrame->thisValue());
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Method DatabaseSync.prototype.exec called on incompatible receiver"_s);
        return {};
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncPrepare, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteDatabaseSync* thisObject = jsDynamicCast<JSNodeSQLiteDatabaseSync*>(callFrame->thisValue());
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Method DatabaseSync.prototype.prepare called on incompatible receiver"_s);
        return {};
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeSQLiteDatabaseSyncGetter_isOpen, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteDatabaseSync* thisObject = jsDynamicCast<JSNodeSQLiteDatabaseSync*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Property DatabaseSync.prototype.open called on incompatible receiver"_s);
        return {};
    }

    return JSValue::encode(jsBoolean(thisObject->database() != nullptr));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeSQLiteDatabaseSyncGetter_inTransaction, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteDatabaseSync* thisObject = jsDynamicCast<JSNodeSQLiteDatabaseSync*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Property DatabaseSync.prototype.inTransaction called on incompatible receiver"_s);
        return {};
    }

    bool inTransaction = false;
    if (thisObject->database()) {
        inTransaction = !sqlite3_get_autocommit(thisObject->database());
    }

    return JSValue::encode(jsBoolean(inTransaction));
}

} // namespace Bun