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
#include "JSNodeSQLiteStatementSyncPrototype.h"
#include "JSNodeSQLiteStatementSyncConstructor.h"
#include "JSNodeSQLiteDatabaseSync.h"
#include "ZigGlobalObject.h"
#include "BunBuiltinNames.h"
#include "ErrorCode.h"

#include <wtf/text/WTFString.h>

#if LAZY_LOAD_SQLITE
#include "lazy_sqlite3.h"
#else
#include "sqlite3_local.h"
static inline int lazyLoadSQLite()
{
    return 0;
}
#endif

namespace Bun {

using namespace JSC;
using namespace WebCore;

static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncConstructor);

const ClassInfo JSNodeSQLiteStatementSync::s_info = { "StatementSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteStatementSync) };


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

JSNodeSQLiteStatementSync* JSNodeSQLiteStatementSync::create(VM& vm, Structure* structure, JSNodeSQLiteDatabaseSync* database, const String& sql)
{
    JSNodeSQLiteStatementSync* object = new (NotNull, allocateCell<JSNodeSQLiteStatementSync>(vm)) JSNodeSQLiteStatementSync(vm, structure, database);
    object->finishCreation(vm);
    
    // Store the source SQL for the sourceSQL property
    object->m_sourceSQL = sql;
    
    if (lazyLoadSQLite() == 0) {
        CString sqlUTF8 = sql.utf8();
        int result = sqlite3_prepare_v3(database->database(), sqlUTF8.data(), sqlUTF8.length(), 0, &object->m_stmt, nullptr);
        if (result != SQLITE_OK) {
            object->m_stmt = nullptr;
        }
    }
    
    return object;
}

Structure* JSNodeSQLiteStatementSync::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

void setupJSNodeSQLiteStatementSyncClassStructure(LazyClassStructure::Initializer& init)
{
    auto* prototype = JSNodeSQLiteStatementSyncPrototype::create(init.vm, init.global, init.global->objectPrototype());

    auto* constructorStructure = JSNodeSQLiteStatementSyncConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSNodeSQLiteStatementSyncConstructor::create(init.vm, init.global, constructorStructure, prototype);

    auto* structure = JSNodeSQLiteStatementSync::createStructure(init.vm, init.global, prototype);
    structure->setMayBePrototype(true);
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


} // namespace Bun