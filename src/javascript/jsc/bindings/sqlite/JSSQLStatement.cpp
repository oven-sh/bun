
#include "root.h"
#include "JSSQLStatement.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "wtf/text/ExternalStringImpl.h"

#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/HeapAnalyzer.h"

#include "JavaScriptCore/JSDestructibleObjectHeapCellType.h"
#include "JavaScriptCore/SlotVisitorMacros.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/SubspaceInlines.h"
#include "wtf/GetPtr.h"
#include "wtf/PointerPreparations.h"
#include "wtf/URL.h"
#include "JavaScriptCore/TypedArrayInlines.h"
#include "JavaScriptCore/PropertyNameArray.h"

static int DEFAULT_SQLITE_FLAGS = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE;
static unsigned int DEFAULT_SQLITE_PREPARE_FLAGS = SQLITE_PREPARE_PERSISTENT;
static int MAX_SQLITE_PREPARE_FLAG = SQLITE_PREPARE_PERSISTENT | SQLITE_PREPARE_NORMALIZE | SQLITE_PREPARE_NO_VTAB;

namespace WebCore {
using namespace JSC;

class JSSQLStatement : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSSQLStatement* create(JSC::Structure* structure, JSDOMGlobalObject* globalObject, sqlite3_stmt* stmt, sqlite3* db)
    {
        JSSQLStatement* ptr = new (NotNull, JSC::allocateCell<JSSQLStatement>(globalObject->vm())) JSSQLStatement(structure, *globalObject, stmt, db);
        ptr->finishCreation(globalObject->vm());
        return ptr;
    }
    static void destroy(JSC::JSCell*);
    template<typename, SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return WebCore::subspaceForImpl<JSSQLStatement, UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSSQLStatement.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSSQLStatement = WTFMove(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSSQLStatement.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSSQLStatement = WTFMove(space); });
    }
    // DECLARE_VISIT_CHILDREN;
    DECLARE_EXPORT_INFO;

    // static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

    JSC::JSValue rebind(JSGlobalObject* globalObject, JSC::JSValue values);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    ~JSSQLStatement();

    sqlite3_stmt* stmt;
    sqlite3* db;
    bool hasExecuted = false;
    PropertyNameArray columnNames;

protected:
    JSSQLStatement(JSC::Structure* structure, JSDOMGlobalObject& globalObject, sqlite3_stmt* stmt, sqlite3* db)
        : Base(globalObject.vm(), structure)
        , columnNames(globalObject.vm(), PropertyNameMode::Strings, PrivateSymbolMode::Exclude)

    {
        this->stmt = stmt;
        this->db = db;
    }

    void finishCreation(JSC::VM&);
};

void JSSQLStatement::destroy(JSC::JSCell* cell)
{
    JSSQLStatement* thisObject = static_cast<JSSQLStatement*>(cell);
    sqlite3_finalize(thisObject->stmt);
    thisObject->stmt = nullptr;
}

void JSSQLStatementConstructor::destroy(JSC::JSCell* cell)
{
}
static JSC_DECLARE_HOST_FUNCTION(jsSQLStatementPrepareStatementFunction);
static JSC_DECLARE_HOST_FUNCTION(jsSQLStatementOpenStatementFunction);
static JSC_DECLARE_HOST_FUNCTION(jsSQLStatementCloseFunction);

static JSC_DECLARE_HOST_FUNCTION(jsSQLStatementBindFunction);
static JSC_DECLARE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunction);
static JSC_DECLARE_HOST_FUNCTION(jsSQLStatementRowsFunction);

