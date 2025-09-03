#include "root.h"

#include "JSNodeSQLiteDatabaseSync.h"
#include "JSNodeSQLiteDatabaseSyncPrototype.h"
#include "JSNodeSQLiteStatementSync.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSBigInt.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/Uint8Array.h>
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/CallData.h>
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

#include "sqlite_init.h"

namespace Bun {

using namespace JSC;

// User-defined function support - COMMENTED OUT FOR COMPILATION
// TODO: Fix Strong<JSValue> template issues and visitor implementation
/*
// Helper structs for SQLite callback context
struct UserFunctionContext {
    JSNodeSQLiteDatabaseSync* database;
    WTF::String functionName;
};

struct AggregateFunctionContext {
    JSNodeSQLiteDatabaseSync* database;
    WTF::String functionName;
};

// SQLite callback functions
static void sqliteUserFunctionCallback(sqlite3_context* context, int argc, sqlite3_value** argv)
{
    // Implementation commented out for compilation
}

static void sqliteAggregateStepCallback(sqlite3_context* context, int argc, sqlite3_value** argv)
{
    // Implementation commented out for compilation
}

static void sqliteAggregateFinalCallback(sqlite3_context* context)
{
    // Implementation commented out for compilation
}
*/

static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncExec);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncPrepare);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncClose);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncOpen);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncLocation);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncFunction);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncAggregate);
static JSC_DECLARE_CUSTOM_GETTER(jsNodeSQLiteDatabaseSyncProtoGetterIsOpen);
static JSC_DECLARE_CUSTOM_GETTER(jsNodeSQLiteDatabaseSyncProtoGetterIsTransaction);

static const HashTableValue JSNodeSQLiteDatabaseSyncPrototypeTableValues[] = {
    { "exec"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteDatabaseSyncProtoFuncExec, 1 } },
    { "prepare"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteDatabaseSyncProtoFuncPrepare, 1 } },
    { "close"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteDatabaseSyncProtoFuncClose, 0 } },
    { "open"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteDatabaseSyncProtoFuncOpen, 0 } },
    { "location"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteDatabaseSyncProtoFuncLocation, 0 } },
    { "function"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteDatabaseSyncProtoFuncFunction, 2 } },
    { "aggregate"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteDatabaseSyncProtoFuncAggregate, 2 } },
    { "isOpen"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodeSQLiteDatabaseSyncProtoGetterIsOpen, 0 } },
    { "isTransaction"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodeSQLiteDatabaseSyncProtoGetterIsTransaction, 0 } },
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
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE, "database is not open"_s);
    }

    JSValue sqlValue = callFrame->argument(0);
    if (sqlValue.isUndefined() || !sqlValue.isString()) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"sql\" argument must be a string."_s);
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
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_SQLITE_ERROR, errorString);
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
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE, "database is not open"_s);
    }

    JSValue sqlValue = callFrame->argument(0);
    if (sqlValue.isUndefined() || !sqlValue.isString()) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"sql\" argument must be a string."_s);
    }

    String sql = sqlValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto* structure = zigGlobalObject->m_JSNodeSQLiteStatementSyncClassStructure.get(zigGlobalObject);

    JSNodeSQLiteStatementSync* statement = JSNodeSQLiteStatementSync::create(vm, structure, thisObject, sql);
    RETURN_IF_EXCEPTION(scope, {});

    if (!statement->statement()) {
        const char* errorMsg = sqlite3_errmsg(db);
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_SQLITE_ERROR, String::fromUTF8(errorMsg));
    }

    return JSValue::encode(statement);
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

    // Check if already closed
    if (!thisObject->database()) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE, "database is not open"_s);
    }

    thisObject->closeDatabase();

    return JSValue::encode(jsUndefined());
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

    if (lazyLoadSQLite() != 0) {
        throwVMError(globalObject, scope, createError(globalObject, "Failed to load SQLite"_s));
        return {};
    }

#if LAZY_LOAD_SQLITE
    // Check if the function pointer is actually loaded
    if (!lazy_sqlite3_open_v2) {
        throwVMError(globalObject, scope, createError(globalObject, "sqlite3_open_v2 function not available"_s));
        return {};
    }
