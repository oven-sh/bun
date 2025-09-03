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
#include "../JSBuffer.h"
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

static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncRun);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncGet);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncAll);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncIterate);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncColumns);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncSetReadBigInts);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncSetAllowBareNamedParameters);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncSetReturnArrays);
static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncFinalize);
static JSC_DECLARE_CUSTOM_GETTER(jsNodeSQLiteStatementSyncSourceSQL);
static JSC_DECLARE_CUSTOM_GETTER(jsNodeSQLiteStatementSyncExpandedSQL);

static const HashTableValue JSNodeSQLiteStatementSyncPrototypeTableValues[] = {
    { "run"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncRun, 0 } },
    { "get"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncGet, 0 } },
    { "all"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncAll, 0 } },
    { "iterate"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncIterate, 0 } },
    { "columns"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncColumns, 0 } },
    { "setReadBigInts"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncSetReadBigInts, 1 } },
    { "setAllowBareNamedParameters"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncSetAllowBareNamedParameters, 1 } },
    { "setReturnArrays"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncSetReturnArrays, 1 } },
    { "finalize"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodeSQLiteStatementSyncProtoFuncFinalize, 0 } },
    { "sourceSQL"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodeSQLiteStatementSyncSourceSQL, nullptr } },
    { "expandedSQL"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodeSQLiteStatementSyncExpandedSQL, nullptr } },
};

