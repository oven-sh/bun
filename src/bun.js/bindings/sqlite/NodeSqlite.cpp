// node:sqlite — native implementation of Node.js's `node:sqlite` module.
// See header for overview.

// Always use the bundled amalgamation for node:sqlite, regardless of
// LAZY_LOAD_SQLITE — see the header comment for rationale. Include it
// before NodeSqlite.h so the forward declarations there see the real
// struct definitions.
#include "sqlite3_local.h"

#include "NodeSqlite.h"

#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include "JSDOMBinding.h"
#include "JSDOMGlobalObjectInlines.h"
#include "DOMIsoSubspaces.h"
#include "DOMClientIsoSubspaces.h"
#include "BunClientData.h"

#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSCellInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSBigInt.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSArrayBufferViewInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/JSDestructibleObjectHeapCellType.h>
#include <wtf/StdLibExtras.h>
#include <wtf/text/MakeString.h>

// The SQLite session-extension constants (SQLITE_CHANGESET_*) are only
// defined in the amalgamation header when SQLITE_ENABLE_SESSION is set at
// compile time. node:sqlite exposes them unconditionally, so fall back to
// the documented values when the macros are unavailable.
#ifndef SQLITE_CHANGESET_OMIT
#define SQLITE_CHANGESET_OMIT 0
#define SQLITE_CHANGESET_REPLACE 1
#define SQLITE_CHANGESET_ABORT 2
#define SQLITE_CHANGESET_DATA 1
#define SQLITE_CHANGESET_NOTFOUND 2
#define SQLITE_CHANGESET_CONFLICT 3
#define SQLITE_CHANGESET_CONSTRAINT 4
#define SQLITE_CHANGESET_FOREIGN_KEY 5
#endif

