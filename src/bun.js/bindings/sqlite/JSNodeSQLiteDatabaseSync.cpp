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
#include "JSNodeSQLiteDatabaseSyncPrototype.h"
#include "JSNodeSQLiteDatabaseSyncConstructor.h"
#include "JSNodeSQLiteStatementSync.h"
#include "ZigGlobalObject.h"
#include "BunBuiltinNames.h"
#include "ErrorCode.h"

#include "sqlite3_local.h"
#include <wtf/text/WTFString.h>

namespace Bun {

using namespace JSC;
using namespace WebCore;

const ClassInfo JSNodeSQLiteDatabaseSync::s_info = { "DatabaseSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteDatabaseSync) };


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
    , m_path()
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
    auto* constructor = JSNodeSQLiteDatabaseSyncConstructor::create(init.vm, init.global, constructorStructure, prototype);

    auto* structure = JSNodeSQLiteDatabaseSync::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}



} // namespace Bun