JSSQLStatementConstructor* JSSQLStatementConstructor::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
{
    NativeExecutable* executable = vm.getHostFunction(jsSQLStatementPrepareStatementFunction, callHostFunctionAsConstructor, String("SQLStatement"_s));
    JSSQLStatementConstructor* ptr = new (NotNull, JSC::allocateCell<JSSQLStatementConstructor>(vm)) JSSQLStatementConstructor(vm, executable, globalObject, structure);
    ptr->finishCreation(vm);
    return ptr;
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementPrepareStatementFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSSQLStatementConstructor* thisObject = jsDynamicCast<JSSQLStatementConstructor*>(thisValue.getObject());
    if (!thisObject) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQLStatement"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue dbNumber = callFrame->argument(0);
    JSC::JSValue sqlValue = callFrame->argument(1);
    JSC::JSValue bindings;
    JSC::JSValue prepareFlagsValue;

    if (!dbNumber.isNumber() || !sqlValue.isString()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "SQLStatement requires a number and a string"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    int handle = dbNumber.toInt32(lexicalGlobalObject);
    if (handle < 0 || handle > thisObject->databases.size()) {
        throwException(lexicalGlobalObject, scope, createRangeError(lexicalGlobalObject, "Invalid database handle"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    sqlite3* db = thisObject->databases[handle];
    if (!db) {
        throwException(lexicalGlobalObject, scope, createRangeError(lexicalGlobalObject, "Cannot use a closed database"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    auto sqlString = sqlValue.toWTFString(lexicalGlobalObject);
    if (!sqlString.length()) {
        throwException(lexicalGlobalObject, scope, createRangeError(lexicalGlobalObject, "Invalid SQL statement"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    unsigned int flags = DEFAULT_SQLITE_PREPARE_FLAGS;
    if (prepareFlagsValue.isNumber()) {
        prepareFlagsValue = callFrame->argument(2);

        int prepareFlags = prepareFlagsValue.toInt32(lexicalGlobalObject);
        if (prepareFlags < 0 || prepareFlags > MAX_SQLITE_PREPARE_FLAG) {
            throwException(lexicalGlobalObject, scope, createRangeError(lexicalGlobalObject, "Invalid prepare flags"_s));
            return JSValue::encode(JSC::jsUndefined());
        }
        flags = static_cast<unsigned int>(prepareFlags);
    }

    sqlite3_stmt* statement = nullptr;

    int rc = SQLITE_OK;
    if (sqlString.is8Bit()) {
        rc = sqlite3_prepare_v3(db, reinterpret_cast<const char*>(sqlString.characters8()), sqlString.length(), flags, &statement, nullptr);
    } else {
        rc = sqlite3_prepare16_v3(db, sqlString.characters16(), sqlString.length() * 2, flags, &statement, nullptr);
    }

    if (rc != SQLITE_OK) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, WTF::String::fromUTF8(sqlite3_errmsg(db))));
        return JSValue::encode(JSC::jsUndefined());
    }

    auto* structure = JSSQLStatement::createStructure(vm, lexicalGlobalObject, lexicalGlobalObject->objectPrototype());
    // auto* structure = JSSQLStatement::createStructure(vm, globalObject(), thisObject->getDirect(vm, vm.propertyNames->prototype));
    JSSQLStatement* sqlStatement = JSSQLStatement::create(structure, reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject), statement, db);
    sqlStatement->db = db;
    return JSValue::encode(JSValue(sqlStatement));
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementOpenStatementFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSSQLStatementConstructor* constructor = jsDynamicCast<JSSQLStatementConstructor*>(thisValue.getObject());
    if (!constructor) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQLStatement"_s));
        return JSValue::encode(jsUndefined());
    }

    if (callFrame->argumentCount() < 1) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected 1 argument"_s));
        return JSValue::encode(jsUndefined());
    }

    JSValue pathValue = callFrame->argument(0);
    if (!pathValue.isString()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected string"_s));
        return JSValue::encode(jsUndefined());
    }

    auto catchScope = DECLARE_CATCH_SCOPE(vm);
    String path = pathValue.toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(catchScope, JSValue::encode(jsUndefined()));
    catchScope.clearException();
    int openFlags = DEFAULT_SQLITE_FLAGS;
    if (callFrame->argumentCount() > 1) {
        JSValue flags = callFrame->argument(1);
        if (!flags.isNumber()) {
            throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected number"_s));
            return JSValue::encode(jsUndefined());
        }

        openFlags = flags.toInt32(lexicalGlobalObject);
    }

    sqlite3* db = nullptr;
    int statusCode = sqlite3_open_v2(path.utf8().data(), &db, openFlags, nullptr);
    if (statusCode != SQLITE_OK) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, WTF::String::fromUTF8(sqlite3_errmsg(db))));

        return JSValue::encode(jsUndefined());
    }

    auto count = constructor->databases.size();
    constructor->databases.append(db);
    RELEASE_AND_RETURN(scope, JSValue::encode(jsNumber(count)));
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementCloseStatementFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{

    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSSQLStatementConstructor* constructor = jsDynamicCast<JSSQLStatementConstructor*>(thisValue.getObject());

    if (!constructor) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQLStatement"_s));
        return JSValue::encode(jsUndefined());
    }

    if (callFrame->argumentCount() < 1) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected 1 argument"_s));
        return JSValue::encode(jsUndefined());
    }

    JSValue dbNumber = callFrame->argument(0);
    if (!dbNumber.isNumber()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected number"_s));
        return JSValue::encode(jsUndefined());
    }

    int dbIndex = dbNumber.toInt32(lexicalGlobalObject);

    if (dbIndex < 0 || dbIndex >= constructor->databases.size()) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Invalid database index"_s));
        return JSValue::encode(jsUndefined());
    }

    sqlite3* db = constructor->databases[dbIndex];
    if (!db) {
        return JSValue::encode(jsUndefined());
    }

    int statusCode = sqlite3_close(db);
    if (statusCode != SQLITE_OK) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, WTF::String::fromUTF8(sqlite3_errmsg(db))));
        return JSValue::encode(jsUndefined());
    }

    constructor->databases[dbIndex] = nullptr;
    return JSValue::encode(jsUndefined());
}