namespace Bun {

using namespace JSC;
using namespace WebCore;

// ─────────────────────────────────────────────────────────────────────────────
// Error helpers (match Node.js node_sqlite.cc shapes)
// ─────────────────────────────────────────────────────────────────────────────

static JSObject* createNodeSqliteError(JSGlobalObject* globalObject, sqlite3* db)
{
    auto& vm = getVM(globalObject);
    int errcode = sqlite3_extended_errcode(db);
    const char* errstr = sqlite3_errstr(errcode);
    const char* errmsg = sqlite3_errmsg(db);
    auto* zigGlobal = defaultGlobalObject(globalObject);
    JSObject* error = createError(zigGlobal, ErrorCode::ERR_SQLITE_ERROR, WTF::String::fromUTF8(errmsg));
    error->putDirect(vm, Identifier::fromString(vm, "errcode"_s), jsNumber(errcode), 0);
    error->putDirect(vm, Identifier::fromString(vm, "errstr"_s), jsString(vm, WTF::String::fromUTF8(errstr)), 0);
    return error;
}

static void throwSqliteError(JSGlobalObject* globalObject, ThrowScope& scope, sqlite3* db)
{
    scope.throwException(globalObject, createNodeSqliteError(globalObject, db));
}

static void throwSqliteMessage(JSGlobalObject* globalObject, ThrowScope& scope, int errcode, const WTF::String& message)
{
    auto& vm = getVM(globalObject);
    auto* zigGlobal = defaultGlobalObject(globalObject);
    JSObject* error = createError(zigGlobal, ErrorCode::ERR_SQLITE_ERROR, message);
    const char* errstr = sqlite3_errstr(errcode);
    error->putDirect(vm, Identifier::fromString(vm, "errcode"_s), jsNumber(errcode), 0);
    error->putDirect(vm, Identifier::fromString(vm, "errstr"_s), jsString(vm, WTF::String::fromUTF8(errstr)), 0);
    scope.throwException(globalObject, error);
}

#define REQUIRE_DB_OPEN(db)                                                                \
    do {                                                                                   \
        if ((db)->connection() == nullptr) {                                               \
            return Bun::ERR::INVALID_STATE(scope, globalObject, "database is not open"_s); \
        }                                                                                  \
    } while (0)

#define REQUIRE_STMT(self)                                                                         \
    do {                                                                                           \
        if ((self)->isFinalized()) {                                                               \
            return Bun::ERR::INVALID_STATE(scope, globalObject, "statement has been finalized"_s); \
        }                                                                                          \
    } while (0)

static bool readBoolOption(JSGlobalObject* globalObject, ThrowScope& scope, JSObject* options, ASCIILiteral name, bool& out)
{
    auto& vm = getVM(globalObject);
    JSValue v = options->get(globalObject, Identifier::fromString(vm, name));
    RETURN_IF_EXCEPTION(scope, false);
    if (v.isUndefined()) return true;
    if (!v.isBoolean()) {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, makeString("options."_s, name), "boolean"_s, v);
        return false;
    }
    out = v.asBoolean();
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Column → JSValue conversion (Node semantics: Uint8Array for BLOB, BigInt
// gated by use_big_ints, ERR_OUT_OF_RANGE if integer overflows a JS number).
// ─────────────────────────────────────────────────────────────────────────────

static inline JSValue columnToJS(JSGlobalObject* globalObject, ThrowScope& scope, sqlite3_stmt* stmt, int i, bool useBigInts)
{
    auto& vm = getVM(globalObject);
    switch (sqlite3_column_type(stmt, i)) {
    case SQLITE_INTEGER: {
        int64_t v = sqlite3_column_int64(stmt, i);
        if (useBigInts) {
            return JSBigInt::makeHeapBigIntOrBigInt32(globalObject, v);
        }
        if (v > JSC::maxSafeInteger() || v < -JSC::maxSafeInteger()) {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_OUT_OF_RANGE,
                makeString("Value is too large to be represented as a JavaScript number: "_s, v));
            return {};
        }
        return jsNumber(static_cast<double>(v));
    }
    case SQLITE_FLOAT:
        return jsDoubleNumber(sqlite3_column_double(stmt, i));
    case SQLITE_TEXT: {
        size_t len = sqlite3_column_bytes(stmt, i);
        const unsigned char* text = sqlite3_column_text(stmt, i);
        if (len == 0 || text == nullptr) return jsEmptyString(vm);
        return jsString(vm, WTF::String::fromUTF8({ reinterpret_cast<const char*>(text), len }));
    }
    case SQLITE_NULL:
        return jsNull();
    case SQLITE_BLOB: {
        size_t len = sqlite3_column_bytes(stmt, i);
        const void* blob = sqlite3_column_blob(stmt, i);
        auto* array = JSC::JSUint8Array::createUninitialized(globalObject, globalObject->m_typedArrayUint8.get(globalObject), len);
        RETURN_IF_EXCEPTION(scope, {});
        if (len > 0) {
            memcpy(array->typedVector(), blob, len);
        }
        return array;
    }
    default:
        ASSERT_NOT_REACHED();
        return jsNull();
    }
}

static JSValue rowToObject(JSGlobalObject* globalObject, ThrowScope& scope, sqlite3_stmt* stmt, int numCols, bool useBigInts)
{
    auto& vm = getVM(globalObject);
    JSObject* row = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    RETURN_IF_EXCEPTION(scope, {});
    for (int i = 0; i < numCols; ++i) {
        JSValue v = columnToJS(globalObject, scope, stmt, i, useBigInts);
        RETURN_IF_EXCEPTION(scope, {});
        const char* name = sqlite3_column_name(stmt, i);
        row->putDirect(vm, Identifier::fromString(vm, WTF::String::fromUTF8(name)), v, 0);
    }
    return row;
}

static JSValue rowToArray(JSGlobalObject* globalObject, ThrowScope& scope, sqlite3_stmt* stmt, int numCols, bool useBigInts)
{
    auto& vm = getVM(globalObject);
    JSArray* row = constructEmptyArray(globalObject, nullptr, numCols);
    RETURN_IF_EXCEPTION(scope, {});
    for (int i = 0; i < numCols; ++i) {
        JSValue v = columnToJS(globalObject, scope, stmt, i, useBigInts);
        RETURN_IF_EXCEPTION(scope, {});
        row->putDirectIndex(globalObject, i, v);
        RETURN_IF_EXCEPTION(scope, {});
    }
    (void)vm;
    return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSDatabaseSync
// ─────────────────────────────────────────────────────────────────────────────

const ClassInfo JSDatabaseSync::s_info = { "DatabaseSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDatabaseSync) };
const ClassInfo JSDatabaseSyncPrototype::s_info = { "DatabaseSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDatabaseSyncPrototype) };
const ClassInfo JSDatabaseSyncConstructor::s_info = { "DatabaseSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDatabaseSyncConstructor) };

JSDatabaseSync* JSDatabaseSync::create(VM& vm, Structure* structure, WTF::String&& location, DatabaseSyncOpenConfiguration&& config)
{
    auto* ptr = new (NotNull, allocateCell<JSDatabaseSync>(vm)) JSDatabaseSync(vm, structure);
    ptr->finishCreation(vm);
    ptr->m_location = std::move(location);
    ptr->m_config = std::move(config);
    ptr->m_enableLoadExtension = ptr->m_config.allowExtension;
    return ptr;
}

void JSDatabaseSync::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSDatabaseSync::~JSDatabaseSync()
{
    closeInternal();
}

void JSDatabaseSync::closeInternal()
{
    // Statements are not tracked here: GC order between JSDatabaseSync and
    // its JSStatementSyncs is undefined during VM teardown, so holding raw
    // pointers back to them would dangle. sqlite3_close_v2 tolerates
    // unfinalized statements by zombifying the connection until each
    // statement is independently finalized (by ~JSStatementSync()). Every
    // JSStatementSync holds a strong WriteBarrier to this object, so during
    // normal GC the database is kept alive while any statement is reachable;
    // statements observe closure via isFinalized().
    if (m_db) {
        sqlite3_close_v2(m_db);
        m_db = nullptr;
    }
}

bool JSDatabaseSync::open(JSGlobalObject* globalObject, ThrowScope& scope)
{
    if (m_db) {
        Bun::ERR::INVALID_STATE(scope, globalObject, "database is already open"_s);
        return false;
    }

    int flags = m_config.readOnly ? SQLITE_OPEN_READONLY : (SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE);
    flags |= SQLITE_OPEN_URI;

    auto utf8 = m_location.utf8();
    sqlite3* db = nullptr;
    int r = sqlite3_open_v2(utf8.data(), &db, flags, nullptr);
    if (r != SQLITE_OK) {
        if (db) {
            throwSqliteError(globalObject, scope, db);
            sqlite3_close_v2(db);
        } else {
            throwSqliteMessage(globalObject, scope, r, WTF::String::fromUTF8(sqlite3_errstr(r)));
        }
        return false;
    }

    m_db = db;

    int v = m_config.enableDoubleQuotedStringLiterals ? 1 : 0;
    sqlite3_db_config(m_db, SQLITE_DBCONFIG_DQS_DML, v, nullptr);
    sqlite3_db_config(m_db, SQLITE_DBCONFIG_DQS_DDL, v, nullptr);

    v = m_config.enableForeignKeyConstraints ? 1 : 0;
    if (sqlite3_db_config(m_db, SQLITE_DBCONFIG_ENABLE_FKEY, v, nullptr) != SQLITE_OK) {
        throwSqliteError(globalObject, scope, m_db);
        closeInternal();
        return false;
    }

    if (sqlite3_busy_timeout(m_db, m_config.timeout) != SQLITE_OK) {
        throwSqliteError(globalObject, scope, m_db);
        closeInternal();
        return false;
    }

    if (m_config.allowExtension) {
        if (sqlite3_db_config(m_db, SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, 1, nullptr) != SQLITE_OK) {
            throwSqliteError(globalObject, scope, m_db);
            closeInternal();
            return false;
        }
    }

    return true;
}

template<typename Visitor>
void JSDatabaseSync::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSDatabaseSync>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}
DEFINE_VISIT_CHILDREN(JSDatabaseSync);

GCClient::IsoSubspace* JSDatabaseSync::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSDatabaseSync, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForNodeSqliteDatabaseSync.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeSqliteDatabaseSync = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForNodeSqliteDatabaseSync.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeSqliteDatabaseSync = std::forward<decltype(space)>(space); });
}

// ─── DatabaseSync prototype functions ───────────────────────────────────────

JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncOpen);
JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncClose);
JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncExec);
JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncPrepare);
JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncLocation);
JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncEnableLoadExtension);
JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncLoadExtension);
JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncFunction);
JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncAggregate);
JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncCreateSession);
JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncApplyChangeset);
JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncDispose);
JSC_DECLARE_CUSTOM_GETTER(jsDatabaseSyncIsOpen);
JSC_DECLARE_CUSTOM_GETTER(jsDatabaseSyncIsTransaction);

