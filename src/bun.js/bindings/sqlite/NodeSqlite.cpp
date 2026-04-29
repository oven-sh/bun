// node:sqlite — native implementation of Node.js's `node:sqlite` module.
// See header for overview.

// Always use the bundled amalgamation for node:sqlite, regardless of
// LAZY_LOAD_SQLITE — see the header comment for rationale. The session
// extension (createSession/applyChangeset) is only declared in the header
// when SQLITE_ENABLE_SESSION is defined — sqlite3.c is compiled with that
// flag via the sqlite build target (scripts/build/deps/sqlite.ts), so turn
// it on here as well to expose the prototypes. SQLITE_ENABLE_COLUMN_METADATA
// likewise gates sqlite3_column_{origin,table,database}_name.
#ifndef SQLITE_ENABLE_SESSION
#define SQLITE_ENABLE_SESSION 1
#endif
#ifndef SQLITE_ENABLE_PREUPDATE_HOOK
#define SQLITE_ENABLE_PREUPDATE_HOOK 1
#endif
#ifndef SQLITE_ENABLE_COLUMN_METADATA
#define SQLITE_ENABLE_COLUMN_METADATA 1
#endif
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
#include <JavaScriptCore/StrongInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSIteratorPrototype.h>
#include <JavaScriptCore/TopExceptionScope.h>
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

// process.versions.sqlite — reported from this TU (not JSSQLStatement.cpp)
// because on macOS's LAZY_LOAD_SQLITE path that file sees the *system*
// sqlite3.h and would report Apple's SDK version, whereas node:sqlite always
// links the bundled amalgamation included above.
extern "C" const char* Bun__sqlite3_version()
{
    return SQLITE_VERSION;
}

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

// Pin the owning database for the duration of a StatementSync call that
// may re-enter JS (bindParams getters, UDFs, aggregate callbacks). Must
// follow REQUIRE_STMT so database() is known live.
#define BUSY_SCOPE_STMT(self) \
    JSDatabaseSync::BusyScope busy__ { (self)->database() }

// Node.js's node_sqlite.cc validation errors use a fixed phrasing that the
// upstream test suite asserts on verbatim. Bun's generic ERR_INVALID_ARG_TYPE
// helper produces a slightly different sentence, so emit Node's form here.
static EncodedJSValue throwNodeArgType(JSGlobalObject* globalObject, ThrowScope& scope, ASCIILiteral argName, ASCIILiteral typeName)
{
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
        makeString("The \""_s, argName, "\" argument must be "_s, typeName, "."_s));
}

static bool readBoolOption(JSGlobalObject* globalObject, ThrowScope& scope, JSObject* options, ASCIILiteral name, bool& out)
{
    auto& vm = getVM(globalObject);
    JSValue v = options->get(globalObject, Identifier::fromString(vm, name));
    RETURN_IF_EXCEPTION(scope, false);
    if (v.isUndefined()) return true;
    if (!v.isBoolean()) {
        // Match Node.js's node_sqlite.cc error text exactly — the upstream
        // tests assert on the message string, not just the code.
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
            makeString("The \"options."_s, name, "\" argument must be a boolean."_s));
        return false;
    }
    out = v.asBoolean();
    return true;
}

// After a sqlite3_step/sqlite3_exec that may have re-entered JS via a
// user-defined function: if the JS callback threw, the pending exception
// on the VM is the real error and any SQLITE_ERROR from sqlite is just
// the "user function raised an exception" wrapper. Propagate the JS
// exception instead. Expands to RETURN_IF_EXCEPTION so JSC's
// validateExceptionChecks records the check after each step() — a plain
// `if (scope.exception())` does not satisfy it.
#define CHECK_UDF_EXCEPTION(scope, db)             \
    do {                                           \
        if (db) (db)->takeIgnoreNextSqliteError(); \
        RETURN_IF_EXCEPTION(scope, {});            \
    } while (0)

// ─────────────────────────────────────────────────────────────────────────────
// sqlite3_value* ⇄ JSValue conversions for user-defined functions and
// aggregates. These mirror columnToJS() but operate on the xFunc argv.
// ─────────────────────────────────────────────────────────────────────────────
//
// These conversion helpers are called from sqlite's xFunc/xStep callbacks,
// which run INSIDE sqlite3_step() and may be re-invoked many times before
// control returns to the outer JS→native host function. A nested ThrowScope
// would simulateThrow() in its destructor on every iteration, tripping JSC's
// validateExceptionChecks on the next callback's constructor. So the callbacks
// use a TopExceptionScope (whose destructor does not simulate a throw) and
// this helper throws via vm.throwException directly rather than taking a
// ThrowScope&. The outer host function's own ThrowScope observes the final
// result via CHECK_UDF_EXCEPTION after sqlite3_step returns.

static JSValue sqliteValueToJS(JSGlobalObject* globalObject, TopExceptionScope& outer, sqlite3_value* value, bool useBigInts)
{
    auto& vm = getVM(globalObject);
    switch (sqlite3_value_type(value)) {
    case SQLITE_INTEGER: {
        int64_t v = sqlite3_value_int64(value);
        if (useBigInts) {
            return JSBigInt::makeHeapBigIntOrBigInt32(globalObject, v);
        }
        if (v > JSC::maxSafeInteger() || v < -JSC::maxSafeInteger()) {
            // Rare edge case — open a transient ThrowScope just to raise
            // the error. Its destructor's simulateThrow() sets the
            // need-check flag, which the caller clears via
            // outer.exception() immediately on return; release so the
            // destructor's own verify doesn't object to the error we just
            // threw.
            auto scope = DECLARE_THROW_SCOPE(vm);
            Bun::throwError(globalObject, scope, ErrorCode::ERR_OUT_OF_RANGE,
                makeString("Value is too large to be represented as a JavaScript number: "_s, v));
            scope.release();
            return {};
        }
        return jsNumber(static_cast<double>(v));
    }
    case SQLITE_FLOAT:
        return jsDoubleNumber(sqlite3_value_double(value));
    case SQLITE_TEXT: {
        size_t len = sqlite3_value_bytes(value);
        const unsigned char* text = sqlite3_value_text(value);
        if (len == 0 || text == nullptr) return jsEmptyString(vm);
        return jsString(vm, WTF::String::fromUTF8({ reinterpret_cast<const char*>(text), len }));
    }
    case SQLITE_NULL:
        return jsNull();
    case SQLITE_BLOB: {
        size_t len = sqlite3_value_bytes(value);
        const void* blob = sqlite3_value_blob(value);
        auto* array = JSC::JSUint8Array::createUninitialized(globalObject, globalObject->m_typedArrayUint8.get(globalObject), len);
        if (outer.exception()) [[unlikely]]
            return {};
        if (len > 0) memcpy(array->typedVector(), blob, len);
        return array;
    }
    default:
        return jsNull();
    }
    (void)outer;
}