/* Hash table for constructor */
static const HashTableValue JSSQLStatementConstructorTableValues[] = {
    { "open", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsSQLStatementOpenStatementFunction), (intptr_t)(2) } },
    { "close", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsSQLStatementCloseStatementFunction), (intptr_t)(1) } },
    { "prepare", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsSQLStatementPrepareStatementFunction), (intptr_t)(2) } },
};

const ClassInfo JSSQLStatementConstructor::s_info = { "SQLStatement"_s, nullptr, nullptr, nullptr, CREATE_METHOD_TABLE(JSSQLStatementConstructor) };

void JSSQLStatementConstructor::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSSQLStatementConstructor::info(), JSSQLStatementConstructorTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    auto* structure = JSSQLStatement::createStructure(vm, globalObject(), globalObject()->objectPrototype());
    auto* proto = JSSQLStatement::create(structure, reinterpret_cast<Zig::GlobalObject*>(globalObject()), nullptr, nullptr);
    this->putDirect(vm, vm.propertyNames->prototype, proto, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementBindFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{

    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto castedThis = jsDynamicCast<JSSQLStatement*>(callFrame->thisValue());

    if (!castedThis) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQLStatement"_s));
        return JSValue::encode(jsUndefined());
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(castedThis->rebind(lexicalGlobalObject, callFrame->argument(0))));
}

static inline JSC::JSValue constructResultObject(JSC::JSGlobalObject* lexicalGlobalObject, JSSQLStatement* castedThis)
{
    auto columnNames = castedThis->columnNames.data()->propertyNameVector();
    int count = columnNames.size();
    auto& vm = lexicalGlobalObject->vm();

    JSC::ObjectInitializationScope initializationScope(vm);
    JSC::JSObject* result = JSC::constructEmptyObject(lexicalGlobalObject, lexicalGlobalObject->objectPrototype(), count);
    auto* stmt = castedThis->stmt;

    for (int i = 0; i < count; i++) {
        auto name = columnNames[i];

        switch (sqlite3_column_type(stmt, i)) {
        case SQLITE_INTEGER: {
            result->putDirect(vm, name, jsNumber(sqlite3_column_int(stmt, i)), 0);
            break;
        }
        case SQLITE_FLOAT: {
            result->putDirect(vm, name, jsNumber(sqlite3_column_double(stmt, i)), 0);
            break;
        }
        case SQLITE_TEXT: {
            size_t len = sqlite3_column_bytes(stmt, i);
            const unsigned char* text = len > 0 ? sqlite3_column_text(stmt, i) : nullptr;
            if (text == nullptr || len == 0) {
                result->putDirect(vm, name, jsEmptyString(vm), 0);
                continue;
            }
            result->putDirect(vm, name, jsString(vm, WTF::String::fromUTF8(text, len)), 0);
            break;
        }
        case SQLITE_BLOB: {
            size_t len = sqlite3_column_bytes(stmt, i);
            const void* blob = len > 0 ? sqlite3_column_blob(stmt, i) : nullptr;
            JSC::JSUint8Array* array = JSC::JSUint8Array::createUninitialized(lexicalGlobalObject, lexicalGlobalObject->m_typedArrayUint8.get(lexicalGlobalObject), len);
            memcpy(array->vector(), blob, len);
            result->putDirect(vm, name, array, 0);
            break;
        }
        case SQLITE_NULL: {
            result->putDirect(vm, name, jsNull(), 0);
            break;
        }
        default: {
            break;
        }
        }
    }

    return JSValue(result);
}