const ClassInfo JSNodeSQLiteStatementSyncPrototype::s_info = { "StatementSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteStatementSyncPrototype) };

void JSNodeSQLiteStatementSyncPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSNodeSQLiteStatementSync::info(), JSNodeSQLiteStatementSyncPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

static JSValue convertSQLiteValueToJS(VM& vm, JSGlobalObject* globalObject, sqlite3_stmt* stmt, int column, bool readBigInts)
{
    int type = sqlite3_column_type(stmt, column);
    
    switch (type) {
    case SQLITE_INTEGER: {
        int64_t value = sqlite3_column_int64(stmt, column);
        if (readBigInts) {
            return JSBigInt::createFrom(globalObject, value);
        }
        return jsNumber(value);
    }
    case SQLITE_FLOAT:
        return jsNumber(sqlite3_column_double(stmt, column));
    case SQLITE_TEXT: {
        const unsigned char* text = sqlite3_column_text(stmt, column);
        return jsString(vm, String::fromUTF8(reinterpret_cast<const char*>(text)));
    }
    case SQLITE_BLOB: {
        const void* blob = sqlite3_column_blob(stmt, column);
        int len = sqlite3_column_bytes(stmt, column);
        void* data = malloc(len);
        memcpy(data, blob, len);
        // Ensure we use the default global object for proper Buffer creation
        auto* defaultGlobal = defaultGlobalObject(globalObject);
        return JSValue::decode(JSBuffer__bufferFromPointerAndLengthAndDeinit(defaultGlobal, reinterpret_cast<char*>(data), len, data, [](void* ptr, void*) { free(ptr); }));
    }
    case SQLITE_NULL:
    default:
        return jsNull();
    }
}

static JSValue createResultObject(VM& vm, JSGlobalObject* globalObject, sqlite3_stmt* stmt, bool returnArrays, bool readBigInts)
{
    int columnCount = sqlite3_column_count(stmt);
    
    if (returnArrays) {
        JSArray* result = constructEmptyArray(globalObject, nullptr, columnCount);
        for (int i = 0; i < columnCount; i++) {
            JSValue value = convertSQLiteValueToJS(vm, globalObject, stmt, i, readBigInts);
            result->putDirectIndex(globalObject, i, value);
        }
        return result;
    } else {
        JSObject* result = constructEmptyObject(globalObject);
        
        for (int i = 0; i < columnCount; i++) {
            const char* columnName = sqlite3_column_name(stmt, i);
            JSValue value = convertSQLiteValueToJS(vm, globalObject, stmt, i, readBigInts);
            result->putDirect(vm, Identifier::fromString(vm, String::fromUTF8(columnName)), value);
        }
        
        return result;
    }
}

static bool bindParameters(JSGlobalObject* globalObject, sqlite3_stmt* stmt, CallFrame* callFrame, JSNodeSQLiteDatabaseSync* database)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    unsigned argumentCount = callFrame->argumentCount();
    if (argumentCount == 0)
        return true;
    
    // If there are multiple arguments, treat them as positional parameters
    if (argumentCount > 1) {
        for (unsigned i = 0; i < argumentCount; i++) {
            JSValue param = callFrame->argument(i);
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
                int bindResult;
                if (num == trunc(num) && num >= static_cast<double>(INT64_MIN) && num <= static_cast<double>(INT64_MAX)) {
                    bindResult = sqlite3_bind_int64(stmt, paramIndex, static_cast<int64_t>(num));
                } else {
                    bindResult = sqlite3_bind_double(stmt, paramIndex, num);
                }
                if (bindResult != SQLITE_OK) {
                    return false;
                }
            } else if (param.isNull()) {
                int bindResult = sqlite3_bind_null(stmt, paramIndex);
                if (bindResult != SQLITE_OK) {
                    return false;
                }
            } else if (auto* uint8Array = jsDynamicCast<JSC::JSUint8Array*>(param)) {
                // Handle Buffer/Uint8Array as BLOB
                const void* data = uint8Array->vector();
                size_t length = uint8Array->length();
                int bindResult = sqlite3_bind_blob(stmt, paramIndex, data, length, SQLITE_TRANSIENT);
                if (bindResult != SQLITE_OK) {
                    return false;
                }
            } else {
                // Try to convert to string
                String str = param.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, false);
                CString utf8 = str.utf8();
                int bindResult = sqlite3_bind_text(stmt, paramIndex, utf8.data(), utf8.length(), SQLITE_TRANSIENT);
                if (bindResult != SQLITE_OK) {
                    return false;
                }
            }
        }
        return true;
    }
    
    // Single argument case
    JSValue parameters = callFrame->argument(0);
    
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
            int bindResult;
            if (num == trunc(num) && num >= static_cast<double>(INT64_MIN) && num <= static_cast<double>(INT64_MAX)) {
                bindResult = sqlite3_bind_int64(stmt, 1, static_cast<int64_t>(num));
            } else {
                bindResult = sqlite3_bind_double(stmt, 1, num);
            }
            return bindResult == SQLITE_OK;
        } else if (parameters.isNull()) {
            int bindResult = sqlite3_bind_null(stmt, 1);
            return bindResult == SQLITE_OK;
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
        
        // Handle single Buffer/Uint8Array parameter
        if (auto* uint8Array = jsDynamicCast<JSC::JSUint8Array*>(paramsObject)) {
            const void* data = uint8Array->vector();
            size_t length = uint8Array->length();
            int bindResult = sqlite3_bind_blob(stmt, 1, data, length, SQLITE_TRANSIENT);
            return bindResult == SQLITE_OK;
        }
        
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
                    int bindResult;
                    if (num == trunc(num) && num >= static_cast<double>(INT64_MIN) && num <= static_cast<double>(INT64_MAX)) {
                        bindResult = sqlite3_bind_int64(stmt, paramIndex, static_cast<int64_t>(num));
                    } else {
                        bindResult = sqlite3_bind_double(stmt, paramIndex, num);
                    }
                    if (bindResult != SQLITE_OK) {
                        return false;
                    }
                } else if (param.isNull()) {
                    int bindResult = sqlite3_bind_null(stmt, paramIndex);
                    if (bindResult != SQLITE_OK) {
                        return false;
                    }
                } else if (auto* uint8Array = jsDynamicCast<JSC::JSUint8Array*>(param)) {
                    // Handle Buffer/Uint8Array as BLOB
                    const void* data = uint8Array->vector();
                    size_t length = uint8Array->length();
                    int bindResult = sqlite3_bind_blob(stmt, paramIndex, data, length, SQLITE_TRANSIENT);
                    if (bindResult != SQLITE_OK) {
                        return false;
                    }
                } else {
                    // Try to convert to string
                    String str = param.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, false);
                    CString utf8 = str.utf8();
                    int bindResult = sqlite3_bind_text(stmt, paramIndex, utf8.data(), utf8.length(), SQLITE_TRANSIENT);
                    if (bindResult != SQLITE_OK) {
                        return false;
                    }
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
                    // Try with leading colon or dollar sign for bare named parameters
                    String colonName = makeString(":"_s, paramName);
                    CString colonNameUtf8 = colonName.utf8();
                    paramIndex = sqlite3_bind_parameter_index(stmt, colonNameUtf8.data());
                    
                    if (paramIndex == 0) {
                        String dollarName = makeString("$"_s, paramName);
                        CString dollarNameUtf8 = dollarName.utf8();
                        paramIndex = sqlite3_bind_parameter_index(stmt, dollarNameUtf8.data());
                        
                        // If found with $ prefix but allowBareNamedParameters is false, throw error
                        if (paramIndex > 0 && !database->allowBareNamedParameters()) {
                            Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE, makeString("Unknown named parameter '"_s, paramName, "'"_s));
                            return false;
                        }
                    }
                }
                
                if (paramIndex > 0) {
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
                        int bindResult;
                        if (num == trunc(num) && num >= static_cast<double>(INT64_MIN) && num <= static_cast<double>(INT64_MAX)) {
                            bindResult = sqlite3_bind_int64(stmt, paramIndex, static_cast<int64_t>(num));
                        } else {
                            bindResult = sqlite3_bind_double(stmt, paramIndex, num);
                        }
                        if (bindResult != SQLITE_OK) {
                            return false;
                        }
                    } else if (param.isNull()) {
                        int bindResult = sqlite3_bind_null(stmt, paramIndex);
                        if (bindResult != SQLITE_OK) {
                            return false;
                        }
                    } else if (auto* uint8Array = jsDynamicCast<JSC::JSUint8Array*>(param)) {
                        // Handle Buffer/Uint8Array as BLOB
                        const void* data = uint8Array->vector();
                        size_t length = uint8Array->length();
                        int bindResult = sqlite3_bind_blob(stmt, paramIndex, data, length, SQLITE_TRANSIENT);
                        if (bindResult != SQLITE_OK) {
                            return false;
                        }
                    } else {
                        // Try to convert to string
                        String str = param.toWTFString(globalObject);
                        RETURN_IF_EXCEPTION(scope, false);
                        CString utf8 = str.utf8();
                        int bindResult = sqlite3_bind_text(stmt, paramIndex, utf8.data(), utf8.length(), SQLITE_TRANSIENT);
                        if (bindResult != SQLITE_OK) {
                            return false;
                        }
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

    if (!bindParameters(globalObject, stmt, callFrame, thisObject->database())) {
        RETURN_IF_EXCEPTION(scope, {});
        throwVMError(globalObject, scope, createError(globalObject, "Failed to bind parameters"_s));
        return {};
    }

    int result = sqlite3_step(stmt);
    
    if (result == SQLITE_DONE) {
        JSNodeSQLiteDatabaseSync* database = thisObject->database();
        bool readBigInts = database->readBigInts();
        
        JSObject* info = constructEmptyObject(globalObject);
        int changes = sqlite3_changes(database->database());
        int64_t lastInsertRowid = sqlite3_last_insert_rowid(database->database());
        
        if (readBigInts) {
            info->putDirect(vm, Identifier::fromString(vm, "changes"_s), JSBigInt::createFrom(globalObject, changes));
            info->putDirect(vm, Identifier::fromString(vm, "lastInsertRowid"_s), JSBigInt::createFrom(globalObject, lastInsertRowid));
        } else {
            info->putDirect(vm, Identifier::fromString(vm, "changes"_s), jsNumber(changes));
            info->putDirect(vm, Identifier::fromString(vm, "lastInsertRowid"_s), jsNumber(lastInsertRowid));
        }
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

    if (!bindParameters(globalObject, stmt, callFrame, thisObject->database())) {
        RETURN_IF_EXCEPTION(scope, {});
        throwVMError(globalObject, scope, createError(globalObject, "Failed to bind parameters"_s));
        return {};
    }

    int result = sqlite3_step(stmt);
    
    if (result == SQLITE_ROW) {
        JSNodeSQLiteDatabaseSync* database = thisObject->database();
        bool readBigInts = database->readBigInts();
        bool returnArrays = thisObject->returnArrays();
        return JSValue::encode(createResultObject(vm, globalObject, stmt, returnArrays, readBigInts));
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

    if (!bindParameters(globalObject, stmt, callFrame, thisObject->database())) {
        RETURN_IF_EXCEPTION(scope, {});
        throwVMError(globalObject, scope, createError(globalObject, "Failed to bind parameters"_s));
        return {};
    }

    JSArray* results = JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithUndecided), 0);
    unsigned index = 0;
    
    JSNodeSQLiteDatabaseSync* database = thisObject->database();
    bool readBigInts = database->readBigInts();
    bool returnArrays = thisObject->returnArrays();
    
    int result;
    while ((result = sqlite3_step(stmt)) == SQLITE_ROW) {
        JSValue row = createResultObject(vm, globalObject, stmt, returnArrays, readBigInts);
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

    sqlite3_stmt* stmt = thisObject->statement();
    if (!stmt) {
        throwVMError(globalObject, scope, createError(globalObject, "Statement has been finalized"_s));
        return {};
    }

    // Bind parameters if provided
    sqlite3_reset(stmt);
    sqlite3_clear_bindings(stmt);
    
    if (!bindParameters(globalObject, stmt, callFrame, thisObject->database())) {
        RETURN_IF_EXCEPTION(scope, {});
        throwVMError(globalObject, scope, createError(globalObject, "Failed to bind parameters"_s));
        return {};
    }

    // Create an array that acts like an iterator
    // In a real implementation, this would return a proper iterator object
    // For now, we'll return an object with Symbol.iterator that yields rows
    JSArray* rows = JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithUndecided), 0);
    unsigned index = 0;
    
    JSNodeSQLiteDatabaseSync* database = thisObject->database();
    bool readBigInts = database->readBigInts();
    bool returnArrays = thisObject->returnArrays();
    
    int result;
    while ((result = sqlite3_step(stmt)) == SQLITE_ROW) {
        JSValue row = createResultObject(vm, globalObject, stmt, returnArrays, readBigInts);
        rows->putDirectIndex(globalObject, index++, row);
        RETURN_IF_EXCEPTION(scope, {});
    }
    
    if (result != SQLITE_DONE) {
        const char* errorMsg = sqlite3_errmsg(thisObject->database()->database());
        throwVMError(globalObject, scope, createError(globalObject, String::fromUTF8(errorMsg)));
        return {};
    }

    // Return the array which has Symbol.iterator built in
    return JSValue::encode(rows);
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

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncColumns, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteStatementSync* thisObject = jsDynamicCast<JSNodeSQLiteStatementSync*>(callFrame->thisValue());
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Method StatementSync.prototype.columns called on incompatible receiver"_s);
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

    int columnCount = sqlite3_column_count(stmt);
    JSArray* columns = JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithUndecided), columnCount);
    
    for (int i = 0; i < columnCount; i++) {
        JSObject* columnInfo = constructEmptyObject(globalObject);
        
        // Column name
        const char* name = sqlite3_column_name(stmt, i);
        columnInfo->putDirect(vm, Identifier::fromString(vm, "name"_s), jsString(vm, String::fromUTF8(name)));
        
        // Column type (SQLite doesn't always have type info, so this might be null)
        const char* type = sqlite3_column_decltype(stmt, i);
        if (type) {
            columnInfo->putDirect(vm, Identifier::fromString(vm, "type"_s), jsString(vm, String::fromUTF8(type)));
        } else {
            columnInfo->putDirect(vm, Identifier::fromString(vm, "type"_s), jsNull());
        }
        
        columns->putDirectIndex(globalObject, i, columnInfo);
    }

    return JSValue::encode(columns);
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncSetReadBigInts, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteStatementSync* thisObject = jsDynamicCast<JSNodeSQLiteStatementSync*>(callFrame->thisValue());
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Method StatementSync.prototype.setReadBigInts called on incompatible receiver"_s);
        return {};
    }

    JSValue readBigIntsValue = callFrame->argument(0);
    if (!readBigIntsValue.isBoolean()) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"readBigInts\" argument must be a boolean."_s);
    }

    bool readBigInts = readBigIntsValue.asBoolean();
    // Store this setting on the statement object
    // For now, we'll apply it at the database level since we don't have per-statement storage
    thisObject->database()->setReadBigInts(readBigInts);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncSetAllowBareNamedParameters, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteStatementSync* thisObject = jsDynamicCast<JSNodeSQLiteStatementSync*>(callFrame->thisValue());
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Method StatementSync.prototype.setAllowBareNamedParameters called on incompatible receiver"_s);
        return {};
    }

    JSValue allowValue = callFrame->argument(0);
    if (!allowValue.isBoolean()) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"allowBareNamedParameters\" argument must be a boolean."_s);
    }

    bool allow = allowValue.asBoolean();
    // Store this setting on the statement object
    // For now, we'll apply it at the database level since we don't have per-statement storage
    thisObject->database()->setAllowBareNamedParameters(allow);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteStatementSyncProtoFuncSetReturnArrays, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteStatementSync* thisObject = jsDynamicCast<JSNodeSQLiteStatementSync*>(callFrame->thisValue());
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "Method StatementSync.prototype.setReturnArrays called on incompatible receiver"_s);
        return {};
    }

    JSValue enableValue = callFrame->argument(0);
    if (!enableValue.isBoolean()) {
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"returnArrays\" argument must be a boolean."_s);
    }

    thisObject->setReturnArrays(enableValue.asBoolean());
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeSQLiteStatementSyncSourceSQL, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteStatementSync* thisObject = jsDynamicCast<JSNodeSQLiteStatementSync*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "StatementSync.prototype.sourceSQL getter called on incompatible receiver"_s);
        return {};
    }

    return JSValue::encode(jsString(vm, thisObject->sourceSQL()));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeSQLiteStatementSyncExpandedSQL, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodeSQLiteStatementSync* thisObject = jsDynamicCast<JSNodeSQLiteStatementSync*>(JSValue::decode(thisValue));
    if (!thisObject) {
        throwVMTypeError(globalObject, scope, "StatementSync.prototype.expandedSQL getter called on incompatible receiver"_s);
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

    // Get the expanded SQL with bound parameters
    char* expandedSQL = sqlite3_expanded_sql(stmt);
    if (!expandedSQL) {
        // If no parameters bound, return the original SQL
        return JSValue::encode(jsString(vm, thisObject->sourceSQL()));
    }

    String result = String::fromUTF8(expandedSQL);
    sqlite3_free(expandedSQL);
    return JSValue::encode(jsString(vm, result));
}

} // namespace Bun