// Write a JS return value back into an sqlite3_context*. On type mismatch
// this calls sqlite3_result_error with the same strings Node.js uses; the
// outer step() will then surface that as ERR_SQLITE_ERROR.
static void jsValueToSqliteResult(JSGlobalObject* globalObject, sqlite3_context* ctx, JSValue value)
{
    if (value.isUndefinedOrNull()) {
        sqlite3_result_null(ctx);
    } else if (value.isInt32()) {
        // Match bindValue(): int32 results keep INTEGER storage class so
        // `typeof(udf())` on a function returning 42 yields 'integer'.
        sqlite3_result_int(ctx, value.asInt32());
    } else if (value.isNumber()) {
        sqlite3_result_double(ctx, value.asNumber());
    } else if (value.isString()) {
        auto str = value.toWTFString(globalObject);
        if (str.isNull()) {
            sqlite3_result_error(ctx, "", 0);
            return;
        }
        auto utf8 = str.utf8();
        sqlite3_result_text(ctx, utf8.data(), static_cast<int>(utf8.length()), SQLITE_TRANSIENT);
    } else if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(value)) {
        auto span = view->span();
        sqlite3_result_blob(ctx, span.data(), static_cast<int>(span.size()), SQLITE_TRANSIENT);
    } else if (value.isBigInt()) {
        int64_t as_int = JSBigInt::toBigInt64(value);
        JSValue roundTrip = JSBigInt::makeHeapBigIntOrBigInt32(globalObject, as_int);
        if (!roundTrip || JSBigInt::compare(value, roundTrip) != JSBigInt::ComparisonResult::Equal) {
            sqlite3_result_error(ctx, "BigInt value is too large for SQLite", -1);
            return;
        }
        sqlite3_result_int64(ctx, as_int);
    } else if (value.inherits<JSPromise>()) {
        sqlite3_result_error(ctx, "Asynchronous user-defined functions are not supported", -1);
    } else {
        sqlite3_result_error(ctx, "Returned JavaScript value cannot be converted to a SQLite value", -1);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// User-defined scalar functions (DatabaseSync.prototype.function)
//
// The context object lives for as long as the function is registered on the
// connection. sqlite3_create_function_v2's xDestroy fires on sqlite3_close or
// when the function is re-registered/removed, so we hold a Strong<> root to
// keep the JS callback alive across GC independent of any JSCell. The
// raw db_ pointer is safe because the context is destroyed before
// JSDatabaseSync (xDestroy runs inside sqlite3_close_v2 which closeInternal()
// calls from ~JSDatabaseSync()).
// ─────────────────────────────────────────────────────────────────────────────

struct NodeSqliteUDF {
    WTF_MAKE_TZONE_ALLOCATED_INLINE(NodeSqliteUDF);

public:
    NodeSqliteUDF(VM& vm, JSGlobalObject* globalObject, JSDatabaseSync* db, JSObject* fn, bool useBigIntArgs)
        : globalObject_(globalObject)
        , db_(db)
        , fn_(vm, fn)
        , useBigIntArgs_(useBigIntArgs)
    {
    }

    static void xFunc(sqlite3_context* ctx, int argc, sqlite3_value** argv)
    {
        auto* self = static_cast<NodeSqliteUDF*>(sqlite3_user_data(ctx));
        auto* globalObject = self->globalObject_;
        auto& vm = getVM(globalObject);
        // TopExceptionScope (not ThrowScope): sqlite may invoke this callback
        // many times per sqlite3_step(), and a ThrowScope's destructor
        // simulateThrow() would trip validateExceptionChecks on the next
        // invocation's constructor. TopExceptionScope's destructor doesn't
        // simulate, so the only requirement is that we consume each inner
        // scope's need-check via scope.exception() before returning. The
        // pending exception itself is left on the VM for the outer host
        // function to observe via CHECK_UDF_EXCEPTION.
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

        auto abortWithPending = [&] {
            self->db_->setIgnoreNextSqliteError();
            sqlite3_result_error(ctx, "", 0);
        };
        if (scope.exception()) [[unlikely]]
            return abortWithPending();

        MarkedArgumentBuffer args;
        args.ensureCapacity(argc);
        for (int i = 0; i < argc; ++i) {
            JSValue v = sqliteValueToJS(globalObject, scope, argv[i], self->useBigIntArgs_);
            if (scope.exception()) [[unlikely]]
                return abortWithPending();
            args.append(v);
        }

        JSValue fn = self->fn_.get();
        auto callData = JSC::getCallData(fn);
        JSValue result = JSC::call(globalObject, fn, callData, jsUndefined(), args);
        if (scope.exception()) [[unlikely]]
            return abortWithPending();
        jsValueToSqliteResult(globalObject, ctx, result);
        if (scope.exception()) [[unlikely]]
            return abortWithPending();
    }

    static void xDestroy(void* p) { delete static_cast<NodeSqliteUDF*>(p); }

    JSGlobalObject* globalObject_;
    JSDatabaseSync* db_;
    JSC::Strong<JSObject> fn_;
    bool useBigIntArgs_;
};

// ─────────────────────────────────────────────────────────────────────────────
// User-defined aggregate functions (DatabaseSync.prototype.aggregate)
//
// Per-invocation accumulator state lives in sqlite3_aggregate_context — a
// scratch buffer SQLite zeroes on first access and discards after xFinal. We
// store a Strong<> there so the JS accumulator value survives GC between
// xStep calls (window functions step across multiple sqlite3_step()s).
// ─────────────────────────────────────────────────────────────────────────────

struct NodeSqliteAggregate {
    WTF_MAKE_TZONE_ALLOCATED_INLINE(NodeSqliteAggregate);

public:
    struct State {
        JSC::Strong<JSC::Unknown> value;
        bool initialized;
        bool isWindow;
    };

    NodeSqliteAggregate(VM& vm, JSGlobalObject* globalObject, JSDatabaseSync* db,
        JSValue start, JSObject* step, JSObject* result, JSObject* inverse, bool useBigIntArgs)
        : globalObject_(globalObject)
        , db_(db)
        , start_(vm, start)
        , step_(vm, step)
        , result_(vm, result)
        , inverse_(vm, inverse)
        , useBigIntArgs_(useBigIntArgs)
    {
    }

    State* getState(sqlite3_context* ctx, TopExceptionScope& scope)
    {
        auto* state = static_cast<State*>(sqlite3_aggregate_context(ctx, sizeof(State)));
        if (state == nullptr) return nullptr;
        if (!state->initialized) {
            // sqlite3_aggregate_context zero-fills on first call, so
            // placement-new to bring the Strong<> to a valid empty state
            // before assigning. Seed value with jsUndefined() up front so
            // that if start() throws and xFinal runs afterwards, it sees a
            // well-formed JSValue rather than an empty Strong handle.
            new (state) State();
            state->initialized = true;

            auto& vm = getVM(globalObject_);
            state->value.set(vm, jsUndefined());
            JSValue startV = start_.get();
            if (startV.isCallable()) {
                auto callData = JSC::getCallData(startV);
                MarkedArgumentBuffer noArgs;
                startV = JSC::call(globalObject_, startV, callData, jsNull(), noArgs);
                if (scope.exception()) [[unlikely]] {
                    db_->setIgnoreNextSqliteError();
                    sqlite3_result_error(ctx, "", 0);
                    return nullptr;
                }
            }
            state->value.set(vm, startV);
        }
        return state;
    }

    static void destroyState(sqlite3_context* ctx)
    {
        auto* state = static_cast<State*>(sqlite3_aggregate_context(ctx, 0));
        if (state && state->initialized) {
            state->~State();
            state->initialized = false;
        }
    }

    void stepBase(sqlite3_context* ctx, int argc, sqlite3_value** argv, JSObject* fn)
    {
        auto& vm = getVM(globalObject_);
        // TopExceptionScope — see the rationale on xFunc. Pending exceptions
        // are deliberately left on the VM for the outer step()/exec() to
        // observe via CHECK_UDF_EXCEPTION.
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        auto abortWithPending = [&] {
            db_->setIgnoreNextSqliteError();
            sqlite3_result_error(ctx, "", 0);
        };
        if (scope.exception()) [[unlikely]]
            return;
        auto* state = getState(ctx, scope);
        if (!state) return;

        MarkedArgumentBuffer args;
        args.ensureCapacity(argc + 1);
        args.append(state->value.get());
        for (int i = 0; i < argc; ++i) {
            JSValue v = sqliteValueToJS(globalObject_, scope, argv[i], useBigIntArgs_);
            if (scope.exception()) [[unlikely]]
                return abortWithPending();
            args.append(v);
        }

        auto callData = JSC::getCallData(fn);
        JSValue ret = JSC::call(globalObject_, fn, callData, jsUndefined(), args);
        if (scope.exception()) [[unlikely]]
            return abortWithPending();
        state->value.set(vm, ret);
    }

    void valueBase(sqlite3_context* ctx, bool isFinal)
    {
        auto& vm = getVM(globalObject_);
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        (void)vm;
        // An exception from an earlier xStep may still be pending —
        // don't re-enter JS (or overwrite sqlite3_result_error with a
        // NULL result) in that case; just tear down the state.
        if (scope.exception()) [[unlikely]] {
            if (isFinal) destroyState(ctx);
            return;
        }
        auto* state = getState(ctx, scope);
        if (!state) {
            if (isFinal) destroyState(ctx);
            return;
        }

        if (!isFinal) {
            state->isWindow = true;
        } else if (state->isWindow) {
            // Window aggregates emit their result via xValue; xFinal is only
            // a cleanup signal and must not emit again.
            destroyState(ctx);
            return;
        }

        JSValue result;
        if (JSObject* rfn = result_.get()) {
            MarkedArgumentBuffer args;
            args.append(state->value.get());
            auto callData = JSC::getCallData(rfn);
            result = JSC::call(globalObject_, rfn, callData, jsNull(), args);
            if (scope.exception()) [[unlikely]] {
                db_->setIgnoreNextSqliteError();
                sqlite3_result_error(ctx, "", 0);
                if (isFinal) destroyState(ctx);
                return;
            }
        } else {
            result = state->value.get();
        }
        jsValueToSqliteResult(globalObject_, ctx, result);
        if (scope.exception()) [[unlikely]] {
            db_->setIgnoreNextSqliteError();
        }
        if (isFinal) destroyState(ctx);
    }

    static void xStep(sqlite3_context* ctx, int argc, sqlite3_value** argv)
    {
        auto* self = static_cast<NodeSqliteAggregate*>(sqlite3_user_data(ctx));
        self->stepBase(ctx, argc, argv, self->step_.get());
    }
    static void xInverse(sqlite3_context* ctx, int argc, sqlite3_value** argv)
    {
        auto* self = static_cast<NodeSqliteAggregate*>(sqlite3_user_data(ctx));
        self->stepBase(ctx, argc, argv, self->inverse_.get());
    }
    static void xFinal(sqlite3_context* ctx)
    {
        auto* self = static_cast<NodeSqliteAggregate*>(sqlite3_user_data(ctx));
        self->valueBase(ctx, true);
    }
    static void xValue(sqlite3_context* ctx)
    {
        auto* self = static_cast<NodeSqliteAggregate*>(sqlite3_user_data(ctx));
        self->valueBase(ctx, false);
    }
    static void xDestroy(void* p) { delete static_cast<NodeSqliteAggregate*>(p); }

    JSGlobalObject* globalObject_;
    JSDatabaseSync* db_;
    JSC::Strong<JSC::Unknown> start_;
    JSC::Strong<JSObject> step_;
    JSC::Strong<JSObject> result_;
    JSC::Strong<JSObject> inverse_;
    bool useBigIntArgs_;
};

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
    //
    // Sessions are different — the preupdate hook they install keeps a
    // back-pointer into the connection, and sqlite3_close_v2 does NOT
    // tear them down, so delete any that JS hasn't already closed.
    if (m_db) {
        for (auto* s : m_sessions) {
            sqlite3session_delete(s);
        }
        m_sessions.clear();
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

    // No SQLITE_OPEN_URI: validateDatabasePath() already decodes file:
    // URLs to plain paths, and enabling URI mode here would make string
    // paths starting with "file:" leak ?nolock=/vfs=/mode=ro/cache= into
    // the connection — Node passes the string verbatim as a filename.
    int flags = m_config.readOnly ? SQLITE_OPEN_READONLY : (SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE);

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
    ++m_openGeneration;

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
    if (self->isBusy()) {
        // A native call on this connection is on the stack (option-getter,
        // UDF, xFilter, progress, …). Closing now would null/free the
        // sqlite3* out from under it — see BusyScope users below.
        return Bun::ERR::INVALID_STATE(scope, globalObject,
            "cannot close database while a statement is executing"_s);
    }
    self->closeInternal();
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncDispose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    (void)vm;
    JSDatabaseSync* self = dynamicDowncast<JSDatabaseSync>(callFrame->thisValue());
    if (self && self->isOpen() && !self->isBusy()) {
        self->closeInternal();
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncExec, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    JSDatabaseSync::BusyScope busy { self };
    JSValue sqlVal = callFrame->argument(0);
    if (!sqlVal.isString()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "sql"_s, "string"_s, sqlVal);
    }
    auto sql = sqlVal.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto utf8 = sql.utf8();
    int r = sqlite3_exec(self->connection(), utf8.data(), nullptr, nullptr, nullptr);
    CHECK_UDF_EXCEPTION(scope, self);
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
    JSDatabaseSync::BusyScope busy { self };
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
    // Inherit the database-level defaults (set via the constructor options),
    // then let prepare()'s own options override per-statement.
    const auto& cfg = self->config();
    bool readBigInts = cfg.readBigInts;
    bool returnArrays = cfg.returnArrays;
    bool allowBare = cfg.allowBareNamedParameters;
    bool allowUnknown = cfg.allowUnknownNamedParameters;

    JSValue optsVal = callFrame->argument(1);
    if (!optsVal.isUndefined()) {
        if (!optsVal.isObject()) {
            sqlite3_finalize(stmt);
            return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                "The \"options\" argument must be an object."_s);
        }
        JSObject* opts = optsVal.getObject();
        auto fail = [&]() { sqlite3_finalize(stmt); return EncodedJSValue {}; };
        if (!readBoolOption(globalObject, scope, opts, "readBigInts"_s, readBigInts)) return fail();
        if (!readBoolOption(globalObject, scope, opts, "returnArrays"_s, returnArrays)) return fail();
        if (!readBoolOption(globalObject, scope, opts, "allowBareNamedParameters"_s, allowBare)) return fail();
        if (!readBoolOption(globalObject, scope, opts, "allowUnknownNamedParameters"_s, allowUnknown)) return fail();
    }

    auto* zigGlobal = defaultGlobalObject(globalObject);
    auto* structure = zigGlobal->m_JSStatementSyncClassStructure.get(zigGlobal);
    auto* stmtObj = JSStatementSync::create(vm, structure, self, stmt);
    stmtObj->setUseBigInts(readBigInts);
    stmtObj->setReturnArrays(returnArrays);
    stmtObj->setAllowBareNamedParams(allowBare);
    stmtObj->setAllowUnknownNamedParams(allowUnknown);
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
    REQUIRE_DB_OPEN(self);
    JSDatabaseSync::BusyScope busy { self };

    JSValue nameVal = callFrame->argument(0);
    if (!nameVal.isString()) {
        return throwNodeArgType(globalObject, scope, "name"_s, "a string"_s);
    }
    auto name = nameVal.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // function(name, func) or function(name, options, func)
    size_t fnIndex = callFrame->argumentCount() < 3 ? 1 : 2;
    JSValue fnVal = callFrame->argument(fnIndex);
    JSValue optsVal = fnIndex == 2 ? callFrame->argument(1) : jsUndefined();

    bool useBigIntArgs = false;
    bool varargs = false;
    bool deterministic = false;
    bool directOnly = false;
    if (!optsVal.isUndefined()) {
        if (!optsVal.isObject()) {
            return throwNodeArgType(globalObject, scope, "options"_s, "an object"_s);
        }
        JSObject* opts = optsVal.getObject();
        if (!readBoolOption(globalObject, scope, opts, "useBigIntArguments"_s, useBigIntArgs)) return {};
        if (!readBoolOption(globalObject, scope, opts, "varargs"_s, varargs)) return {};
        if (!readBoolOption(globalObject, scope, opts, "deterministic"_s, deterministic)) return {};
        if (!readBoolOption(globalObject, scope, opts, "directOnly"_s, directOnly)) return {};
    }

    if (!fnVal.isCallable()) {
        return throwNodeArgType(globalObject, scope, "function"_s, "a function"_s);
    }
    JSObject* fn = fnVal.getObject();

    int argc = -1;
    if (!varargs) {
        JSValue lenVal = fn->get(globalObject, vm.propertyNames->length);
        RETURN_IF_EXCEPTION(scope, {});
        argc = lenVal.toInt32(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    int textRep = SQLITE_UTF8;
    if (deterministic) textRep |= SQLITE_DETERMINISTIC;
    if (directOnly) textRep |= SQLITE_DIRECTONLY;

    auto* udf = new NodeSqliteUDF(vm, globalObject, self, fn, useBigIntArgs);
    auto nameUtf8 = name.utf8();
    int r = sqlite3_create_function_v2(self->connection(), nameUtf8.data(), argc, textRep,
        udf, NodeSqliteUDF::xFunc, nullptr, nullptr, NodeSqliteUDF::xDestroy);
    if (r != SQLITE_OK) {
        // SQLite owns udf once xDestroy is passed in — it invokes xDestroy
        // on the failure path too (name too long / nArg out of range /
        // SQLITE_BUSY), so a manual delete here would double-free.
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncAggregate, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    JSDatabaseSync::BusyScope busy { self };

    JSValue nameVal = callFrame->argument(0);
    if (!nameVal.isString()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "name"_s, "string"_s, nameVal);
    }
    auto name = nameVal.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue optsVal = callFrame->argument(1);
    if (!optsVal.isObject()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options"_s, "Object"_s, optsVal);
    }
    JSObject* opts = optsVal.getObject();

    JSValue startV = opts->get(globalObject, Identifier::fromString(vm, "start"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (startV.isUndefined()) {
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
            "The \"options.start\" argument must be a function or a primitive value."_s);
    }
    JSValue stepV = opts->get(globalObject, Identifier::fromString(vm, "step"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (!stepV.isCallable()) {
        return throwNodeArgType(globalObject, scope, "options.step"_s, "a function"_s);
    }
    JSValue resultV = opts->get(globalObject, Identifier::fromString(vm, "result"_s));
    RETURN_IF_EXCEPTION(scope, {});
    JSObject* resultFn = nullptr;
    if (!resultV.isUndefined()) {
        if (!resultV.isCallable()) {
            return throwNodeArgType(globalObject, scope, "options.result"_s, "a function"_s);
        }
        resultFn = resultV.getObject();
    }

    bool useBigIntArgs = false;
    bool varargs = false;
    bool directOnly = false;
    if (!readBoolOption(globalObject, scope, opts, "useBigIntArguments"_s, useBigIntArgs)) return {};
    if (!readBoolOption(globalObject, scope, opts, "varargs"_s, varargs)) return {};
    if (!readBoolOption(globalObject, scope, opts, "directOnly"_s, directOnly)) return {};

    JSValue inverseV = opts->get(globalObject, Identifier::fromString(vm, "inverse"_s));
    RETURN_IF_EXCEPTION(scope, {});
    JSObject* inverseFn = nullptr;
    if (!inverseV.isUndefined()) {
        if (!inverseV.isCallable()) {
            return throwNodeArgType(globalObject, scope, "options.inverse"_s, "a function"_s);
        }
        inverseFn = inverseV.getObject();
    }

    JSObject* stepFn = stepV.getObject();
    int argc = -1;
    if (!varargs) {
        JSValue lenVal = stepFn->get(globalObject, vm.propertyNames->length);
        RETURN_IF_EXCEPTION(scope, {});
        // First parameter of step() is the accumulator, not a SQL argument.
        argc = std::max(0, lenVal.toInt32(globalObject) - 1);
        RETURN_IF_EXCEPTION(scope, {});
        if (inverseFn) {
            JSValue ilenVal = inverseFn->get(globalObject, vm.propertyNames->length);
            RETURN_IF_EXCEPTION(scope, {});
            argc = std::max(argc, std::max(0, ilenVal.toInt32(globalObject) - 1));
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    int textRep = SQLITE_UTF8;
    if (directOnly) textRep |= SQLITE_DIRECTONLY;

    auto* agg = new NodeSqliteAggregate(vm, globalObject, self, startV, stepFn, resultFn, inverseFn, useBigIntArgs);
    auto nameUtf8 = name.utf8();
    auto xInverse = inverseFn ? NodeSqliteAggregate::xInverse : nullptr;
    auto xValue = inverseFn ? NodeSqliteAggregate::xValue : nullptr;
    int r = sqlite3_create_window_function(self->connection(), nameUtf8.data(), argc, textRep, agg,
        NodeSqliteAggregate::xStep, NodeSqliteAggregate::xFinal, xValue, xInverse, NodeSqliteAggregate::xDestroy);
    if (r != SQLITE_OK) {
        // SQLite already invoked xDestroy(agg) on the failure path.
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncCreateSession, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    JSDatabaseSync::BusyScope busy { self };

    WTF::String table;
    WTF::String dbName = "main"_s;
    JSValue optsVal = callFrame->argument(0);
    if (!optsVal.isUndefined()) {
        if (!optsVal.isObject()) {
            return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options"_s, "Object"_s, optsVal);
        }
        JSObject* opts = optsVal.getObject();
        JSValue tableV = opts->get(globalObject, Identifier::fromString(vm, "table"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!tableV.isUndefined()) {
            if (!tableV.isString()) {
                return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options.table"_s, "string"_s, tableV);
            }
            table = tableV.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
        JSValue dbV = opts->get(globalObject, Identifier::fromString(vm, "db"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!dbV.isUndefined()) {
            if (!dbV.isString()) {
                return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options.db"_s, "string"_s, dbV);
            }
            dbName = dbV.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    auto dbNameUtf8 = dbName.utf8();
    sqlite3_session* pSession = nullptr;
    int r = sqlite3session_create(self->connection(), dbNameUtf8.data(), &pSession);
    if (r != SQLITE_OK) {
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }
    auto tableUtf8 = table.utf8();
    r = sqlite3session_attach(pSession, table.isEmpty() ? nullptr : tableUtf8.data());
    if (r != SQLITE_OK) {
        sqlite3session_delete(pSession);
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }

    self->trackSession(pSession);
    auto* zigGlobal = defaultGlobalObject(globalObject);
    auto* structure = zigGlobal->m_JSNodeSqliteSessionClassStructure.get(zigGlobal);
    auto* session = JSNodeSqliteSession::create(vm, structure, self, pSession);
    return JSValue::encode(session);
}

// applyChangeset callbacks: sqlite3 needs C function pointers, so capture
// the JS callbacks in a stack-allocated context threaded through via pCtx.
struct ApplyChangesetContext {
    JSGlobalObject* globalObject;
    JSDatabaseSync* db;
    JSObject* onConflict;
    JSObject* filter;
};

static int applyChangesetXConflict(void* pCtx, int eConflict, sqlite3_changeset_iter*)
{
    auto* ctx = static_cast<ApplyChangesetContext*>(pCtx);
    if (!ctx->onConflict) return SQLITE_CHANGESET_ABORT;
    auto* globalObject = ctx->globalObject;
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    if (scope.exception()) [[unlikely]]
        return SQLITE_CHANGESET_ABORT;
    MarkedArgumentBuffer args;
    args.append(jsNumber(eConflict));
    auto callData = JSC::getCallData(ctx->onConflict);
    JSValue ret = JSC::call(globalObject, ctx->onConflict, callData, jsNull(), args);
    if (scope.exception()) [[unlikely]] {
        ctx->db->setIgnoreNextSqliteError();
        return SQLITE_CHANGESET_ABORT;
    }
    int32_t code = ret.toInt32(globalObject);
    if (scope.exception()) [[unlikely]] {
        ctx->db->setIgnoreNextSqliteError();
        return SQLITE_CHANGESET_ABORT;
    }
    return code;
}

static int applyChangesetXFilter(void* pCtx, const char* zTab)
{
    auto* ctx = static_cast<ApplyChangesetContext*>(pCtx);
    if (!ctx->filter) return 1;
    auto* globalObject = ctx->globalObject;
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    if (scope.exception()) [[unlikely]]
        return 0;
    MarkedArgumentBuffer args;
    args.append(jsString(vm, WTF::String::fromUTF8(zTab)));
    auto callData = JSC::getCallData(ctx->filter);
    JSValue ret = JSC::call(globalObject, ctx->filter, callData, jsNull(), args);
    if (scope.exception()) [[unlikely]] {
        ctx->db->setIgnoreNextSqliteError();
        return 0;
    }
    bool keep = ret.toBoolean(globalObject);
    return keep ? 1 : 0;
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncApplyChangeset, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    JSDatabaseSync::BusyScope busy { self };

    auto* buf = dynamicDowncast<JSC::JSUint8Array>(callFrame->argument(0));
    if (!buf) {
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
            "The \"changeset\" argument must be a Uint8Array."_s);
    }

    ApplyChangesetContext ctx { globalObject, self, nullptr, nullptr };
    JSValue optsVal = callFrame->argument(1);
    if (!optsVal.isUndefined()) {
        if (!optsVal.isObject()) {
            return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options"_s, "Object"_s, optsVal);
        }
        JSObject* opts = optsVal.getObject();
        JSValue onConflictV = opts->get(globalObject, Identifier::fromString(vm, "onConflict"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!onConflictV.isUndefined()) {
            if (!onConflictV.isCallable()) {
                return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options.onConflict"_s, "function"_s, onConflictV);
            }
            ctx.onConflict = onConflictV.getObject();
        }
        JSValue filterV = opts->get(globalObject, Identifier::fromString(vm, "filter"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!filterV.isUndefined()) {
            if (!filterV.isCallable()) {
                return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options.filter"_s, "function"_s, filterV);
            }
            ctx.filter = filterV.getObject();
        }
    }

    // sqlite3changeset_apply stores pChangeset (no copy) and streams from
    // it between xFilter/xConflict invocations. Those callbacks re-enter
    // JS, which could detach `buf` (e.g. `changeset.buffer.transfer()`)
    // and let GC free the backing store while SQLite is still reading
    // from it. Copy into an owned buffer so the lifetime is tied to this
    // stack frame regardless of what JS does. Changesets are typically
    // small, so the copy is cheap relative to the safety it buys.
    auto span = buf->span();
    WTF::Vector<uint8_t> owned;
    if (!owned.tryAppend(span)) {
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_OUT_OF_RANGE,
            "changeset is too large"_s);
    }
    // sqlite3changeset_apply declares pChangeset as `void*` (non-const)
    // for historical reasons; the buffer is not written to.
    int r = sqlite3changeset_apply(self->connection(),
        static_cast<int>(owned.size()), owned.mutableSpan().data(),
        applyChangesetXFilter, applyChangesetXConflict, &ctx);
    CHECK_UDF_EXCEPTION(scope, self);
    if (r == SQLITE_ABORT) {
        // Conflict handler returned ABORT — Node.js surfaces this as
        // `false` rather than throwing.
        return JSValue::encode(jsBoolean(false));
    }
    if (r != SQLITE_OK) {
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }
    return JSValue::encode(jsBoolean(true));
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
        if (out.isNull()) {
            // fromUTF8 returns null for byte sequences that aren't valid
            // UTF-8. Without this guard the null String would become ""
            // and sqlite3_open_v2("") would silently open a private
            // temporary database instead of the requested file.
            Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE,
                "The \"path\" argument must be a Uint8Array containing a valid UTF-8 byte sequence."_s);
            return false;
        }
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
            auto hrefStr = href.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, false);
            // Decode to a plain filesystem path (like Node's
            // FileURLToPath) so the caller's find('\0') check sees the
            // decoded byte — the raw href keeps `%00` as three literal
            // characters. This also strips any ?query so open()
            // needn't set SQLITE_OPEN_URI (which would expose string
            // paths beginning "file:" to sqlite3ParseUri).
            auto url = WTF::URL(hrefStr);
            if (!url.isValid() || !url.protocolIsFile()) {
                Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_URL_SCHEME, "The URL must be of scheme file:"_s);
                return false;
            }
            out = url.fileSystemPath();
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
        if (!readBoolOption(globalObject, scope, opts, "readBigInts"_s, config.readBigInts)) return {};
        if (!readBoolOption(globalObject, scope, opts, "returnArrays"_s, config.returnArrays)) return {};
        if (!readBoolOption(globalObject, scope, opts, "allowBareNamedParameters"_s, config.allowBareNamedParameters)) return {};
        if (!readBoolOption(globalObject, scope, opts, "allowUnknownNamedParameters"_s, config.allowUnknownNamedParameters)) return {};

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
    m_originGeneration = db->openGeneration();
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
    // The generation check covers both "database is closed" and
    // "database was closed then re-opened" — the stmt belongs to the
    // zombified old connection and must not be stepped. A raw sqlite3*
    // comparison isn't sufficient here: the allocator may hand the new
    // connection the same address the old one had (ABA).
    return db == nullptr || !db->isOpen() || db->openGeneration() != m_originGeneration;
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
        // Match Node's IsInt32() → sqlite3_bind_int fast path so that
        // `typeof(?)` on a bare parameter yields 'integer' (not 'real')
        // and expandedSQL shows `42`, not `42.0`.
        if (value.isInt32()) {
            r = sqlite3_bind_int(m_stmt, index, value.asInt32());
        } else {
            r = sqlite3_bind_double(m_stmt, index, value.asNumber());
        }
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
                // Build into a local first so a mid-loop failure (conflicting
                // prefixes for the same bare name) doesn't leave a partially
                // populated map cached on the statement.
                WTF::HashMap<WTF::String, WTF::String> bare;
                for (int i = 1; i <= paramCount; ++i) {
                    const char* full = sqlite3_bind_parameter_name(m_stmt, i);
                    if (full == nullptr || full[0] == '\0') continue;
                    WTF::String fullStr = WTF::String::fromUTF8(full);
                    WTF::String bareName = fullStr.substring(1);
                    auto it = bare.find(bareName);
                    if (it != bare.end()) {
                        Bun::ERR::INVALID_STATE(scope, globalObject,
                            makeString("Cannot create bare named parameter '"_s, bareName,
                                "' because of conflicting names '"_s, it->value,
                                "' and '"_s, fullStr, "'."_s));
                        return false;
                    }
                    bare.add(bareName, fullStr);
                }
                m_bareNamedParams.emplace(std::move(bare));
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
    BUSY_SCOPE_STMT(self);
    sqlite3_reset(self->statement());
    self->bumpResetGeneration();
    if (!self->bindParams(globalObject, scope, callFrame)) return {};
    StatementResetter resetter { self->statement() };

    int r = sqlite3_step(self->statement());
    while (r == SQLITE_ROW) {
        r = sqlite3_step(self->statement());
    }
    CHECK_UDF_EXCEPTION(scope, self->database());
    if (r != SQLITE_DONE && r != SQLITE_OK) {
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }

    // Don't go through self->connection() here: a named-parameter getter
    // or UDF callback may have called db.close() since REQUIRE_STMT, in
    // which case the wrapper's m_db is now null and sqlite3_changes64(NULL)
    // is a raw db->nChange deref (no SQLITE_ENABLE_API_ARMOR in this build).
    // sqlite3_db_handle() reads the statement's own back-pointer, which
    // survives zombification and is what Node's StatementSync::Run uses.
    sqlite3* db = sqlite3_db_handle(self->statement());
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
    BUSY_SCOPE_STMT(self);
    sqlite3_reset(self->statement());
    self->bumpResetGeneration();
    if (!self->bindParams(globalObject, scope, callFrame)) return {};
    StatementResetter resetter { self->statement() };

    int r = sqlite3_step(self->statement());
    CHECK_UDF_EXCEPTION(scope, self->database());
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
    BUSY_SCOPE_STMT(self);
    sqlite3_reset(self->statement());
    self->bumpResetGeneration();
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
    CHECK_UDF_EXCEPTION(scope, self->database());
    if (r != SQLITE_DONE) {
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }
    return JSValue::encode(rows);
}

JSC_DEFINE_HOST_FUNCTION(jsStatementSyncIterate, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_STATEMENT();
    REQUIRE_STMT(self);
    BUSY_SCOPE_STMT(self);
    sqlite3_reset(self->statement());
    self->bumpResetGeneration();
    if (!self->bindParams(globalObject, scope, callFrame)) return {};
    // Don't step yet — the iterator pulls rows lazily on next(). Don't
    // reset on scope exit either; the cursor position belongs to the
    // returned iterator until it's exhausted or return()'d.
    auto* zigGlobal = defaultGlobalObject(globalObject);
    auto* structure = zigGlobal->m_JSStatementSyncIteratorClassStructure.get(zigGlobal);
    auto* iter = JSStatementSyncIterator::create(vm, structure, self);
    return JSValue::encode(iter);
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
// JSStatementSyncIterator
// ─────────────────────────────────────────────────────────────────────────────

const ClassInfo JSStatementSyncIterator::s_info = { "StatementSyncIterator"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStatementSyncIterator) };
const ClassInfo JSStatementSyncIteratorPrototype::s_info = { "StatementSyncIterator"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStatementSyncIteratorPrototype) };

JSStatementSyncIterator* JSStatementSyncIterator::create(VM& vm, Structure* structure, JSStatementSync* stmt)
{
    auto* ptr = new (NotNull, allocateCell<JSStatementSyncIterator>(vm)) JSStatementSyncIterator(vm, structure);
    ptr->finishCreation(vm, stmt);
    return ptr;
}

void JSStatementSyncIterator::finishCreation(VM& vm, JSStatementSync* stmt)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_statement.set(vm, this, stmt);
    m_capturedGeneration = stmt->resetGeneration();
}

template<typename Visitor>
void JSStatementSyncIterator::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSStatementSyncIterator>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_statement);
}
DEFINE_VISIT_CHILDREN(JSStatementSyncIterator);

GCClient::IsoSubspace* JSStatementSyncIterator::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSStatementSyncIterator, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForNodeSqliteStatementSyncIterator.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeSqliteStatementSyncIterator = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForNodeSqliteStatementSyncIterator.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeSqliteStatementSyncIterator = std::forward<decltype(space)>(space); });
}

static inline JSObject* createIterResult(VM& vm, JSGlobalObject* globalObject, bool done, JSValue value)
{
    JSObject* result = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    result->putDirect(vm, vm.propertyNames->done, jsBoolean(done), 0);
    result->putDirect(vm, vm.propertyNames->value, value, 0);
    return result;
}

JSC_DEFINE_HOST_FUNCTION(jsStatementSyncIteratorNext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* self = dynamicDowncast<JSStatementSyncIterator>(callFrame->thisValue());
    if (!self) [[unlikely]] {
        scope.throwException(globalObject, createInvalidThisError(globalObject, callFrame->thisValue(), "StatementSyncIterator"_s));
        return {};
    }
    // Once exhausted, next() doesn't touch the statement — so keep
    // returning {done:true} regardless of whether the db has since been
    // closed (matches the iterator protocol's "exhausted is permanent").
    if (self->done()) {
        return JSValue::encode(createIterResult(vm, globalObject, true, jsNull()));
    }
    JSStatementSync* stmt = self->statement();
    if (!stmt || stmt->isFinalized()) {
        return Bun::ERR::INVALID_STATE(scope, globalObject, "statement has been finalized"_s);
    }
    if (self->capturedGeneration() != stmt->resetGeneration()) {
        return Bun::ERR::INVALID_STATE(scope, globalObject, "statement has been reset"_s);
    }
    JSDatabaseSync::BusyScope busy { stmt->database() };

    int r = sqlite3_step(stmt->statement());
    CHECK_UDF_EXCEPTION(scope, stmt->database());
    if (r == SQLITE_ROW) {
        int numCols = sqlite3_column_count(stmt->statement());
        JSValue row = stmt->returnArrays()
            ? rowToArray(globalObject, scope, stmt->statement(), numCols, stmt->useBigInts())
            : rowToObject(globalObject, scope, stmt->statement(), numCols, stmt->useBigInts());
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(createIterResult(vm, globalObject, false, row));
    }
    if (r != SQLITE_DONE) {
        throwSqliteError(globalObject, scope, stmt->connection());
        return {};
    }
    sqlite3_reset(stmt->statement());
    self->setDone();
    return JSValue::encode(createIterResult(vm, globalObject, true, jsNull()));
}

JSC_DEFINE_HOST_FUNCTION(jsStatementSyncIteratorReturn, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* self = dynamicDowncast<JSStatementSyncIterator>(callFrame->thisValue());
    if (!self) [[unlikely]] {
        scope.throwException(globalObject, createInvalidThisError(globalObject, callFrame->thisValue(), "StatementSyncIterator"_s));
        return {};
    }
    // return() is the iterator-protocol cleanup hook (called implicitly by
    // for-of's IteratorClose on break/return). Cleanup must be tolerant of
    // already-closed state — throwing here would turn a benign
    // `for (r of stmt.iterate()) { db.close(); break; }` into an exception.
    // Matches Node, and this PR's own [Symbol.dispose]() convention.
    JSStatementSync* stmt = self->statement();
    if (!self->done() && stmt && !stmt->isFinalized()) {
        sqlite3_reset(stmt->statement());
    }
    self->setDone();
    return JSValue::encode(createIterResult(vm, globalObject, true, jsNull()));
}

static const HashTableValue JSStatementSyncIteratorPrototypeTableValues[] = {
    { "next"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatementSyncIteratorNext, 0 } },
    { "return"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStatementSyncIteratorReturn, 0 } },
};

void JSStatementSyncIteratorPrototype::finishCreation(VM& vm, JSGlobalObject*)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSStatementSyncIterator::info(), JSStatementSyncIteratorPrototypeTableValues, *this);
    // No toStringTag — Node's iterator is a plain object whose prototype
    // chain ends at %IteratorPrototype% (which supplies @@iterator).
}