static void initializeColumnNames(JSC::JSGlobalObject* globalObject, JSSQLStatement* castedThis)
{
    castedThis->hasExecuted = true;
    auto& names = castedThis->columnNames;
    auto* stmt = castedThis->stmt;

    int count = sqlite3_column_count(stmt);
    if (count == 0)
        return;
    names.data()->propertyNameVector().resizeToFit(count);
    JSC::VM& vm = globalObject->vm();
    for (int i = 0; i < count; i++) {
        const char* name = sqlite3_column_name(stmt, i);
        if (UNLIKELY(name == nullptr))
            return;

        names.add(JSC::Identifier::fromString(vm, WTF::String::fromUTF8(name)));
    }
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementExecuteStatementFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{

    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto castedThis = jsDynamicCast<JSSQLStatement*>(callFrame->thisValue());

    if (UNLIKELY(!castedThis)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected SQLStatement"_s));
        return JSValue::encode(jsUndefined());
    }

    auto* stmt = castedThis->stmt;
    if (UNLIKELY(!stmt)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Statement is not prepared"_s));
        return JSValue::encode(jsUndefined());
    }

    int statusCode = sqlite3_reset(stmt);
    if (UNLIKELY(statusCode != SQLITE_OK)) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, WTF::String::fromUTF8(sqlite3_errstr(statusCode))));
        return JSValue::encode(jsUndefined());
    }

    int count = callFrame->argumentCount();
    int limit = -1;
    int expectedCount = 10;
    if (count > 0) {
        auto arg0 = callFrame->argument(0);
        if (arg0.isObject()) {
            JSC::JSValue reb = castedThis->rebind(lexicalGlobalObject, arg0);
            if (UNLIKELY(!reb.isNumber())) {
                return JSValue::encode(reb);
            }
        } else if (arg0.isNumber()) {
            limit = arg0.toInt32(lexicalGlobalObject);
        }
    }

    if (!castedThis->hasExecuted) {
        initializeColumnNames(lexicalGlobalObject, castedThis);
    }

    auto& columnNames = castedThis->columnNames;
    // {
    //     JSC::ObjectInitializationScope initializationScope(vm);
    //     array =
    // }
    int status = sqlite3_step(stmt);

    size_t columnCount = columnNames.size();
    int counter = 0;

    if (status == SQLITE_ROW) {
        // this is a count from UPDATE or another query like that
        if (columnCount == 0) {
            RELEASE_AND_RETURN(scope, JSC::JSValue::encode(jsNumber(sqlite3_changes(castedThis->db))));
        }

        JSC::JSArray* resultArray = JSC::constructEmptyArray(lexicalGlobalObject, nullptr, 1);
        if (limit > 0) {
            while (status == SQLITE_ROW && counter < limit) {
                JSC::JSValue result = constructResultObject(lexicalGlobalObject, castedThis);
                resultArray->push(lexicalGlobalObject, result);
                status = sqlite3_step(stmt);
                counter++;
            }
        } else {
            while (status == SQLITE_ROW) {
                JSC::JSValue result = constructResultObject(lexicalGlobalObject, castedThis);
                resultArray->push(lexicalGlobalObject, result);
                status = sqlite3_step(stmt);
            }
        }

        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(resultArray));
    } else if (status == SQLITE_DONE) {
        if (columnCount == 0) {
            RELEASE_AND_RETURN(scope, JSValue::encode(jsNumber(0)));
        }

        RELEASE_AND_RETURN(scope, JSValue::encode(JSC::constructEmptyArray(lexicalGlobalObject, nullptr, 0)));
    } else {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, WTF::String::fromUTF8(sqlite3_errstr(status))));
        return JSValue::encode(jsUndefined());
    }
}

JSC_DEFINE_HOST_FUNCTION(jsSQLStatementToStringFunction, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    JSSQLStatement* thisObject = jsDynamicCast<JSSQLStatement*>(callFrame->thisValue());
    if (!thisObject) {
        return JSValue::encode(jsUndefined());
    }

    char* string = sqlite3_expanded_sql(thisObject->stmt);
    if (!string) {
        return JSValue::encode(jsEmptyString(vm));
    }
    size_t length = strlen(string);
    JSString* jsString = JSC::jsString(vm, WTF::String::fromUTF8(string, length));
    sqlite3_free(string);

    return JSValue::encode(jsString);
}

const ClassInfo JSSQLStatement::s_info = { "SQLStatement"_s, nullptr, nullptr, nullptr, CREATE_METHOD_TABLE(JSSQLStatement) };