#define THIS_DATABASE()                                                                                                     \
    auto& vm = JSC::getVM(globalObject);                                                                                    \
    auto scope = DECLARE_THROW_SCOPE(vm);                                                                                   \
    JSDatabaseSync* self = dynamicDowncast<JSDatabaseSync>(callFrame->thisValue());                                         \
    if (!self) [[unlikely]] {                                                                                               \
        scope.throwException(globalObject, createInvalidThisError(globalObject, callFrame->thisValue(), "DatabaseSync"_s)); \
        return {};                                                                                                          \
    }

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncOpen, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    self->open(globalObject, scope);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncClose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    self->closeInternal();
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncDispose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    (void)vm;
    JSDatabaseSync* self = dynamicDowncast<JSDatabaseSync>(callFrame->thisValue());
    if (self && self->isOpen()) {
        self->closeInternal();
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncExec, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    JSValue sqlVal = callFrame->argument(0);
    if (!sqlVal.isString()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "sql"_s, "string"_s, sqlVal);
    }
    auto sql = sqlVal.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto utf8 = sql.utf8();
    int r = sqlite3_exec(self->connection(), utf8.data(), nullptr, nullptr, nullptr);
    if (r != SQLITE_OK) {
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncPrepare, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    JSValue sqlVal = callFrame->argument(0);
    if (!sqlVal.isString()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "sql"_s, "string"_s, sqlVal);
    }
    auto sql = sqlVal.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto utf8 = sql.utf8();
    sqlite3_stmt* stmt = nullptr;
    int r = sqlite3_prepare_v2(self->connection(), utf8.data(), static_cast<int>(utf8.length()), &stmt, nullptr);
    if (r != SQLITE_OK) {
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }
    // sqlite3_prepare_v2 returns SQLITE_OK with *ppStmt == nullptr when the
    // input contains no SQL (empty / whitespace / comment only). Node.js
    // surfaces that as ERR_INVALID_STATE at prepare() time.
    if (stmt == nullptr) {
        return Bun::ERR::INVALID_STATE(scope, globalObject,
            "The supplied SQL string contains no statements"_s);
    }
    auto* zigGlobal = defaultGlobalObject(globalObject);
    auto* structure = zigGlobal->m_JSStatementSyncClassStructure.get(zigGlobal);
    auto* stmtObj = JSStatementSync::create(vm, structure, self, stmt);
    return JSValue::encode(stmtObj);
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncLocation, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    WTF::String dbName = "main"_s;
    JSValue arg0 = callFrame->argument(0);
    if (!arg0.isUndefined()) {
        if (!arg0.isString()) {
            return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "dbName"_s, "string"_s, arg0);
        }
        dbName = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    auto utf8 = dbName.utf8();
    const char* filename = sqlite3_db_filename(self->connection(), utf8.data());
    if (filename == nullptr || filename[0] == '\0') {
        return JSValue::encode(jsNull());
    }
    return JSValue::encode(jsString(vm, WTF::String::fromUTF8(filename)));
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncEnableLoadExtension, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    JSValue arg0 = callFrame->argument(0);
    if (!arg0.isBoolean()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "allow"_s, "boolean"_s, arg0);
    }
    bool allow = arg0.asBoolean();
    if (allow && !self->allowLoadExtension()) {
        return Bun::ERR::INVALID_STATE(scope, globalObject, "extension loading is not allowed"_s);
    }
    int r = sqlite3_db_config(self->connection(), SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, allow ? 1 : 0, nullptr);
    if (r != SQLITE_OK) {
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }
    self->setEnableLoadExtension(allow);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncLoadExtension, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    if (!self->allowLoadExtension() || !self->enableLoadExtensionIsOn()) {
        return Bun::ERR::INVALID_STATE(scope, globalObject, "extension loading is not allowed"_s);
    }
    JSValue pathVal = callFrame->argument(0);
    if (!pathVal.isString()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "path"_s, "string"_s, pathVal);
    }
    auto path = pathVal.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto pathUtf8 = path.utf8();

    WTF::CString entryUtf8;
    const char* entryPtr = nullptr;
    JSValue entryVal = callFrame->argument(1);
    if (!entryVal.isUndefined()) {
        if (!entryVal.isString()) {
            return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "entryPoint"_s, "string"_s, entryVal);
        }
        auto entry = entryVal.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        entryUtf8 = entry.utf8();
        entryPtr = entryUtf8.data();
    }

    char* errmsg = nullptr;
    int r = sqlite3_load_extension(self->connection(), pathUtf8.data(), entryPtr, &errmsg);
    if (r != SQLITE_OK) {
        WTF::String message = errmsg ? WTF::String::fromUTF8(errmsg) : WTF::String::fromUTF8(sqlite3_errstr(r));
        if (errmsg) sqlite3_free(errmsg);
        Bun::throwError(globalObject, scope, ErrorCode::ERR_LOAD_SQLITE_EXTENSION, message);
        return {};
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncFunction, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_METHOD_NOT_IMPLEMENTED,
        "DatabaseSync.prototype.function is not yet implemented in Bun"_s);
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncAggregate, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_METHOD_NOT_IMPLEMENTED,
        "DatabaseSync.prototype.aggregate is not yet implemented in Bun"_s);
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncCreateSession, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_METHOD_NOT_IMPLEMENTED,
        "DatabaseSync.prototype.createSession is not yet implemented in Bun"_s);
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncApplyChangeset, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_METHOD_NOT_IMPLEMENTED,
        "DatabaseSync.prototype.applyChangeset is not yet implemented in Bun"_s);
}