// ─────────────────────────────────────────────────────────────────────────────
// JSNodeSqliteSession
// ─────────────────────────────────────────────────────────────────────────────

const ClassInfo JSNodeSqliteSession::s_info = { "Session"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSqliteSession) };
const ClassInfo JSNodeSqliteSessionPrototype::s_info = { "Session"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSqliteSessionPrototype) };

JSNodeSqliteSession* JSNodeSqliteSession::create(VM& vm, Structure* structure, JSDatabaseSync* db, sqlite3_session* session)
{
    auto* ptr = new (NotNull, allocateCell<JSNodeSqliteSession>(vm)) JSNodeSqliteSession(vm, structure);
    ptr->finishCreation(vm, db, session);
    return ptr;
}

void JSNodeSqliteSession::finishCreation(VM& vm, JSDatabaseSync* db, sqlite3_session* session)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_session = session;
    m_originGeneration = db->openGeneration();
    m_database.set(vm, this, db);
}

bool JSNodeSqliteSession::isStale() const
{
    auto* db = m_database.get();
    // closeInternal() frees every tracked sqlite3_session* without
    // touching the wrappers, so once the originating connection is gone
    // (closed, or closed-then-reopened) m_session is a dangling pointer.
    // Compare the open-generation rather than the raw sqlite3* because
    // the allocator can recycle the same address for the new connection.
    return db == nullptr || !db->isOpen() || db->openGeneration() != m_originGeneration;
}

