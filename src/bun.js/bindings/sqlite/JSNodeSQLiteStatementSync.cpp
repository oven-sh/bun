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

#include "JSNodeSQLiteStatementSync.h"
#include "JSNodeSQLiteDatabaseSync.h"
#include "ZigGlobalObject.h"
#include "BunBuiltinNames.h"
#include "ErrorCode.h"

#include "sqlite3_local.h"
#include <wtf/text/WTFString.h>

namespace Bun {

using namespace JSC;
using namespace WebCore;

static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncConstructor);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncRun);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncGet);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncAll);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncIterate);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncFinalize);

const ClassInfo JSNodeSQLiteStatementSync::s_info = { "StatementSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteStatementSync) };

static const HashTableValue JSNodeSQLiteStatementSyncPrototypeTableValues[] = {
    { "run"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncRun, 0 } },
    { "get"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncGet, 0 } },
    { "all"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncAll, 0 } },
    { "iterate"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncIterate, 0 } },
    { "finalize"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncFinalize, 0 } },
};

class JSNodeSQLiteStatementSyncPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSNodeSQLiteStatementSyncPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSNodeSQLiteStatementSyncPrototype* prototype = new (NotNull, allocateCell<JSNodeSQLiteStatementSyncPrototype>(vm)) JSNodeSQLiteStatementSyncPrototype(vm, structure);
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
    JSNodeSQLiteStatementSyncPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm);
};

const ClassInfo JSNodeSQLiteStatementSyncPrototype::s_info = { "StatementSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteStatementSyncPrototype) };

void JSNodeSQLiteStatementSyncPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSNodeSQLiteStatementSync::info(), JSNodeSQLiteStatementSyncPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

class JSNodeSQLiteStatementSyncConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSNodeSQLiteStatementSyncConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSNodeSQLiteStatementSyncConstructor* constructor = new (NotNull, JSC::allocateCell<JSNodeSQLiteStatementSyncConstructor>(vm)) JSNodeSQLiteStatementSyncConstructor(vm, structure);
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
    JSNodeSQLiteStatementSyncConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, jsNodeSQLiteStatementSyncConstructor, jsNodeSQLiteStatementSyncConstructor)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
    {
        Base::finishCreation(vm, 2, "StatementSync"_s);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    }
};

const ClassInfo JSNodeSQLiteStatementSyncConstructor::s_info = { "StatementSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteStatementSyncConstructor) };

void JSNodeSQLiteStatementSync::destroy(JSC::JSCell* cell)
{
    JSNodeSQLiteStatementSync* thisObject = static_cast<JSNodeSQLiteStatementSync*>(cell);
    thisObject->JSNodeSQLiteStatementSync::~JSNodeSQLiteStatementSync();
}

template<typename Visitor>
void JSNodeSQLiteStatementSync::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSNodeSQLiteStatementSync* thisObject = jsCast<JSNodeSQLiteStatementSync*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_database);
}

DEFINE_VISIT_CHILDREN(JSNodeSQLiteStatementSync);

template<typename MyClassT, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSNodeSQLiteStatementSync::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<MyClassT, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSNodeSQLiteStatementSync.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSNodeSQLiteStatementSync = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSNodeSQLiteStatementSync.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSNodeSQLiteStatementSync = std::forward<decltype(space)>(space); });
}

JSNodeSQLiteStatementSync::JSNodeSQLiteStatementSync(VM& vm, Structure* structure, JSNodeSQLiteDatabaseSync* database)
    : Base(vm, structure)
    , m_stmt(nullptr)
    , m_database(vm, this, database)
{
}

void JSNodeSQLiteStatementSync::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSNodeSQLiteStatementSync::~JSNodeSQLiteStatementSync()
{
    finalizeStatement();
}

void JSNodeSQLiteStatementSync::finalizeStatement()
{
    if (m_stmt) {
        sqlite3_finalize(m_stmt);
        m_stmt = nullptr;
    }
}

JSNodeSQLiteStatementSync* JSNodeSQLiteStatementSync::create(VM& vm, Structure* structure, JSNodeSQLiteDatabaseSync* database)
{
    JSNodeSQLiteStatementSync* object = new (NotNull, allocateCell<JSNodeSQLiteStatementSync>(vm)) JSNodeSQLiteStatementSync(vm, structure, database);
    object->finishCreation(vm);
    return object;
}

Structure* JSNodeSQLiteStatementSync::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

void setupJSNodeSQLiteStatementSyncClassStructure(LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSNodeSQLiteStatementSyncPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSNodeSQLiteStatementSyncPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSNodeSQLiteStatementSyncConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSNodeSQLiteStatementSyncConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSNodeSQLiteStatementSync::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteStatementSyncConstructor, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!callFrame->newTarget()) {
        throwTypeError(globalObject, scope, "Class constructor StatementSync cannot be invoked without 'new'"_s);
        return {};
    }

    throwTypeError(globalObject, scope, "StatementSync cannot be constructed directly"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncRun, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteStatementSync* thisObject = jsDynamicCast<JSNodeSQLiteStatementSync*>(callFrame->thisValue());
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Method StatementSync.prototype.run called on incompatible receiver"_s);
        return {};
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncGet, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteStatementSync* thisObject = jsDynamicCast<JSNodeSQLiteStatementSync*>(callFrame->thisValue());
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Method StatementSync.prototype.get called on incompatible receiver"_s);
        return {};
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncAll, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteStatementSync* thisObject = jsDynamicCast<JSNodeSQLiteStatementSync*>(callFrame->thisValue());
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Method StatementSync.prototype.all called on incompatible receiver"_s);
        return {};
    }

    return JSValue::encode(JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithUndecided), 0));
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncIterate, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteStatementSync* thisObject = jsDynamicCast<JSNodeSQLiteStatementSync*>(callFrame->thisValue());
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Method StatementSync.prototype.iterate called on incompatible receiver"_s);
        return {};
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncFinalize, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteStatementSync* thisObject = jsDynamicCast<JSNodeSQLiteStatementSync*>(callFrame->thisValue());
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Method StatementSync.prototype.finalize called on incompatible receiver"_s);
        return {};
    }

    thisObject->finalizeStatement();

    return JSValue::encode(jsUndefined());
}

} // namespace Bun