#include "root.h"

#include "JSNodeSQLiteDatabaseSyncConstructor.h"
#include "JSNodeSQLiteDatabaseSync.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/text/WTFString.h>

#include "sqlite3_local.h"

#if LAZY_LOAD_SQLITE
#include "lazy_sqlite3.h"
#else
static inline int lazyLoadSQLite()
{
    return 0;
}
#endif

namespace Bun {

using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(nodeSQLiteDatabaseSyncConstructorCall);
static JSC_DECLARE_HOST_FUNCTION(nodeSQLiteDatabaseSyncConstructorConstruct);

const ClassInfo JSNodeSQLiteDatabaseSyncConstructor::s_info = { "DatabaseSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteDatabaseSyncConstructor) };

JSNodeSQLiteDatabaseSyncConstructor::JSNodeSQLiteDatabaseSyncConstructor(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure, nodeSQLiteDatabaseSyncConstructorCall, nodeSQLiteDatabaseSyncConstructorConstruct)
{
}

JSNodeSQLiteDatabaseSyncConstructor* JSNodeSQLiteDatabaseSyncConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* prototype)
{
    JSNodeSQLiteDatabaseSyncConstructor* constructor = new (NotNull, allocateCell<JSNodeSQLiteDatabaseSyncConstructor>(vm)) JSNodeSQLiteDatabaseSyncConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

void JSNodeSQLiteDatabaseSyncConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
{
    Base::finishCreation(vm, 1, "DatabaseSync"_s, PropertyAdditionMode::WithStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
}

JSC_DEFINE_HOST_FUNCTION(nodeSQLiteDatabaseSyncConstructorCall, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // DatabaseSync() called as function is not allowed
    throwTypeError(globalObject, scope, "Class constructor DatabaseSync cannot be invoked without 'new'"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(nodeSQLiteDatabaseSyncConstructorConstruct, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (lazyLoadSQLite() != 0) {
        throwVMError(globalObject, scope, createError(globalObject, "Failed to load SQLite"_s));
        return {};
    }

    // Get the database path from the first argument
    JSValue pathValue = callFrame->argument(0);
    if (pathValue.isUndefined()) {
        throwVMError(globalObject, scope, createError(globalObject, "Database path is required"_s));
        return {};
    }

    String databasePath = pathValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto* structure = zigGlobalObject->m_JSNodeSQLiteDatabaseSyncClassStructure.get(zigGlobalObject);
    
    JSNodeSQLiteDatabaseSync* thisObject = JSNodeSQLiteDatabaseSync::create(vm, structure);
    RETURN_IF_EXCEPTION(scope, {});

    // Open the SQLite database
    sqlite3* db = nullptr;
    CString pathUTF8 = databasePath.utf8();
    int result = sqlite3_open(pathUTF8.data(), &db);
    
    if (result != SQLITE_OK) {
        const char* errorMsg = sqlite3_errmsg(db);
        if (db) {
            sqlite3_close(db);
        }
        throwVMError(globalObject, scope, createError(globalObject, String::fromUTF8(errorMsg)));
        return {};
    }

    thisObject->setDatabase(db);

    return JSValue::encode(thisObject);
}

} // namespace Bun