void JSNodeSqliteSession::deleteSession()
{
    if (m_session == nullptr) return;
    if (!isStale()) {
        auto* db = m_database.get();
        db->untrackSession(m_session);
        sqlite3session_delete(m_session);
    }
    // If stale, closeInternal() already freed the handle — don't double-free.
    m_session = nullptr;
}

JSNodeSqliteSession::~JSNodeSqliteSession()
{
    // Do NOT follow m_database during GC teardown — just drop our pointer.
    // Any still-open session handle is owned by the database's m_sessions
    // list and will be freed by JSDatabaseSync::closeInternal().
    m_session = nullptr;
}

template<typename Visitor>
void JSNodeSqliteSession::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSNodeSqliteSession>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_database);
}
DEFINE_VISIT_CHILDREN(JSNodeSqliteSession);

GCClient::IsoSubspace* JSNodeSqliteSession::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSNodeSqliteSession, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForNodeSqliteSession.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeSqliteSession = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForNodeSqliteSession.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeSqliteSession = std::forward<decltype(space)>(space); });
}

#define THIS_SESSION()                                                                                                 \
    auto& vm = JSC::getVM(globalObject);                                                                               \
    auto scope = DECLARE_THROW_SCOPE(vm);                                                                              \
    JSNodeSqliteSession* self = dynamicDowncast<JSNodeSqliteSession>(callFrame->thisValue());                          \
    if (!self) [[unlikely]] {                                                                                          \
        scope.throwException(globalObject, createInvalidThisError(globalObject, callFrame->thisValue(), "Session"_s)); \
        return {};                                                                                                     \
    }