JSC_DEFINE_CUSTOM_GETTER(jsDatabaseSyncIsOpen, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    JSDatabaseSync* self = dynamicDowncast<JSDatabaseSync>(JSValue::decode(thisValue));
    if (!self) return JSValue::encode(jsUndefined());
    (void)globalObject;
    return JSValue::encode(jsBoolean(self->isOpen()));
}

JSC_DEFINE_CUSTOM_GETTER(jsDatabaseSyncIsTransaction, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSDatabaseSync* self = dynamicDowncast<JSDatabaseSync>(JSValue::decode(thisValue));
    if (!self) return JSValue::encode(jsUndefined());
    if (!self->isOpen()) {
        return Bun::ERR::INVALID_STATE(scope, globalObject, "database is not open"_s);
    }
    return JSValue::encode(jsBoolean(sqlite3_get_autocommit(self->connection()) == 0));
}

static const HashTableValue JSDatabaseSyncPrototypeTableValues[] = {
    { "open"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncOpen, 0 } },
    { "close"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncClose, 0 } },
    { "exec"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncExec, 1 } },
    { "prepare"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncPrepare, 1 } },
    { "location"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncLocation, 0 } },
    { "enableLoadExtension"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncEnableLoadExtension, 1 } },
    { "loadExtension"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncLoadExtension, 1 } },
    { "function"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncFunction, 2 } },
    { "aggregate"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncAggregate, 2 } },
    { "createSession"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncCreateSession, 0 } },
    { "applyChangeset"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncApplyChangeset, 1 } },
    { "isOpen"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDatabaseSyncIsOpen, nullptr } },
    { "isTransaction"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDatabaseSyncIsTransaction, nullptr } },
};

void JSDatabaseSyncPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSDatabaseSync::info(), JSDatabaseSyncPrototypeTableValues, *this);
    // Symbol.dispose — swallow errors if not open, matching Node.js.
    putDirectNativeFunction(vm, globalObject, vm.propertyNames->disposeSymbol, 0, jsDatabaseSyncDispose, ImplementationVisibility::Public, NoIntrinsic, 0);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// ─── DatabaseSync constructor ───────────────────────────────────────────────

static bool validateDatabasePath(JSGlobalObject* globalObject, ThrowScope& scope, JSValue pathVal, WTF::String& out)
{
    auto& vm = getVM(globalObject);
    if (pathVal.isString()) {
        out = pathVal.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        return true;
    }
    // Node.js only accepts Uint8Array (and Buffer, which subclasses it).
    // Reject other TypedArrays / DataView so the error message below is
    // accurate.
    if (auto* view = dynamicDowncast<JSC::JSUint8Array>(pathVal)) {
        auto span = view->span();
        out = WTF::String::fromUTF8({ reinterpret_cast<const char*>(span.data()), span.size() });
        return true;
    }
    // URL-like object: must have href+protocol and protocol "file:"
    if (pathVal.isObject()) {
        JSObject* obj = pathVal.getObject();
        JSValue href = obj->get(globalObject, Identifier::fromString(vm, "href"_s));
        RETURN_IF_EXCEPTION(scope, false);
        JSValue proto = obj->get(globalObject, Identifier::fromString(vm, "protocol"_s));
        RETURN_IF_EXCEPTION(scope, false);
        if (href.isString() && proto.isString()) {
            auto protoStr = proto.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, false);
            if (protoStr != "file:"_s) {
                Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_URL_SCHEME, "The URL must be of scheme file:"_s);
                return false;
            }
            out = href.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, false);
            return true;
        }
    }
    Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
        "The \"path\" argument must be a string, Uint8Array, or URL without null bytes."_s);
    return false;
}

JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSDatabaseSyncConstructor::call(JSGlobalObject* globalObject, CallFrame*)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_CONSTRUCT_CALL_REQUIRED, "Cannot call constructor without `new`"_s);
}

JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSDatabaseSyncConstructor::construct(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* zigGlobal = defaultGlobalObject(globalObject);

    WTF::String location;
    if (!validateDatabasePath(globalObject, scope, callFrame->argument(0), location)) {
        return {};
    }
    if (location.find('\0') != WTF::notFound) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
            "The \"path\" argument must be a string, Uint8Array, or URL without null bytes."_s);
        return {};
    }

    DatabaseSyncOpenConfiguration config {};
    bool openImmediately = true;

    JSValue optsVal = callFrame->argument(1);
    if (!optsVal.isUndefined()) {
        if (!optsVal.isObject()) {
            return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options"_s, "Object"_s, optsVal);
        }
        JSObject* opts = optsVal.getObject();
        if (!readBoolOption(globalObject, scope, opts, "open"_s, openImmediately)) return {};
        if (!readBoolOption(globalObject, scope, opts, "readOnly"_s, config.readOnly)) return {};
        if (!readBoolOption(globalObject, scope, opts, "enableForeignKeyConstraints"_s, config.enableForeignKeyConstraints)) return {};
        if (!readBoolOption(globalObject, scope, opts, "enableDoubleQuotedStringLiterals"_s, config.enableDoubleQuotedStringLiterals)) return {};
        if (!readBoolOption(globalObject, scope, opts, "allowExtension"_s, config.allowExtension)) return {};

        JSValue timeoutVal = opts->get(globalObject, Identifier::fromString(vm, "timeout"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!timeoutVal.isUndefined()) {
            // Node.js validates with V8's IsInt32(), i.e. a finite integral
            // value within the int32 range. {timeout: Infinity} and
            // out-of-range integers must throw rather than silently
            // wrapping through ToInt32.
            bool ok = false;
            if (timeoutVal.isInt32()) {
                ok = true;
            } else if (timeoutVal.isNumber()) {
                double d = timeoutVal.asNumber();
                ok = std::isfinite(d) && std::trunc(d) == d && d >= INT32_MIN && d <= INT32_MAX;
            }
            if (!ok) {
                return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options.timeout"_s, "integer"_s, timeoutVal);
            }
            config.timeout = timeoutVal.toInt32(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    auto* structure = zigGlobal->m_JSDatabaseSyncClassStructure.get(zigGlobal);
    auto* db = JSDatabaseSync::create(vm, structure, std::move(location), std::move(config));

    if (openImmediately) {
        db->open(globalObject, scope);
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSValue::encode(db);
}

JSDatabaseSyncConstructor* JSDatabaseSyncConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* prototype)
{
    auto* ptr = new (NotNull, allocateCell<JSDatabaseSyncConstructor>(vm)) JSDatabaseSyncConstructor(vm, structure);
    ptr->finishCreation(vm, globalObject, prototype);
    return ptr;
}

void JSDatabaseSyncConstructor::finishCreation(VM& vm, JSGlobalObject*, JSObject* prototype)
{
    Base::finishCreation(vm, 1, "DatabaseSync"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

// ─────────────────────────────────────────────────────────────────────────────
// JSStatementSync
// ─────────────────────────────────────────────────────────────────────────────

const ClassInfo JSStatementSync::s_info = { "StatementSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStatementSync) };
const ClassInfo JSStatementSyncPrototype::s_info = { "StatementSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStatementSyncPrototype) };
const ClassInfo JSStatementSyncConstructor::s_info = { "StatementSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStatementSyncConstructor) };

JSStatementSync* JSStatementSync::create(VM& vm, Structure* structure, JSDatabaseSync* db, sqlite3_stmt* stmt)
{
    auto* ptr = new (NotNull, allocateCell<JSStatementSync>(vm)) JSStatementSync(vm, structure);
    ptr->finishCreation(vm, db, stmt);
    return ptr;
}

void JSStatementSync::finishCreation(VM& vm, JSDatabaseSync* db, sqlite3_stmt* stmt)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_stmt = stmt;
    m_database.set(vm, this, db);
}

void JSStatementSync::finalizeStatement()
{
    if (m_stmt) {
        sqlite3_finalize(m_stmt);
        m_stmt = nullptr;
    }
}

JSStatementSync::~JSStatementSync()
{
    // Do NOT dereference m_database here: GC may have already destroyed
    // the JSDatabaseSync, leaving the WriteBarrier pointing at freed
    // memory. sqlite3_finalize is safe even if the owning connection has
    // already been sqlite3_close_v2'd (it simply releases the zombie).
    finalizeStatement();
}

sqlite3* JSStatementSync::connection() const
{
    auto* db = m_database.get();
    return db ? db->connection() : nullptr;
}

bool JSStatementSync::isFinalized() const
{
    if (m_stmt == nullptr) return true;
    auto* db = m_database.get();
    return db == nullptr || !db->isOpen();
}

template<typename Visitor>
void JSStatementSync::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSStatementSync>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_database);
}
DEFINE_VISIT_CHILDREN(JSStatementSync);

GCClient::IsoSubspace* JSStatementSync::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSStatementSync, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForNodeSqliteStatementSync.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeSqliteStatementSync = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForNodeSqliteStatementSync.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeSqliteStatementSync = std::forward<decltype(space)>(space); });
}

// ─── Parameter binding ──────────────────────────────────────────────────────

bool JSStatementSync::bindValue(JSGlobalObject* globalObject, ThrowScope& scope, int index, JSValue value)
{
    int r = SQLITE_OK;
    if (value.isNumber()) {
        r = sqlite3_bind_double(m_stmt, index, value.asNumber());
    } else if (value.isString()) {
        auto str = value.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        auto utf8 = str.utf8();
        r = sqlite3_bind_text(m_stmt, index, utf8.data(), static_cast<int>(utf8.length()), SQLITE_TRANSIENT);
    } else if (value.isNull()) {
        r = sqlite3_bind_null(m_stmt, index);
    } else if (value.isBigInt()) {
        int64_t iv = JSBigInt::toBigInt64(value);
        // toBigInt64 truncates; detect loss by round-tripping.
        JSValue roundTrip = JSBigInt::makeHeapBigIntOrBigInt32(globalObject, static_cast<int64_t>(iv));
        RETURN_IF_EXCEPTION(scope, false);
        auto cmp = JSBigInt::compare(value, roundTrip);
        if (cmp != JSBigInt::ComparisonResult::Equal) {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE, "BigInt value is too large to bind"_s);
            return false;
        }
        r = sqlite3_bind_int64(m_stmt, index, iv);
    } else if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(value)) {
        auto span = view->span();
        r = sqlite3_bind_blob(m_stmt, index, span.data(), static_cast<int>(span.size()), SQLITE_TRANSIENT);
    } else {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
            makeString("Provided value cannot be bound to SQLite parameter "_s, index));
        return false;
    }
    if (r != SQLITE_OK) {
        throwSqliteError(globalObject, scope, connection());
        return false;
    }
    return true;
}

