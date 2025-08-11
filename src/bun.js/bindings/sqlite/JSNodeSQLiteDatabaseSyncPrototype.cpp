#include "root.h"

#include "JSNodeSQLiteDatabaseSync.h"
#include "JSNodeSQLiteDatabaseSyncPrototype.h"
#include "JSNodeSQLiteStatementSync.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
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

static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncExec);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncPrepare);

static const HashTableValue JSNodeSQLiteDatabaseSyncPrototypeTableValues[] = {
    { "exec"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteDatabaseSyncProtoFuncExec, 1 } },
    { "prepare"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteDatabaseSyncProtoFuncPrepare, 1 } },
};

const ClassInfo JSNodeSQLiteDatabaseSyncPrototype::s_info = { "DatabaseSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteDatabaseSyncPrototype) };

void JSNodeSQLiteDatabaseSyncPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSNodeSQLiteDatabaseSync::info(), JSNodeSQLiteDatabaseSyncPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
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

    if (lazyLoadSQLite() != 0) {
        throwVMError(globalObject, scope, createError(globalObject, "Failed to load SQLite"_s));
        return {};
    }

    sqlite3* db = thisObject->database();
    if (!db) {
        throwVMError(globalObject, scope, createError(globalObject, "Database is closed"_s));
        return {};
    }

    JSValue sqlValue = callFrame->argument(0);
    if (sqlValue.isUndefined()) {
        throwVMError(globalObject, scope, createError(globalObject, "SQL statement is required"_s));
        return {};
    }

    String sql = sqlValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    CString sqlUTF8 = sql.utf8();
    char* errorMsg = nullptr;
    int result = sqlite3_exec(db, sqlUTF8.data(), nullptr, nullptr, &errorMsg);

    if (result != SQLITE_OK) {
        String errorString = errorMsg ? String::fromUTF8(errorMsg) : "Unknown SQLite error"_s;
        if (errorMsg) {
            sqlite3_free(errorMsg);
        }
        throwVMError(globalObject, scope, createError(globalObject, errorString));
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

    if (lazyLoadSQLite() != 0) {
        throwVMError(globalObject, scope, createError(globalObject, "Failed to load SQLite"_s));
        return {};
    }

    sqlite3* db = thisObject->database();
    if (!db) {
        throwVMError(globalObject, scope, createError(globalObject, "Database is closed"_s));
        return {};
    }

    JSValue sqlValue = callFrame->argument(0);
    if (sqlValue.isUndefined()) {
        throwVMError(globalObject, scope, createError(globalObject, "SQL statement is required"_s));
        return {};
    }

    String sql = sqlValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto* structure = zigGlobalObject->m_JSNodeSQLiteStatementSyncClassStructure.get(zigGlobalObject);

    JSNodeSQLiteStatementSync* statement = JSNodeSQLiteStatementSync::create(vm, structure, thisObject, sql);
    RETURN_IF_EXCEPTION(scope, {});

    if (!statement->statement()) {
        const char* errorMsg = sqlite3_errmsg(db);
        throwVMError(globalObject, scope, createError(globalObject, String::fromUTF8(errorMsg)));
        return {};
    }

    return JSValue::encode(statement);
}


} // namespace Bun