template<int (*Fn)(sqlite3_session*, int*, void**)>
static EncodedJSValue sessionChangesetCommon(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    THIS_SESSION();
    JSDatabaseSync* db = self->database();
    if (self->isStale()) {
        return Bun::ERR::INVALID_STATE(scope, globalObject, "database is not open"_s);
    }
    if (self->session() == nullptr) {
        return Bun::ERR::INVALID_STATE(scope, globalObject, "session is not open"_s);
    }
    int nChangeset = 0;
    void* pChangeset = nullptr;
    int r = Fn(self->session(), &nChangeset, &pChangeset);
    if (r != SQLITE_OK) {
        if (pChangeset) sqlite3_free(pChangeset);
        throwSqliteError(globalObject, scope, db->connection());
        return {};
    }
    auto* array = JSC::JSUint8Array::createUninitialized(globalObject, globalObject->m_typedArrayUint8.get(globalObject), static_cast<size_t>(nChangeset));
    if (scope.exception()) [[unlikely]] {
        sqlite3_free(pChangeset);
        return {};
    }
    if (nChangeset > 0) memcpy(array->typedVector(), pChangeset, static_cast<size_t>(nChangeset));
    sqlite3_free(pChangeset);
    return JSValue::encode(array);
}

JSC_DEFINE_HOST_FUNCTION(jsSessionChangeset, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return sessionChangesetCommon<sqlite3session_changeset>(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsSessionPatchset, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return sessionChangesetCommon<sqlite3session_patchset>(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsSessionClose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_SESSION();
    if (self->isStale()) {
        return Bun::ERR::INVALID_STATE(scope, globalObject, "database is not open"_s);
    }
    if (self->session() == nullptr) {
        return Bun::ERR::INVALID_STATE(scope, globalObject, "session is not open"_s);
    }
    self->deleteSession();
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsSessionDispose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* self = dynamicDowncast<JSNodeSqliteSession>(callFrame->thisValue());
    (void)globalObject;
    if (self) self->deleteSession();
    return JSValue::encode(jsUndefined());
}

static const HashTableValue JSNodeSqliteSessionPrototypeTableValues[] = {
    { "changeset"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSessionChangeset, 0 } },
    { "patchset"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSessionPatchset, 0 } },
    { "close"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsSessionClose, 0 } },
};

void JSNodeSqliteSessionPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSNodeSqliteSession::info(), JSNodeSqliteSessionPrototypeTableValues, *this);
    putDirectNativeFunction(vm, globalObject, vm.propertyNames->disposeSymbol, 0, jsSessionDispose, ImplementationVisibility::Public, NoIntrinsic, 0);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level exports
// ─────────────────────────────────────────────────────────────────────────────

// backup(sourceDb, path[, options]) → Promise<number>
//
// Node.js runs the sqlite3_backup_step loop on a libuv worker thread. Here we
// run it synchronously on the JS thread — DatabaseSync is already a fully
// synchronous API, and the source connection cannot be touched from another
// thread anyway (SQLite's default threading mode is serialized-per-
// connection). The `progress` callback still fires between each batch of
// `rate` pages so callers can observe progress; the returned Promise is
// resolved before this function returns.
JSC_DEFINE_HOST_FUNCTION(jsNodeSqliteBackup, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue sourceVal = callFrame->argument(0);
    if (!sourceVal.isObject()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "sourceDb"_s, "object"_s, sourceVal);
    }
    auto* sourceDb = dynamicDowncast<JSDatabaseSync>(sourceVal);
    if (!sourceDb) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "sourceDb"_s, "object"_s, sourceVal);
    }
    if (!sourceDb->isOpen()) {
        return Bun::ERR::INVALID_STATE(scope, globalObject, "database is not open"_s);
    }
    JSDatabaseSync::BusyScope busy { sourceDb };

    WTF::String destPath;
    if (!validateDatabasePath(globalObject, scope, callFrame->argument(1), destPath)) return {};
    if (destPath.find('\0') != WTF::notFound) {
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
            "The \"path\" argument must be a string, Uint8Array, or URL without null bytes."_s);
    }

    int rate = 100;
    WTF::String sourceName = "main"_s;
    WTF::String targetName = "main"_s;
    JSObject* progressFn = nullptr;

    JSValue optsVal = callFrame->argument(2);
    if (!optsVal.isUndefined()) {
        if (!optsVal.isObject()) {
            return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options"_s, "Object"_s, optsVal);
        }
        JSObject* opts = optsVal.getObject();
        JSValue rateV = opts->get(globalObject, Identifier::fromString(vm, "rate"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!rateV.isUndefined()) {
            bool ok = rateV.isInt32();
            if (!ok && rateV.isNumber()) {
                double d = rateV.asNumber();
                ok = std::isfinite(d) && std::trunc(d) == d && d >= INT32_MIN && d <= INT32_MAX;
            }
            if (!ok) {
                return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options.rate"_s, "integer"_s, rateV);
            }
            rate = rateV.toInt32(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            // sqlite3_backup_step(_, 0) copies zero pages and returns
            // SQLITE_OK without advancing — on the JS thread that's an
            // infinite busy-spin. Negative means "all remaining", which
            // is fine.
            if (rate == 0) rate = 1;
        }
        JSValue sourceV = opts->get(globalObject, Identifier::fromString(vm, "source"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!sourceV.isUndefined()) {
            if (!sourceV.isString()) {
                return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options.source"_s, "string"_s, sourceV);
            }
            sourceName = sourceV.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
        JSValue targetV = opts->get(globalObject, Identifier::fromString(vm, "target"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!targetV.isUndefined()) {
            if (!targetV.isString()) {
                return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options.target"_s, "string"_s, targetV);
            }
            targetName = targetV.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
        JSValue progressV = opts->get(globalObject, Identifier::fromString(vm, "progress"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!progressV.isUndefined()) {
            if (!progressV.isCallable()) {
                return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options.progress"_s, "function"_s, progressV);
            }
            progressFn = progressV.getObject();
        }
    }

    // All validation done — errors from here on reject the promise. We
    // throw on the scope (so the ThrowScope assertion machinery is
    // satisfied) then convert the pending exception into a rejected
    // Promise before returning.
    auto rejectWithPending = [&]() -> EncodedJSValue {
        RELEASE_AND_RETURN(scope, JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(globalObject, scope)));
    };

    auto destPathUtf8 = destPath.utf8();
    sqlite3* dest = nullptr;
    int r = sqlite3_open_v2(destPathUtf8.data(), &dest, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nullptr);
    if (r != SQLITE_OK) {
        if (dest) {
            throwSqliteError(globalObject, scope, dest);
            sqlite3_close_v2(dest);
        } else {
            throwSqliteMessage(globalObject, scope, r, WTF::String::fromUTF8(sqlite3_errstr(r)));
        }
        return rejectWithPending();
    }

    auto sourceNameUtf8 = sourceName.utf8();
    auto targetNameUtf8 = targetName.utf8();
    sqlite3_backup* backup = sqlite3_backup_init(dest, targetNameUtf8.data(), sourceDb->connection(), sourceNameUtf8.data());
    if (backup == nullptr) {
        throwSqliteError(globalObject, scope, dest);
        sqlite3_close_v2(dest);
        return rejectWithPending();
    }

    // We run the step loop synchronously, so a locked destination would
    // otherwise busy-spin at 100% CPU forever. Bound the total time spent
    // waiting on BUSY/LOCKED and back off between retries; budget defaults
    // to the source database's configured timeout (Node's async variant
    // yields to the event loop instead, which we can't do here).
    constexpr int kBusyRetrySleepMs = 25;
    const int busyBudgetMs = std::max(sourceDb->config().timeout, 5000);
    int busyWaitedMs = 0;

    int totalPages = 0;
    while (true) {
        r = sqlite3_backup_step(backup, rate);
        totalPages = sqlite3_backup_pagecount(backup);
        int remaining = sqlite3_backup_remaining(backup);

        if (r == SQLITE_OK && progressFn) {
            JSObject* payload = constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
            payload->putDirect(vm, Identifier::fromString(vm, "totalPages"_s), jsNumber(totalPages), 0);
            payload->putDirect(vm, Identifier::fromString(vm, "remainingPages"_s), jsNumber(remaining), 0);
            MarkedArgumentBuffer args;
            args.append(payload);
            auto callData = JSC::getCallData(progressFn);
            JSC::call(globalObject, progressFn, callData, jsNull(), args);
            if (scope.exception()) [[unlikely]] {
                sqlite3_backup_finish(backup);
                sqlite3_close_v2(dest);
                return rejectWithPending();
            }
        }

        if (r == SQLITE_DONE) break;
        if (r == SQLITE_OK) {
            busyWaitedMs = 0;
            continue;
        }
        if (r == SQLITE_BUSY || r == SQLITE_LOCKED) {
            if (busyWaitedMs >= busyBudgetMs) {
                throwSqliteMessage(globalObject, scope, r,
                    "database is locked"_s);
                sqlite3_backup_finish(backup);
                sqlite3_close_v2(dest);
                return rejectWithPending();
            }
            sqlite3_sleep(kBusyRetrySleepMs);
            busyWaitedMs += kBusyRetrySleepMs;
            continue;
        }

        throwSqliteError(globalObject, scope, dest);
        sqlite3_backup_finish(backup);
        sqlite3_close_v2(dest);
        return rejectWithPending();
    }

    r = sqlite3_backup_finish(backup);
    if (r != SQLITE_OK) {
        throwSqliteError(globalObject, scope, dest);
        sqlite3_close_v2(dest);
        return rejectWithPending();
    }
    sqlite3_close_v2(dest);

    RELEASE_AND_RETURN(scope, JSValue::encode(JSPromise::resolvedPromise(globalObject, jsNumber(totalPages))));
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