bool JSStatementSync::bindParams(JSGlobalObject* globalObject, ThrowScope& scope, CallFrame* callFrame)
{
    auto& vm = getVM(globalObject);
    sqlite3_clear_bindings(m_stmt);

    size_t anonStart = 0;
    size_t argc = callFrame->argumentCount();
    int paramCount = sqlite3_bind_parameter_count(m_stmt);

    // Named parameters: first argument is a plain object (not ArrayBufferView, not Array).
    if (argc > 0) {
        JSValue arg0 = callFrame->argument(0);
        if (arg0.isObject() && !dynamicDowncast<JSArrayBufferView>(arg0) && !isArray(globalObject, arg0)) {
            RETURN_IF_EXCEPTION(scope, false);
            JSObject* named = arg0.getObject();
            if (m_allowBareNamedParams && !m_bareNamedParams.has_value()) {
                m_bareNamedParams.emplace();
                for (int i = 1; i <= paramCount; ++i) {
                    const char* full = sqlite3_bind_parameter_name(m_stmt, i);
                    if (full == nullptr || full[0] == '\0') continue;
                    WTF::String fullStr = WTF::String::fromUTF8(full);
                    WTF::String bare = fullStr.substring(1);
                    auto it = m_bareNamedParams->find(bare);
                    if (it != m_bareNamedParams->end()) {
                        Bun::ERR::INVALID_STATE(scope, globalObject,
                            makeString("Cannot create bare named parameter '"_s, bare,
                                "' because of conflicting names '"_s, it->value,
                                "' and '"_s, fullStr, "'."_s));
                        return false;
                    }
                    m_bareNamedParams->add(bare, fullStr);
                }
            }

            PropertyNameArrayBuilder keys(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
            named->getOwnPropertyNames(named, globalObject, keys, DontEnumPropertiesMode::Exclude);
            RETURN_IF_EXCEPTION(scope, false);
            for (auto& key : keys) {
                WTF::String keyStr = key.string();
                auto keyUtf8 = keyStr.utf8();
                int index = sqlite3_bind_parameter_index(m_stmt, keyUtf8.data());
                if (index == 0 && m_allowBareNamedParams && m_bareNamedParams.has_value()) {
                    auto it = m_bareNamedParams->find(keyStr);
                    if (it != m_bareNamedParams->end()) {
                        auto fullUtf8 = it->value.utf8();
                        index = sqlite3_bind_parameter_index(m_stmt, fullUtf8.data());
                    }
                }
                if (index == 0) {
                    if (m_allowUnknownNamedParams) continue;
                    Bun::ERR::INVALID_STATE(scope, globalObject,
                        makeString("Unknown named parameter '"_s, keyStr, "'"_s));
                    return false;
                }
                JSValue v = named->get(globalObject, key);
                RETURN_IF_EXCEPTION(scope, false);
                if (!bindValue(globalObject, scope, index, v)) return false;
            }
            anonStart = 1;
        }
        RETURN_IF_EXCEPTION(scope, false);
    }

    // Anonymous (positional) parameters: fill slots that don't have a name.
    int anonIdx = 1;
    for (size_t i = anonStart; i < argc; ++i) {
        // Skip over any named-parameter slots.
        while (anonIdx <= paramCount && sqlite3_bind_parameter_name(m_stmt, anonIdx) != nullptr) {
            ++anonIdx;
        }
        if (!bindValue(globalObject, scope, anonIdx, callFrame->argument(i))) return false;
        ++anonIdx;
    }

    return true;
}

// ─── StatementSync prototype functions ──────────────────────────────────────

JSC_DECLARE_HOST_FUNCTION(jsStatementSyncRun);
JSC_DECLARE_HOST_FUNCTION(jsStatementSyncGet);
JSC_DECLARE_HOST_FUNCTION(jsStatementSyncAll);
JSC_DECLARE_HOST_FUNCTION(jsStatementSyncIterate);
JSC_DECLARE_HOST_FUNCTION(jsStatementSyncColumns);
JSC_DECLARE_HOST_FUNCTION(jsStatementSyncSetReadBigInts);
JSC_DECLARE_HOST_FUNCTION(jsStatementSyncSetReturnArrays);
JSC_DECLARE_HOST_FUNCTION(jsStatementSyncSetAllowBareNamedParameters);
JSC_DECLARE_HOST_FUNCTION(jsStatementSyncSetAllowUnknownNamedParameters);
JSC_DECLARE_CUSTOM_GETTER(jsStatementSyncSourceSQL);
JSC_DECLARE_CUSTOM_GETTER(jsStatementSyncExpandedSQL);

#define THIS_STATEMENT()                                                                                                     \
    auto& vm = JSC::getVM(globalObject);                                                                                     \
    auto scope = DECLARE_THROW_SCOPE(vm);                                                                                    \
    JSStatementSync* self = dynamicDowncast<JSStatementSync>(callFrame->thisValue());                                        \
    if (!self) [[unlikely]] {                                                                                                \
        scope.throwException(globalObject, createInvalidThisError(globalObject, callFrame->thisValue(), "StatementSync"_s)); \
        return {};                                                                                                           \
    }

struct StatementResetter {
    sqlite3_stmt* stmt;
    ~StatementResetter()
    {
        if (stmt) sqlite3_reset(stmt);
    }
};

JSC_DEFINE_HOST_FUNCTION(jsStatementSyncRun, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_STATEMENT();
    REQUIRE_STMT(self);
    sqlite3_reset(self->statement());
    if (!self->bindParams(globalObject, scope, callFrame)) return {};
    StatementResetter resetter { self->statement() };

    int r = sqlite3_step(self->statement());
    while (r == SQLITE_ROW) {
        r = sqlite3_step(self->statement());
    }
    if (r != SQLITE_DONE && r != SQLITE_OK) {
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }

    sqlite3* db = self->connection();
    JSObject* result = constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
    RETURN_IF_EXCEPTION(scope, {});
    sqlite3_int64 changes = sqlite3_changes64(db);
    sqlite3_int64 rowid = sqlite3_last_insert_rowid(db);
    if (self->useBigInts()) {
        result->putDirect(vm, Identifier::fromString(vm, "changes"_s), JSBigInt::makeHeapBigIntOrBigInt32(globalObject, static_cast<int64_t>(changes)), 0);
        RETURN_IF_EXCEPTION(scope, {});
        result->putDirect(vm, Identifier::fromString(vm, "lastInsertRowid"_s), JSBigInt::makeHeapBigIntOrBigInt32(globalObject, static_cast<int64_t>(rowid)), 0);
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        result->putDirect(vm, Identifier::fromString(vm, "changes"_s), jsNumber(static_cast<double>(changes)), 0);
        result->putDirect(vm, Identifier::fromString(vm, "lastInsertRowid"_s), jsNumber(static_cast<double>(rowid)), 0);
    }
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsStatementSyncGet, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_STATEMENT();
    REQUIRE_STMT(self);
    sqlite3_reset(self->statement());
    if (!self->bindParams(globalObject, scope, callFrame)) return {};
    StatementResetter resetter { self->statement() };

    int r = sqlite3_step(self->statement());
    if (r == SQLITE_DONE) return JSValue::encode(jsUndefined());
    if (r != SQLITE_ROW) {
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }
    int numCols = sqlite3_column_count(self->statement());
    if (numCols == 0) return JSValue::encode(jsUndefined());
    JSValue row = self->returnArrays()
        ? rowToArray(globalObject, scope, self->statement(), numCols, self->useBigInts())
        : rowToObject(globalObject, scope, self->statement(), numCols, self->useBigInts());
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(row);
}

JSC_DEFINE_HOST_FUNCTION(jsStatementSyncAll, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_STATEMENT();
    REQUIRE_STMT(self);
    sqlite3_reset(self->statement());
    if (!self->bindParams(globalObject, scope, callFrame)) return {};
    StatementResetter resetter { self->statement() };

    JSArray* rows = constructEmptyArray(globalObject, nullptr, 0);
    RETURN_IF_EXCEPTION(scope, {});
    int numCols = sqlite3_column_count(self->statement());
    int r;
    while ((r = sqlite3_step(self->statement())) == SQLITE_ROW) {
        JSValue row = self->returnArrays()
            ? rowToArray(globalObject, scope, self->statement(), numCols, self->useBigInts())
            : rowToObject(globalObject, scope, self->statement(), numCols, self->useBigInts());
        RETURN_IF_EXCEPTION(scope, {});
        rows->push(globalObject, row);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (r != SQLITE_DONE) {
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }
    return JSValue::encode(rows);
}

JSC_DEFINE_HOST_FUNCTION(jsStatementSyncIterate, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    // For now, eagerly collect into an array and return its iterator. A proper
    // streaming iterator can replace this later without changing the API.
    THIS_STATEMENT();
    REQUIRE_STMT(self);
    sqlite3_reset(self->statement());
    if (!self->bindParams(globalObject, scope, callFrame)) return {};
    StatementResetter resetter { self->statement() };

    JSArray* rows = constructEmptyArray(globalObject, nullptr, 0);
    RETURN_IF_EXCEPTION(scope, {});
    int numCols = sqlite3_column_count(self->statement());
    int r;
    while ((r = sqlite3_step(self->statement())) == SQLITE_ROW) {
        JSValue row = self->returnArrays()
            ? rowToArray(globalObject, scope, self->statement(), numCols, self->useBigInts())
            : rowToObject(globalObject, scope, self->statement(), numCols, self->useBigInts());
        RETURN_IF_EXCEPTION(scope, {});
        rows->push(globalObject, row);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (r != SQLITE_DONE) {
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }

    JSValue iterFn = rows->get(globalObject, vm.propertyNames->iteratorSymbol);
    RETURN_IF_EXCEPTION(scope, {});
    auto callData = JSC::getCallData(iterFn);
    if (callData.type == CallData::Type::None) {
        return JSValue::encode(rows);
    }
    MarkedArgumentBuffer args;
    JSValue iterator = JSC::call(globalObject, iterFn, callData, rows, args);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(iterator);
}

JSC_DEFINE_HOST_FUNCTION(jsStatementSyncColumns, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_STATEMENT();
    REQUIRE_STMT(self);
    int numCols = sqlite3_column_count(self->statement());
    JSArray* out = constructEmptyArray(globalObject, nullptr, numCols);
    RETURN_IF_EXCEPTION(scope, {});
    for (int i = 0; i < numCols; ++i) {
        JSObject* col = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
        RETURN_IF_EXCEPTION(scope, {});
        auto putStr = [&](ASCIILiteral key, const char* val) {
            col->putDirect(vm, Identifier::fromString(vm, key), val ? jsString(vm, WTF::String::fromUTF8(val)) : jsNull(), 0);
        };
#ifdef SQLITE_ENABLE_COLUMN_METADATA
        putStr("column"_s, sqlite3_column_origin_name(self->statement(), i));
        putStr("database"_s, sqlite3_column_database_name(self->statement(), i));
#else
        putStr("column"_s, nullptr);
        putStr("database"_s, nullptr);
#endif
        putStr("name"_s, sqlite3_column_name(self->statement(), i));
#ifdef SQLITE_ENABLE_COLUMN_METADATA
        putStr("table"_s, sqlite3_column_table_name(self->statement(), i));
#else
        putStr("table"_s, nullptr);
#endif
        putStr("type"_s, sqlite3_column_decltype(self->statement(), i));
        out->putDirectIndex(globalObject, i, col);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(out);
}

#define DEFINE_STMT_BOOL_SETTER(fnName, setter, argName)                                     \
    JSC_DEFINE_HOST_FUNCTION(fnName, (JSGlobalObject * globalObject, CallFrame * callFrame)) \
    {                                                                                        \
        THIS_STATEMENT();                                                                    \
        REQUIRE_STMT(self);                                                                  \
        JSValue v = callFrame->argument(0);                                                  \
        if (!v.isBoolean()) {                                                                \
            return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, argName, "boolean"_s, v); \
        }                                                                                    \
        self->setter(v.asBoolean());                                                         \
        return JSValue::encode(jsUndefined());                                               \
    }

DEFINE_STMT_BOOL_SETTER(jsStatementSyncSetReadBigInts, setUseBigInts, "readBigInts"_s)
DEFINE_STMT_BOOL_SETTER(jsStatementSyncSetReturnArrays, setReturnArrays, "returnArrays"_s)
DEFINE_STMT_BOOL_SETTER(jsStatementSyncSetAllowBareNamedParameters, setAllowBareNamedParams, "allowBareNamedParameters"_s)
DEFINE_STMT_BOOL_SETTER(jsStatementSyncSetAllowUnknownNamedParameters, setAllowUnknownNamedParams, "allowUnknownNamedParameters"_s)

JSC_DEFINE_CUSTOM_GETTER(jsStatementSyncSourceSQL, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSStatementSync* self = dynamicDowncast<JSStatementSync>(JSValue::decode(thisValue));
    if (!self) return JSValue::encode(jsUndefined());
    if (self->isFinalized()) {
        return Bun::ERR::INVALID_STATE(scope, globalObject, "statement has been finalized"_s);
    }
    const char* sql = sqlite3_sql(self->statement());
    return JSValue::encode(jsString(vm, WTF::String::fromUTF8(sql ? sql : "")));
}

JSC_DEFINE_CUSTOM_GETTER(jsStatementSyncExpandedSQL, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSStatementSync* self = dynamicDowncast<JSStatementSync>(JSValue::decode(thisValue));
    if (!self) return JSValue::encode(jsUndefined());
    if (self->isFinalized()) {
        return Bun::ERR::INVALID_STATE(scope, globalObject, "statement has been finalized"_s);
    }
    char* expanded = sqlite3_expanded_sql(self->statement());
    if (!expanded) {
        throwSqliteMessage(globalObject, scope, SQLITE_NOMEM, "Expanded SQL text would exceed configured limits"_s);
        return {};
    }
    JSValue result = jsString(vm, WTF::String::fromUTF8(expanded));
    sqlite3_free(expanded);
    return JSValue::encode(result);
}

static const HashTableValue JSStatementSyncPrototypeTableValues[] = {
    { "run"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatementSyncRun, 0 } },
    { "get"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatementSyncGet, 0 } },
    { "all"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatementSyncAll, 0 } },
    { "iterate"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatementSyncIterate, 0 } },
    { "columns"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatementSyncColumns, 0 } },
    { "setReadBigInts"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatementSyncSetReadBigInts, 1 } },
    { "setReturnArrays"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatementSyncSetReturnArrays, 1 } },
    { "setAllowBareNamedParameters"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatementSyncSetAllowBareNamedParameters, 1 } },
    { "setAllowUnknownNamedParameters"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatementSyncSetAllowUnknownNamedParameters, 1 } },
    { "sourceSQL"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsStatementSyncSourceSQL, nullptr } },
    { "expandedSQL"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsStatementSyncExpandedSQL, nullptr } },
};

