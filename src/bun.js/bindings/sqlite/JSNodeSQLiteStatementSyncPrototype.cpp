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

#include "JSNodeSQLiteStatementSyncPrototype.h"
#include "JSNodeSQLiteStatementSync.h"
#include "JSNodeSQLiteDatabaseSync.h"
#include "JSBuffer.h"
#include "ZigGlobalObject.h"
#include "BunBuiltinNames.h"
#include "ErrorCode.h"

#include "sqlite3_local.h"
#include <wtf/text/WTFString.h>

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
using namespace WebCore;

static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncRun);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncGet);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncAll);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncIterate);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncFinalize);

static const HashTableValue JSNodeSQLiteStatementSyncPrototypeTableValues[] = {
    { "run"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncRun, 0 } },
    { "get"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncGet, 0 } },
    { "all"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncAll, 0 } },
    { "iterate"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncIterate, 0 } },
    { "finalize"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncFinalize, 0 } },
};

const ClassInfo JSNodeSQLiteStatementSyncPrototype::s_info = { "StatementSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteStatementSyncPrototype) };

void JSNodeSQLiteStatementSyncPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSNodeSQLiteStatementSync::info(), JSNodeSQLiteStatementSyncPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

static JSValue convertSQLiteValueToJS(VM& vm, JSGlobalObject* globalObject, sqlite3_stmt* stmt, int column)
{
    int type = sqlite3_column_type(stmt, column);
    
    switch (type) {
    case SQLITE_INTEGER:
        return jsNumber(sqlite3_column_int64(stmt, column));
    case SQLITE_FLOAT:
        return jsNumber(sqlite3_column_double(stmt, column));
    case SQLITE_TEXT: {
        const unsigned char* text = sqlite3_column_text(stmt, column);
        int len = sqlite3_column_bytes(stmt, column);
        return jsString(vm, String::fromUTF8(std::span<const char>(reinterpret_cast<const char*>(text), len)));
    }
    case SQLITE_BLOB: {
        const void* blob = sqlite3_column_blob(stmt, column);
        int len = sqlite3_column_bytes(stmt, column);
        void* data = malloc(len);
        memcpy(data, blob, len);
        return JSValue::decode(JSBuffer__bufferFromPointerAndLengthAndDeinit(globalObject, reinterpret_cast<char*>(data), len, data, [](void* ptr, void*) { free(ptr); }));
    }
    case SQLITE_NULL:
    default:
        return jsNull();
    }
}

static JSObject* createResultObject(VM& vm, JSGlobalObject* globalObject, sqlite3_stmt* stmt)
{
    int columnCount = sqlite3_column_count(stmt);
    JSObject* result = constructEmptyObject(globalObject);
    
    for (int i = 0; i < columnCount; i++) {
        const char* columnName = sqlite3_column_name(stmt, i);
        JSValue value = convertSQLiteValueToJS(vm, globalObject, stmt, i);
        result->putDirect(vm, Identifier::fromString(vm, String::fromUTF8(columnName)), value);
    }
    
    return result;
}

static bool bindParameters(JSGlobalObject* globalObject, sqlite3_stmt* stmt, JSValue parameters)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    if (parameters.isUndefined())
        return true;
    
    // Handle single parameter (not in array or object)
    if (!parameters.isObject()) {
        if (parameters.isString()) {
            String str = parameters.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, false);
            CString utf8 = str.utf8();
            int bindResult = sqlite3_bind_text(stmt, 1, utf8.data(), utf8.length(), SQLITE_TRANSIENT);
            return bindResult == SQLITE_OK;
        } else if (parameters.isNumber()) {
            double num = parameters.asNumber();
            if (num == trunc(num) && num >= static_cast<double>(INT64_MIN) && num <= static_cast<double>(INT64_MAX)) {
                sqlite3_bind_int64(stmt, 1, static_cast<int64_t>(num));
            } else {
                sqlite3_bind_double(stmt, 1, num);
            }
            return true;
        } else if (parameters.isNull()) {
            sqlite3_bind_null(stmt, 1);
            return true;
        } else {
            // Try to convert to string
            String str = parameters.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, false);
            CString utf8 = str.utf8();
            int bindResult = sqlite3_bind_text(stmt, 1, utf8.data(), utf8.length(), SQLITE_TRANSIENT);
            return bindResult == SQLITE_OK;
        }
    }
        
    if (parameters.isObject()) {
        JSObject* paramsObject = asObject(parameters);
        
        if (JSArray* paramsArray = jsDynamicCast<JSArray*>(paramsObject)) {
            // Array parameters
            unsigned length = paramsArray->length();
            for (unsigned i = 0; i < length; i++) {
                JSValue param = paramsArray->getIndex(globalObject, i);
                RETURN_IF_EXCEPTION(scope, false);
                
                int paramIndex = i + 1; // SQLite parameters are 1-indexed
                
                if (param.isString()) {
                    String str = param.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, false);
                    CString utf8 = str.utf8();
                    int bindResult = sqlite3_bind_text(stmt, paramIndex, utf8.data(), utf8.length(), SQLITE_TRANSIENT);
                    if (bindResult != SQLITE_OK) {
                        return false;
                    }
                } else if (param.isNumber()) {
                    double num = param.asNumber();
                    if (num == trunc(num) && num >= static_cast<double>(INT64_MIN) && num <= static_cast<double>(INT64_MAX)) {
                        sqlite3_bind_int64(stmt, paramIndex, static_cast<int64_t>(num));
                    } else {
                        sqlite3_bind_double(stmt, paramIndex, num);
                    }
                } else if (param.isNull()) {
                    sqlite3_bind_null(stmt, paramIndex);
                } else {
                    // Try to convert to string
                    String str = param.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, false);
                    CString utf8 = str.utf8();
                    sqlite3_bind_text(stmt, paramIndex, utf8.data(), utf8.length(), SQLITE_TRANSIENT);
                }
            }
        } else {
            // Named parameters object
            PropertyNameArray propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
            paramsObject->methodTable()->getOwnPropertyNames(paramsObject, globalObject, propertyNames, DontEnumPropertiesMode::Exclude);
            
            for (const auto& propertyName : propertyNames) {
                if (propertyName.isPrivateName())
                    continue;
                    
                JSValue param = paramsObject->get(globalObject, propertyName);
                RETURN_IF_EXCEPTION(scope, false);
                
                String paramName = propertyName.string();
                CString paramNameUtf8 = paramName.utf8();
                int paramIndex = sqlite3_bind_parameter_index(stmt, paramNameUtf8.data());
                
                if (paramIndex == 0) {
                    // Try with leading colon
                    String colonName = makeString(":"_s, paramName);
                    CString colonNameUtf8 = colonName.utf8();
                    paramIndex = sqlite3_bind_parameter_index(stmt, colonNameUtf8.data());
                }
                
                if (paramIndex > 0) {
                    if (param.isString()) {
                        String str = param.toWTFString(globalObject);
                        RETURN_IF_EXCEPTION(scope, false);
                        CString utf8 = str.utf8();
                        sqlite3_bind_text(stmt, paramIndex, utf8.data(), utf8.length(), SQLITE_TRANSIENT);
                    } else if (param.isNumber()) {
                        double num = param.asNumber();
                        if (num == trunc(num) && num >= static_cast<double>(INT64_MIN) && num <= static_cast<double>(INT64_MAX)) {
                            sqlite3_bind_int64(stmt, paramIndex, static_cast<int64_t>(num));
                        } else {
                            sqlite3_bind_double(stmt, paramIndex, num);
                        }
                    } else if (param.isNull()) {
                        sqlite3_bind_null(stmt, paramIndex);
                    } else {
                        // Try to convert to string
                        String str = param.toWTFString(globalObject);
                        RETURN_IF_EXCEPTION(scope, false);
                        CString utf8 = str.utf8();
                        sqlite3_bind_text(stmt, paramIndex, utf8.data(), utf8.length(), SQLITE_TRANSIENT);
                    }
                }
            }
        }
    }
    
    return true;
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

    if (lazyLoadSQLite() != 0) {
        throwVMError(globalObject, scope, createError(globalObject, "Failed to load SQLite"_s));
        return {};
    }

    sqlite3_stmt* stmt = thisObject->statement();
    if (!stmt) {
        throwVMError(globalObject, scope, createError(globalObject, "Statement has been finalized"_s));
        return {};
    }

    sqlite3_reset(stmt);
    sqlite3_clear_bindings(stmt);

    JSValue parameters = callFrame->argument(0);
    if (!bindParameters(globalObject, stmt, parameters)) {
        RETURN_IF_EXCEPTION(scope, {});
        throwVMError(globalObject, scope, createError(globalObject, "Failed to bind parameters"_s));
        return {};
    }

    int result = sqlite3_step(stmt);
    
    if (result == SQLITE_DONE) {
        JSObject* info = constructEmptyObject(globalObject);
        info->putDirect(vm, Identifier::fromString(vm, "changes"_s), jsNumber(sqlite3_changes(thisObject->database()->database())));
        info->putDirect(vm, Identifier::fromString(vm, "lastInsertRowid"_s), jsNumber(sqlite3_last_insert_rowid(thisObject->database()->database())));
        return JSValue::encode(info);
    } else if (result == SQLITE_ROW) {
        throwVMError(globalObject, scope, createError(globalObject, "Statement returned rows. Use get() or all() instead"_s));
        return {};
    } else {
        const char* errorMsg = sqlite3_errmsg(thisObject->database()->database());
        throwVMError(globalObject, scope, createError(globalObject, String::fromUTF8(errorMsg)));
        return {};
    }
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

    if (lazyLoadSQLite() != 0) {
        throwVMError(globalObject, scope, createError(globalObject, "Failed to load SQLite"_s));
        return {};
    }

    sqlite3_stmt* stmt = thisObject->statement();
    if (!stmt) {
        throwVMError(globalObject, scope, createError(globalObject, "Statement has been finalized"_s));
        return {};
    }

    sqlite3_reset(stmt);
    sqlite3_clear_bindings(stmt);

    JSValue parameters = callFrame->argument(0);
    if (!bindParameters(globalObject, stmt, parameters)) {
        RETURN_IF_EXCEPTION(scope, {});
        throwVMError(globalObject, scope, createError(globalObject, "Failed to bind parameters"_s));
        return {};
    }

    int result = sqlite3_step(stmt);
    
    if (result == SQLITE_ROW) {
        return JSValue::encode(createResultObject(vm, globalObject, stmt));
    } else if (result == SQLITE_DONE) {
        return JSValue::encode(jsUndefined());
    } else {
        const char* errorMsg = sqlite3_errmsg(thisObject->database()->database());
        throwVMError(globalObject, scope, createError(globalObject, String::fromUTF8(errorMsg)));
        return {};
    }
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

    if (lazyLoadSQLite() != 0) {
        throwVMError(globalObject, scope, createError(globalObject, "Failed to load SQLite"_s));
        return {};
    }

    sqlite3_stmt* stmt = thisObject->statement();
    if (!stmt) {
        throwVMError(globalObject, scope, createError(globalObject, "Statement has been finalized"_s));
        return {};
    }

    sqlite3_reset(stmt);
    sqlite3_clear_bindings(stmt);

    JSValue parameters = callFrame->argument(0);
    if (!bindParameters(globalObject, stmt, parameters)) {
        RETURN_IF_EXCEPTION(scope, {});
        throwVMError(globalObject, scope, createError(globalObject, "Failed to bind parameters"_s));
        return {};
    }

    JSArray* results = JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithUndecided), 0);
    unsigned index = 0;
    
    int result;
    while ((result = sqlite3_step(stmt)) == SQLITE_ROW) {
        JSObject* row = createResultObject(vm, globalObject, stmt);
        results->putDirectIndex(globalObject, index++, row);
        RETURN_IF_EXCEPTION(scope, {});
    }
    
    if (result != SQLITE_DONE) {
        const char* errorMsg = sqlite3_errmsg(thisObject->database()->database());
        throwVMError(globalObject, scope, createError(globalObject, String::fromUTF8(errorMsg)));
        return {};
    }

    return JSValue::encode(results);
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

    if (lazyLoadSQLite() != 0) {
        throwVMError(globalObject, scope, createError(globalObject, "Failed to load SQLite"_s));
        return {};
    }

    // For now, just return undefined - iterator implementation would be more complex
    // and would require creating a proper iterator object
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