/* Hash table for constructor */
static const HashTableValue JSSQLStatementTableValues[] = {
    { "rebind", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsSQLStatementBindFunction), (intptr_t)(1) } },
    { "run", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsSQLStatementExecuteStatementFunction), (intptr_t)(1) } },
    { "toString", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsSQLStatementToStringFunction), (intptr_t)(0) } },
};

void JSSQLStatement::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSSQLStatement::info(), JSSQLStatementTableValues, *this);
}

JSSQLStatement::~JSSQLStatement()
{
    if (this->stmt) {
        sqlite3_finalize(this->stmt);
    }
}

JSC::JSValue JSSQLStatement::rebind(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue values)
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* stmt = this->stmt;

    JSC::JSArray* array = jsDynamicCast<JSC::JSArray*>(values);

    if (!array) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Expected array"_s));
        return jsUndefined();
    }

    int count = array->length();
    int max = sqlite3_bind_parameter_count(stmt);

    if (count == 0) {
        return jsNumber(0);
    }

    if (count > max) {
        throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Too many parameters"_s));
        return jsUndefined();
    }

#define CHECK_BIND(param)
    // int result = param;                                                                                             \
    // if (UNLIKELY(result != SQLITE_OK)) {                                                                            \
    //     throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, WTF::String::fromUTF8(sqlite3_errstr(result)))); \
    //     return jsUndefined();                                                                                       \
    // }

    int i
        = 0;
    for (; i < count; i++) {
        JSC::JSValue value = array->getIndexQuickly(i);
        if (value.isUndefinedOrNull()) {
            CHECK_BIND(sqlite3_bind_null(stmt, i + 1));
        } else if (value.isBoolean()) {
            CHECK_BIND(sqlite3_bind_int(stmt, i + 1, value.toBoolean(lexicalGlobalObject) ? 1 : 0));
        } else if (value.isAnyInt()) {
            int64_t val = value.asAnyInt();
            if (val < INT_MIN || val > INT_MAX) {
                CHECK_BIND(sqlite3_bind_int64(stmt, i + 1, val));
            } else {
                CHECK_BIND(sqlite3_bind_int(stmt, i + 1, val))
            }
        } else if (value.isNumber()) {
            CHECK_BIND(sqlite3_bind_double(stmt, i + 1, value.asDouble()))
        } else if (value.isString()) {
            auto* str = value.toStringOrNull(lexicalGlobalObject);
            if (UNLIKELY(!str)) {
                throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected string"_s));
                return jsUndefined();
            }

            auto roped = str->tryGetValue(lexicalGlobalObject);
            if (UNLIKELY(!roped)) {
                throwException(lexicalGlobalObject, scope, createError(lexicalGlobalObject, "Out of memory :("_s));
                return jsUndefined();
            }

            if (roped.is8Bit()) {
                CHECK_BIND(sqlite3_bind_text(stmt, i + 1, roped.characters8(), roped.length(), nullptr));
            } else {
                CHECK_BIND(sqlite3_bind_text16(stmt, i + 1, roped.characters16(), roped.length() * 2, nullptr));
            }

        } else if (UNLIKELY(value.isHeapBigInt())) {
            CHECK_BIND(sqlite3_bind_int64(stmt, i + 1, value.asHeapBigInt()->toBigInt64()));
        } else if (value.isSymbol()) {
            continue;
        } else {
            throwException(lexicalGlobalObject, scope, createTypeError(lexicalGlobalObject, "Expected boolean, number, string, or bigint"_s));
            return jsUndefined();
        }
    }

#undef CHECK_BIND

    RELEASE_AND_RETURN(scope, jsNumber(i));
}

// template<typename Visitor>
// void JSSQLStatement::visitChildrenImpl(JSCell* cell, Visitor& visitor)
// {
//     JSSQLStatement* thisObject = jsCast<JSSQLStatement*>(cell);
//     ASSERT_GC_OBJECT_INHERITS(thisObject, info());
//     Base::visitChildren(thisObject, visitor);
// }

// DEFINE_VISIT_CHILDREN(JSSQLStatement);

// template<typename Visitor>
// void JSSQLStatementConstructor::visitChildrenImpl(JSCell* cell, Visitor& visitor)
// {
//     JSSQLStatementConstructor* thisObject = jsCast<JSSQLStatementConstructor*>(cell);
//     ASSERT_GC_OBJECT_INHERITS(thisObject, info());
//     Base::visitChildren(thisObject, visitor);
// }

// DEFINE_VISIT_CHILDREN(JSSQLStatementConstructor);

}