void JSStatementSyncPrototype::finishCreation(VM& vm, JSGlobalObject*)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSStatementSync::info(), JSStatementSyncPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSStatementSyncConstructor::call(JSGlobalObject* globalObject, CallFrame*)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Illegal constructor"_s);
}

JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSStatementSyncConstructor::construct(JSGlobalObject* globalObject, CallFrame*)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Illegal constructor"_s);
}

JSStatementSyncConstructor* JSStatementSyncConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* prototype)
{
    auto* ptr = new (NotNull, allocateCell<JSStatementSyncConstructor>(vm)) JSStatementSyncConstructor(vm, structure);
    ptr->finishCreation(vm, globalObject, prototype);
    return ptr;
}

void JSStatementSyncConstructor::finishCreation(VM& vm, JSGlobalObject*, JSObject* prototype)
{
    Base::finishCreation(vm, 0, "StatementSync"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level exports
// ─────────────────────────────────────────────────────────────────────────────

JSC_DEFINE_HOST_FUNCTION(jsNodeSqliteBackup, (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_METHOD_NOT_IMPLEMENTED,
        "node:sqlite backup() is not yet implemented in Bun"_s);
}

JSValue createNodeSqliteConstants(VM& vm, JSGlobalObject* globalObject)
{
    JSObject* obj = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    auto put = [&](ASCIILiteral key, int value) {
        obj->putDirect(vm, Identifier::fromString(vm, key), jsNumber(value), PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete | 0);
    };
    put("SQLITE_CHANGESET_OMIT"_s, SQLITE_CHANGESET_OMIT);
    put("SQLITE_CHANGESET_REPLACE"_s, SQLITE_CHANGESET_REPLACE);
    put("SQLITE_CHANGESET_ABORT"_s, SQLITE_CHANGESET_ABORT);
    put("SQLITE_CHANGESET_DATA"_s, SQLITE_CHANGESET_DATA);
    put("SQLITE_CHANGESET_NOTFOUND"_s, SQLITE_CHANGESET_NOTFOUND);
    put("SQLITE_CHANGESET_CONFLICT"_s, SQLITE_CHANGESET_CONFLICT);
    put("SQLITE_CHANGESET_CONSTRAINT"_s, SQLITE_CHANGESET_CONSTRAINT);
    put("SQLITE_CHANGESET_FOREIGN_KEY"_s, SQLITE_CHANGESET_FOREIGN_KEY);
    return obj;
}

} // namespace Bun