#endif

    // Check if already open
    if (thisObject->database()) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE, "database is already open"_s);
    }

    // Get the stored path
    const String& databasePath = thisObject->path();
    if (databasePath.isEmpty()) {
        throwVMError(globalObject, scope, createError(globalObject, "Database path is not set"_s));
        return {};
    }

    // Initialize SQLite before opening the database
    Bun::initializeSQLite();

    // Open the SQLite database
    sqlite3* db = nullptr;
    CString pathUTF8 = databasePath.utf8();
    int result = sqlite3_open_v2(pathUTF8.data(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nullptr);
    
    if (result != SQLITE_OK) {
        const char* errorMsg = nullptr;
#if LAZY_LOAD_SQLITE
        if (lazy_sqlite3_errmsg) {
            errorMsg = sqlite3_errmsg(db);
        }
#else
        errorMsg = sqlite3_errmsg(db);
#endif
        
        if (db) {
#if LAZY_LOAD_SQLITE
            // Check if the function pointer is actually loaded
            if (lazy_sqlite3_close) {
                sqlite3_close(db);
            }
#else
            sqlite3_close(db);
#endif
        }
        
        String errorString = errorMsg ? String::fromUTF8(errorMsg) : "Failed to open database"_s;
        throwVMError(globalObject, scope, createError(globalObject, errorString));
        return {};
    }

    thisObject->setDatabase(db);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncLocation, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteDatabaseSync* thisObject = jsDynamicCast<JSNodeSQLiteDatabaseSync*>(callFrame->thisValue());
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Method DatabaseSync.prototype.location called on incompatible receiver"_s);
        return {};
    }

    sqlite3* db = thisObject->database();
    if (!db) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE, "database is not open"_s);
    }

    // Check if dbName parameter is provided
    JSValue dbNameValue = callFrame->argument(0);
    String dbName = "main"_s; // Default to "main" database
    
    if (!dbNameValue.isUndefined()) {
        if (!dbNameValue.isString()) {
            return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"dbName\" argument must be a string."_s);
        }
        dbName = dbNameValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Get database file name using sqlite3_db_filename
    CString dbNameUTF8 = dbName.utf8();
    const char* filename = sqlite3_db_filename(db, dbNameUTF8.data());
    if (!filename) {
        return JSValue::encode(jsNull());
    }
    
    // For in-memory databases, return ":memory:" or empty string based on what was used
    if (strcmp(filename, "") == 0 || filename == nullptr) {
        // Return the original path that was used when creating the database
        return JSValue::encode(jsString(vm, thisObject->path()));
    }

    return JSValue::encode(jsString(vm, String::fromUTF8(filename)));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeSQLiteDatabaseSyncProtoGetterIsOpen, (JSGlobalObject* globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteDatabaseSync* thisObject = jsDynamicCast<JSNodeSQLiteDatabaseSync*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Trying to get isOpen on a non-DatabaseSync object"_s);
        return {};
    }

    sqlite3* db = thisObject->database();
    return JSValue::encode(jsBoolean(db != nullptr));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeSQLiteDatabaseSyncProtoGetterIsTransaction, (JSGlobalObject* globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteDatabaseSync* thisObject = jsDynamicCast<JSNodeSQLiteDatabaseSync*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Trying to get isTransaction on a non-DatabaseSync object"_s);
        return {};
    }

    sqlite3* db = thisObject->database();
    if (!db) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE, "database is not open"_s);
    }

    // Check if we're in a transaction using sqlite3_get_autocommit
    // Returns 0 if in a transaction, non-zero if not in a transaction
    bool inTransaction = sqlite3_get_autocommit(db) == 0;
    return JSValue::encode(jsBoolean(inTransaction));
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncFunction, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // User-defined functions are not implemented yet
    return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_METHOD_NOT_IMPLEMENTED, "function() method is not implemented yet"_s);
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncProtoFuncAggregate, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Aggregate functions are not implemented yet
    return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_METHOD_NOT_IMPLEMENTED, "aggregate() method is not implemented yet"_s);
}


} // namespace Bun