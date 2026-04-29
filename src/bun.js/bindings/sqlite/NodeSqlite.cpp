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

// Node's THROW_ERR_INVALID_STATE(...) emits the message verbatim; Bun's
// generic helper prepends "Invalid state: ". Several upstream tests
// (test-sqlite-session.js, test-sqlite-template-tag.js, …) assert the
// exact message string, so use a local throw that matches Node's format.
static EncodedJSValue throwNodeState(JSGlobalObject* globalObject, ThrowScope& scope, const WTF::String& message)
{
    auto* zigGlobal = defaultGlobalObject(globalObject);
    scope.throwException(globalObject, createError(zigGlobal, ErrorCode::ERR_INVALID_STATE, message));
    return {};
}

#define REQUIRE_DB_OPEN(db)                                                       \
    do {                                                                          \
        if ((db)->connection() == nullptr) {                                      \
            return throwNodeState(globalObject, scope, "database is not open"_s); \
        }                                                                         \
    } while (0)

#define REQUIRE_STMT(self)                                                                \
    do {                                                                                  \
        if ((self)->isFinalized()) {                                                      \
            return throwNodeState(globalObject, scope, "statement has been finalized"_s); \
        }                                                                                 \
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

// `db.limits` property-name → SQLITE_LIMIT_* mapping. The ids are
// contiguous (0..10) and equal their array index; DatabaseSyncOpen-
// Configuration::initialLimits relies on that. static_assert picks up
// any drift if the amalgamation ever renumbers them.
struct NodeSqliteLimitInfo {
    ASCIILiteral name;
    int id;
};
static constexpr std::array<NodeSqliteLimitInfo, kNodeSqliteLimitCount> kLimitMapping { {
    { "length"_s, SQLITE_LIMIT_LENGTH },
    { "sqlLength"_s, SQLITE_LIMIT_SQL_LENGTH },
    { "column"_s, SQLITE_LIMIT_COLUMN },
    { "exprDepth"_s, SQLITE_LIMIT_EXPR_DEPTH },
    { "compoundSelect"_s, SQLITE_LIMIT_COMPOUND_SELECT },
    { "vdbeOp"_s, SQLITE_LIMIT_VDBE_OP },
    { "functionArg"_s, SQLITE_LIMIT_FUNCTION_ARG },
    { "attach"_s, SQLITE_LIMIT_ATTACHED },
    { "likePatternLength"_s, SQLITE_LIMIT_LIKE_PATTERN_LENGTH },
    { "variableNumber"_s, SQLITE_LIMIT_VARIABLE_NUMBER },
    { "triggerDepth"_s, SQLITE_LIMIT_TRIGGER_DEPTH },
} };
static_assert(SQLITE_LIMIT_LENGTH == 0 && SQLITE_LIMIT_TRIGGER_DEPTH == 10,
    "kLimitMapping / DatabaseSyncOpenConfiguration::initialLimits assume contiguous SQLITE_LIMIT_* ids");

static inline int findLimitId(const WTF::String& name)
{
    for (const auto& info : kLimitMapping) {
        if (name == info.name) return info.id;
    }
    return -1;
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

// Generic (uncached) null-prototype row builder. Used when no
// JSStatementSync owner is available to hold the cached Structure, or
// when the column set is too wide for the inline-capacity fast path.
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

// Fast-path row builder that reuses a precomputed null-prototype
// Structure. Every row from the same statement has identical column
// names, so instead of re-hashing each name per row we build the shape
// once (JSStatementSync::ensureRowStructure) and then place values
// directly at their known inline-offset. This is the same technique
// bun:sqlite's constructResultObject() uses and is what makes .all()
// on wide result sets competitive.
static JSValue rowToObjectCached(JSGlobalObject* globalObject, ThrowScope& scope, JSStatementSync* owner, int numCols, bool useBigInts)
{
    auto& vm = getVM(globalObject);
    sqlite3_stmt* stmt = owner->statement();
    Structure* structure = owner->ensureRowStructure(globalObject);
    if (!structure) {
        // Too many columns for inline storage or pathological names —
        // fall back to the generic path.
        return rowToObject(globalObject, scope, stmt, numCols, useBigInts);
    }
    JSObject* row = JSC::constructEmptyObject(vm, structure);
    const auto& offsets = owner->columnOffsets();
    for (int i = 0; i < numCols; ++i) {
        JSValue v = columnToJS(globalObject, scope, stmt, i, useBigInts);
        RETURN_IF_EXCEPTION(scope, {});
        int8_t off = offsets[static_cast<size_t>(i)];
        if (off < 0) continue; // duplicate name; first occurrence already placed
        row->putDirectOffset(vm, static_cast<PropertyOffset>(off), v);
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
        throwNodeState(globalObject, scope, "database is already open"_s);
        return false;
    }

    // SQLITE_OPEN_URI mirrors Node's `default_flags = SQLITE_OPEN_URI`
    // (node_sqlite.cc). A *string* path that happens to be a file: URI
    // is passed straight to sqlite3ParseUri, so `?cache=shared` and
    // friends work exactly as they do in Node; a URL object has already
    // been reduced to a plain filesystem path by validateDatabasePath,
    // so the flag is inert for that branch.
    int flags = SQLITE_OPEN_URI | (m_config.readOnly ? SQLITE_OPEN_READONLY : (SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE));

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

    v = m_config.enableDefensive ? 1 : 0;
    if (sqlite3_db_config(m_db, SQLITE_DBCONFIG_DEFENSIVE, v, nullptr) != SQLITE_OK) {
        throwSqliteError(globalObject, scope, m_db);
        closeInternal();
        return false;
    }

    for (const auto& info : kLimitMapping) {
        int initial = m_config.initialLimits[static_cast<size_t>(info.id)];
        if (initial >= 0) sqlite3_limit(m_db, info.id, initial);
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
    visitor.append(thisObject->m_authorizer);
    visitor.append(thisObject->m_limits);
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
JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncEnableDefensive);
JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncSetAuthorizer);
JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncSerialize);
JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncDeserialize);
JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncCreateTagStore);
JSC_DECLARE_HOST_FUNCTION(jsDatabaseSyncDispose);
JSC_DECLARE_CUSTOM_GETTER(jsDatabaseSyncIsOpen);
JSC_DECLARE_CUSTOM_GETTER(jsDatabaseSyncIsTransaction);
JSC_DECLARE_CUSTOM_GETTER(jsDatabaseSyncLimits);

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
        return throwNodeState(globalObject, scope,
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
        return throwNodeArgType(globalObject, scope, "sql"_s, "a string"_s);
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
        return throwNodeArgType(globalObject, scope, "sql"_s, "a string"_s);
    }
    auto sql = sqlVal.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto utf8 = sql.utf8();
    sqlite3_stmt* stmt = nullptr;
    int r = sqlite3_prepare_v2(self->connection(), utf8.data(), static_cast<int>(utf8.length()), &stmt, nullptr);
    // prepare() runs the authorizer callback (if any), which may
    // throw — surface that over SQLite's generic "not authorized".
    CHECK_UDF_EXCEPTION(scope, self);
    if (r != SQLITE_OK) {
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }
    // sqlite3_prepare_v2 returns SQLITE_OK with *ppStmt == nullptr when the
    // input contains no SQL (empty / whitespace / comment only). Node.js
    // surfaces that as ERR_INVALID_STATE at prepare() time.
    if (stmt == nullptr) {
        return throwNodeState(globalObject, scope,
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
            return throwNodeArgType(globalObject, scope, "dbName"_s, "a string"_s);
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
        return throwNodeArgType(globalObject, scope, "allow"_s, "a boolean"_s);
    }
    bool allow = arg0.asBoolean();
    if (allow && !self->allowLoadExtension()) {
        return throwNodeState(globalObject, scope, "extension loading is not allowed"_s);
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
        return throwNodeState(globalObject, scope, "extension loading is not allowed"_s);
    }
    JSValue pathVal = callFrame->argument(0);
    if (!pathVal.isString()) {
        return throwNodeArgType(globalObject, scope, "path"_s, "a string"_s);
    }
    auto path = pathVal.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto pathUtf8 = path.utf8();

    WTF::CString entryUtf8;
    const char* entryPtr = nullptr;
    JSValue entryVal = callFrame->argument(1);
    if (!entryVal.isUndefined()) {
        if (!entryVal.isString()) {
            return throwNodeArgType(globalObject, scope, "entryPoint"_s, "a string"_s);
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
        return throwNodeArgType(globalObject, scope, "name"_s, "a string"_s);
    }
    auto name = nameVal.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue optsVal = callFrame->argument(1);
    if (!optsVal.isObject()) {
        return throwNodeArgType(globalObject, scope, "options"_s, "an object"_s);
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
            return throwNodeArgType(globalObject, scope, "options"_s, "an object"_s);
        }
        JSObject* opts = optsVal.getObject();
        JSValue tableV = opts->get(globalObject, Identifier::fromString(vm, "table"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!tableV.isUndefined()) {
            if (!tableV.isString()) {
                return throwNodeArgType(globalObject, scope, "options.table"_s, "a string"_s);
            }
            table = tableV.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
        JSValue dbV = opts->get(globalObject, Identifier::fromString(vm, "db"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!dbV.isUndefined()) {
            if (!dbV.isString()) {
                return throwNodeArgType(globalObject, scope, "options.db"_s, "a string"_s);
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
    // Node returns the raw value to sqlite only when it IsInt32(); a
    // non-integer (object, null, Promise, …) becomes -1, which
    // sqlite3changeset_apply rejects with SQLITE_MISUSE so the caller
    // sees "bad parameter or other API misuse". ToInt32 coercion would
    // instead turn {} into 0 (== SQLITE_CHANGESET_OMIT) and silently
    // swallow the bug.
    if (ret.isInt32()) return ret.asInt32();
    if (ret.isNumber()) {
        double d = ret.asNumber();
        if (std::isfinite(d) && std::trunc(d) == d && d >= INT32_MIN && d <= INT32_MAX)
            return static_cast<int>(d);
    }
    return -1;
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
            return throwNodeArgType(globalObject, scope, "options"_s, "an object"_s);
        }
        JSObject* opts = optsVal.getObject();
        JSValue onConflictV = opts->get(globalObject, Identifier::fromString(vm, "onConflict"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!onConflictV.isUndefined()) {
            if (!onConflictV.isCallable()) {
                return throwNodeArgType(globalObject, scope, "options.onConflict"_s, "a function"_s);
            }
            ctx.onConflict = onConflictV.getObject();
        }
        JSValue filterV = opts->get(globalObject, Identifier::fromString(vm, "filter"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!filterV.isUndefined()) {
            if (!filterV.isCallable()) {
                return throwNodeArgType(globalObject, scope, "options.filter"_s, "a function"_s);
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

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncEnableDefensive, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    JSValue arg0 = callFrame->argument(0);
    if (!arg0.isBoolean()) {
        return throwNodeArgType(globalObject, scope, "active"_s, "a boolean"_s);
    }
    int enable = arg0.asBoolean() ? 1 : 0;
    int out = 0;
    int r = sqlite3_db_config(self->connection(), SQLITE_DBCONFIG_DEFENSIVE, enable, &out);
    if (r != SQLITE_OK) {
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }
    return JSValue::encode(jsUndefined());
}

// sqlite3_set_authorizer() callback. Runs from inside sqlite3_prepare_*
// and sqlite3_exec() — i.e. *between* BusyScope open and close on the
// JSDatabaseSync — so the db pointer is live for its entire duration.
// Uses TopExceptionScope for the same reason xFunc does: the destructor
// of a nested ThrowScope would simulateThrow(), tripping the next
// callback's constructor under validateExceptionChecks. A thrown JS
// exception (or a non-integer / out-of-range return) becomes SQLITE_DENY
// plus setIgnoreNextSqliteError() so the outer host function surfaces
// the JS error instead of "not authorized".
static int nodeSqliteAuthorizerCallback(void* userData, int actionCode, const char* p1, const char* p2, const char* p3, const char* p4)
{
    auto* db = static_cast<JSDatabaseSync*>(userData);
    auto* globalObject = db->globalObject();
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    auto* fn = db->m_authorizer.get();
    if (!fn) [[unlikely]]
        return SQLITE_OK;

    auto toJS = [&](const char* s) -> JSValue {
        return s ? jsString(vm, WTF::String::fromUTF8(s)) : jsNull();
    };

    MarkedArgumentBuffer args;
    args.append(jsNumber(actionCode));
    args.append(toJS(p1));
    args.append(toJS(p2));
    args.append(toJS(p3));
    args.append(toJS(p4));

    auto callData = JSC::getCallData(fn);
    JSValue result = JSC::call(globalObject, fn, callData, jsUndefined(), args);
    if (scope.exception()) [[unlikely]] {
        db->setIgnoreNextSqliteError();
        return SQLITE_DENY;
    }

    // Node accepts only the three documented codes. Anything else is a
    // TypeError (wrong type) or RangeError (integer but not in the set).
    // We have to raise the JS exception from inside sqlite's C
    // callback, so open a transient ThrowScope just long enough to
    // place the error on the VM. After that scope's destructor has
    // simulateThrow()'d, acknowledge the pending exception on the
    // *outer* TopExceptionScope — otherwise its destructor's
    // verifyExceptionCheckNeedIsSatisfied asserts under
    // validateExceptionChecks when we unwind back into sqlite.
    auto fail = [&](bool typeErr, ASCIILiteral msg) {
        {
            auto inner = DECLARE_THROW_SCOPE(vm);
            auto* err = typeErr
                ? createTypeError(globalObject, msg)
                : createRangeError(globalObject, msg);
            inner.throwException(globalObject, err);
            inner.release();
        }
        (void)scope.exception();
        db->setIgnoreNextSqliteError();
        return SQLITE_DENY;
    };

    if (!result.isInt32()) {
        if (result.isNumber()) {
            double d = result.asNumber();
            if (std::isfinite(d) && std::trunc(d) == d && d >= INT32_MIN && d <= INT32_MAX) {
                result = jsNumber(static_cast<int32_t>(d));
            }
        }
        if (!result.isInt32()) {
            return fail(true, "Authorizer callback must return an integer authorization code"_s);
        }
    }
    int32_t code = result.asInt32();
    if (code != SQLITE_OK && code != SQLITE_DENY && code != SQLITE_IGNORE) {
        return fail(false, "Authorizer callback returned a invalid authorization code"_s);
    }
    return code;
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncSetAuthorizer, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    JSValue arg0 = callFrame->argument(0);
    if (arg0.isNull()) {
        sqlite3_set_authorizer(self->connection(), nullptr, nullptr);
        self->m_authorizer.clear();
        return JSValue::encode(jsUndefined());
    }
    if (!arg0.isCallable()) {
        return throwNodeArgType(globalObject, scope, "callback"_s, "a function or null"_s);
    }
    self->m_authorizer.set(vm, self, arg0.getObject());
    int r = sqlite3_set_authorizer(self->connection(), nodeSqliteAuthorizerCallback, self);
    if (r != SQLITE_OK) {
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncSerialize, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    JSDatabaseSync::BusyScope busy { self };

    WTF::String dbName = "main"_s;
    JSValue arg0 = callFrame->argument(0);
    if (!arg0.isUndefined()) {
        if (!arg0.isString()) {
            return throwNodeArgType(globalObject, scope, "dbName"_s, "a string"_s);
        }
        dbName = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    auto dbNameUtf8 = dbName.utf8();

    sqlite3_int64 size = 0;
    unsigned char* data = sqlite3_serialize(self->connection(), dbNameUtf8.data(), &size, 0);
    if (data == nullptr) {
        // sqlite3_serialize returns null with size==0 for a brand-new
        // empty schema whose database file hasn't been materialised yet
        // (e.g. serialising an ATTACHed :memory: schema that has had no
        // DDL). Node treats that as an empty Uint8Array; anything else
        // is a real failure on the connection.
        if (size == 0) {
            auto* array = JSC::JSUint8Array::createUninitialized(globalObject, globalObject->m_typedArrayUint8.get(globalObject), 0);
            RETURN_IF_EXCEPTION(scope, {});
            return JSValue::encode(array);
        }
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }

    size_t byteLen = static_cast<size_t>(size);
    auto* array = JSC::JSUint8Array::createUninitialized(globalObject, globalObject->m_typedArrayUint8.get(globalObject), byteLen);
    if (scope.exception()) [[unlikely]] {
        sqlite3_free(data);
        return {};
    }
    if (byteLen > 0) memcpy(array->typedVector(), data, byteLen);
    sqlite3_free(data);
    return JSValue::encode(array);
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncDeserialize, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    // deserialize() tears down every prepared statement on the connection
    // (they all refer to schema that's about to be replaced), so refuse
    // while anything is mid-execution for the same reason close() does.
    if (self->isBusy()) {
        return throwNodeState(globalObject, scope, "cannot deserialize database while a statement is executing"_s);
    }

    auto* buf = dynamicDowncast<JSC::JSUint8Array>(callFrame->argument(0));
    if (!buf) {
        return throwNodeArgType(globalObject, scope, "buffer"_s, "a Uint8Array"_s);
    }
    auto span = buf->span();
    if (span.size() == 0) {
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE,
            "The \"buffer\" argument must not be empty."_s);
    }

    WTF::String dbName = "main"_s;
    JSValue optsVal = callFrame->argument(1);
    if (!optsVal.isUndefined()) {
        if (!optsVal.isObject()) {
            return throwNodeArgType(globalObject, scope, "options"_s, "an object"_s);
        }
        JSObject* opts = optsVal.getObject();
        JSValue nameV = opts->get(globalObject, Identifier::fromString(vm, "dbName"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!nameV.isUndefined()) {
            if (!nameV.isString()) {
                return throwNodeArgType(globalObject, scope, "options.dbName"_s, "a string"_s);
            }
            dbName = nameV.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    auto dbNameUtf8 = dbName.utf8();

    // SQLITE_DESERIALIZE_FREEONCLOSE hands ownership of the buffer to
    // SQLite (freed on close) — it must therefore come from
    // sqlite3_malloc64. Copy the input in case JS later mutates or
    // detaches it; also required for the zombie-statement case where
    // the connection outlives this call.
    unsigned char* owned = static_cast<unsigned char*>(sqlite3_malloc64(span.size()));
    if (!owned) {
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_OUT_OF_RANGE,
            "Failed to allocate memory for SQLite deserialize"_s);
    }
    memcpy(owned, span.data(), span.size());

    // Invalidate every existing statement first — after the schema
    // swap they reference tables that no longer exist. Bumping the
    // open-generation makes every live JSStatementSync / Session
    // report isFinalized()/isStale() without us having to track them
    // explicitly (same mechanism close()+open() relies on). We leave
    // the underlying sqlite3_stmt* alone: the JS wrappers still own
    // those handles and will sqlite3_finalize() them on GC, so
    // finalizing here would make the wrapper double-free a dangling
    // pointer. sqlite3_deserialize tolerates the outstanding stmts —
    // they simply fail if stepped, which the generation check prevents.
    self->bumpOpenGeneration();

    int r = sqlite3_deserialize(self->connection(), dbNameUtf8.data(), owned,
        static_cast<sqlite3_int64>(span.size()), static_cast<sqlite3_int64>(span.size()),
        SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE);
    if (r != SQLITE_OK) {
        // SQLite already freed `owned` (or took ownership) on both
        // success and failure paths once FREEONCLOSE is set.
        throwSqliteError(globalObject, scope, self->connection());
        return {};
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncCreateTagStore, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    int capacity = 1000;
    JSValue arg0 = callFrame->argument(0);
    if (arg0.isNumber()) {
        capacity = arg0.toInt32(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (capacity < 1) capacity = 1;
    }
    auto* zigGlobal = defaultGlobalObject(globalObject);
    auto* structure = zigGlobal->m_JSNodeSqliteTagStoreClassStructure.get(zigGlobal);
    auto* store = JSNodeSqliteTagStore::create(vm, structure, self, static_cast<unsigned>(capacity));
    return JSValue::encode(store);
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
        return throwNodeState(globalObject, scope, "database is not open"_s);
    }
    return JSValue::encode(jsBoolean(sqlite3_get_autocommit(self->connection()) == 0));
}

JSC_DEFINE_CUSTOM_GETTER(jsDatabaseSyncLimits, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = getVM(globalObject);
    JSDatabaseSync* self = dynamicDowncast<JSDatabaseSync>(JSValue::decode(thisValue));
    if (!self) return JSValue::encode(jsUndefined());
    // Same wrapper for the lifetime of the DatabaseSync; it stays valid
    // across close()/open() and just reports ERR_INVALID_STATE while
    // the connection is down.
    if (auto* cached = self->m_limits.get()) return JSValue::encode(cached);
    auto* zigGlobal = defaultGlobalObject(globalObject);
    auto* structure = zigGlobal->m_JSNodeSqliteLimitsClassStructure.get(zigGlobal);
    auto* limits = JSNodeSqliteLimits::create(vm, structure, self);
    self->m_limits.set(vm, self, limits);
    return JSValue::encode(limits);
}

static const HashTableValue JSDatabaseSyncPrototypeTableValues[] = {
    { "open"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncOpen, 0 } },
    { "close"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncClose, 0 } },
    { "exec"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncExec, 1 } },
    { "prepare"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncPrepare, 1 } },
    { "location"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncLocation, 0 } },
    { "enableLoadExtension"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncEnableLoadExtension, 1 } },
    { "enableDefensive"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncEnableDefensive, 1 } },
    { "loadExtension"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncLoadExtension, 1 } },
    { "function"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncFunction, 2 } },
    { "aggregate"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncAggregate, 2 } },
    { "createSession"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncCreateSession, 0 } },
    { "applyChangeset"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncApplyChangeset, 1 } },
    { "setAuthorizer"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncSetAuthorizer, 1 } },
    { "serialize"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncSerialize, 0 } },
    { "deserialize"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncDeserialize, 1 } },
    { "createTagStore"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDatabaseSyncCreateTagStore, 0 } },
    { "isOpen"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDatabaseSyncIsOpen, nullptr } },
    { "isTransaction"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDatabaseSyncIsTransaction, nullptr } },
    { "limits"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDatabaseSyncLimits, nullptr } },
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
            // Pass the full href — including any ?query — straight
            // through. open() sets SQLITE_OPEN_URI (as Node does), so
            // sqlite3ParseUri handles percent-decoding and honours
            // ?mode=ro / ?cache=shared etc. Reducing to a plain
            // filesystem path here would silently drop those, which
            // is exactly what test-sqlite.js's "URI query params"
            // suite checks for. This mirrors Node's
            // ValidateDatabasePath, which returns the href verbatim.
            if (!hrefStr.startsWith("file:"_s)) {
                Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_URL_SCHEME, "The URL must be of scheme file:"_s);
                return false;
            }
            out = hrefStr;
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
            return throwNodeArgType(globalObject, scope, "options"_s, "an object"_s);
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
        if (!readBoolOption(globalObject, scope, opts, "defensive"_s, config.enableDefensive)) return {};

        JSValue limitsV = opts->get(globalObject, Identifier::fromString(vm, "limits"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!limitsV.isUndefined()) {
            if (!limitsV.isObject()) {
                return throwNodeArgType(globalObject, scope, "options.limits"_s, "an object"_s);
            }
            JSObject* limitsObj = limitsV.getObject();
            for (const auto& info : kLimitMapping) {
                JSValue v = limitsObj->get(globalObject, Identifier::fromString(vm, info.name));
                RETURN_IF_EXCEPTION(scope, {});
                if (v.isUndefined()) continue;
                bool ok = v.isInt32();
                if (!ok && v.isNumber()) {
                    double d = v.asNumber();
                    ok = std::isfinite(d) && std::trunc(d) == d && d >= INT32_MIN && d <= INT32_MAX;
                }
                if (!ok) {
                    return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                        makeString("The \"options.limits."_s, info.name, "\" argument must be an integer."_s));
                }
                int32_t iv = v.toInt32(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                if (iv < 0) {
                    return Bun::throwError(globalObject, scope, ErrorCode::ERR_OUT_OF_RANGE,
                        makeString("The \"options.limits."_s, info.name, "\" argument must be non-negative."_s));
                }
                config.initialLimits[static_cast<size_t>(info.id)] = iv;
            }
        }

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
                return throwNodeArgType(globalObject, scope, "options.timeout"_s, "an integer"_s);
            }
            config.timeout = timeoutVal.toInt32(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    auto* structure = zigGlobal->m_JSDatabaseSyncClassStructure.get(zigGlobal);
    auto* db = JSDatabaseSync::create(vm, structure, std::move(location), std::move(config));

    // Node attaches Symbol.for('sqlite-type') → 'node:sqlite' to every
    // instance via the InstanceTemplate so userland can sniff the
    // flavour of a DatabaseSync without an `instanceof` across realms.
    auto typeSym = Identifier::fromUid(vm.symbolRegistry().symbolForKey("sqlite-type"_s));
    db->putDirect(vm, typeSym, jsString(vm, String("node:sqlite"_s)), 0);

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
    visitor.append(thisObject->m_rowStructure);
}
DEFINE_VISIT_CHILDREN(JSStatementSync);

void JSStatementSync::invalidateRowStructure()
{
    m_rowStructure.clear();
    m_columnOffsets.clear();
    m_rowColumnCount = -1;
}

// Build (and cache) a null-prototype Structure whose inline slots map
// 1:1 to this statement's distinct column names. Returns nullptr when
// the column set is too wide for JSFinalObject's inline capacity —
// callers fall back to the generic rowToObject() in that case. The
// shape is keyed on sqlite3_column_count(), which is stable for a
// given prepared statement; we still re-check it so a stale cache
// (e.g. after deserialize()) is rebuilt rather than producing an
// object with the wrong number of slots.
Structure* JSStatementSync::ensureRowStructure(JSGlobalObject* globalObject)
{
    auto& vm = getVM(globalObject);
    int count = sqlite3_column_count(m_stmt);
    if (m_rowColumnCount == count && m_rowStructure) {
        return m_rowStructure.get();
    }
    invalidateRowStructure();
    m_rowColumnCount = count;
    if (count <= 0 || static_cast<unsigned>(count) > JSFinalObject::maxInlineCapacity) {
        return nullptr;
    }

    // First pass: collect distinct names in column order. A join can
    // produce duplicate column names; Node keeps the first and drops
    // later occurrences (same as a plain object putDirect would), so
    // mark those columns with offset -1.
    m_columnOffsets.reserveCapacity(static_cast<size_t>(count));
    WTF::Vector<Identifier, JSFinalObject::maxInlineCapacity> names;
    for (int i = 0; i < count; ++i) {
        const char* name = sqlite3_column_name(m_stmt, i);
        if (!name || name[0] == '\0') {
            // Pathological — give up on the fast path for this stmt.
            m_columnOffsets.clear();
            return nullptr;
        }
        auto id = Identifier::fromString(vm, WTF::String::fromUTF8(name));
        int8_t off = -1;
        bool dup = false;
        for (const auto& existing : names) {
            if (existing == id) {
                dup = true;
                break;
            }
        }
        if (!dup) {
            off = static_cast<int8_t>(names.size());
            names.append(id);
        }
        m_columnOffsets.append(off);
    }

    // StructureCache::emptyObjectStructureForPrototype requires a
    // non-null prototype, but node:sqlite rows have [[Prototype]] ===
    // null (the tests assert it). Build the null-proto shape directly
    // and let the statement's own WriteBarrier keep it alive; the
    // per-property transition chain is still cached on the Structure
    // itself, so subsequent statements with the same column set share
    // it via transition lookup.
    Structure* structure = JSFinalObject::createStructure(vm, globalObject, jsNull(), static_cast<unsigned>(names.size()));
    for (const auto& id : names) {
        PropertyOffset offset;
        structure = Structure::addPropertyTransition(vm, structure, id, 0, offset);
    }
    m_rowStructure.set(vm, this, structure);
    return structure;
}

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
                        throwNodeState(globalObject, scope,
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
                    throwNodeState(globalObject, scope,
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

    // Anonymous (positional) parameters: fill slots that don't have a
    // name. SQLite reports a name for `?NNN` placeholders too ("?1",
    // "?2", …) but Node treats those as positional — only `$foo` /
    // `:foo` / `@foo` are skipped here.
    int anonIdx = 1;
    for (size_t i = anonStart; i < argc; ++i) {
        while (true) {
            const char* name = sqlite3_bind_parameter_name(m_stmt, anonIdx);
            if (name == nullptr || name[0] == '?') break;
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
        : rowToObjectCached(globalObject, scope, self, numCols, self->useBigInts());
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
            : rowToObjectCached(globalObject, scope, self, numCols, self->useBigInts());
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
            return throwNodeArgType(globalObject, scope, argName, "a boolean"_s);            \
        }                                                                                    \
        self->setter(v.asBoolean());                                                         \
        return JSValue::encode(jsUndefined());                                               \
    }

DEFINE_STMT_BOOL_SETTER(jsStatementSyncSetReadBigInts, setUseBigInts, "readBigInts"_s)
DEFINE_STMT_BOOL_SETTER(jsStatementSyncSetReturnArrays, setReturnArrays, "returnArrays"_s)
DEFINE_STMT_BOOL_SETTER(jsStatementSyncSetAllowBareNamedParameters, setAllowBareNamedParams, "allowBareNamedParameters"_s)
// Node names this one's argument "enabled" (not the property it
// controls) — two upstream tests assert on it.
DEFINE_STMT_BOOL_SETTER(jsStatementSyncSetAllowUnknownNamedParameters, setAllowUnknownNamedParams, "enabled"_s)

JSC_DEFINE_CUSTOM_GETTER(jsStatementSyncSourceSQL, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSStatementSync* self = dynamicDowncast<JSStatementSync>(JSValue::decode(thisValue));
    if (!self) return JSValue::encode(jsUndefined());
    if (self->isFinalized()) {
        return throwNodeState(globalObject, scope, "statement has been finalized"_s);
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
        return throwNodeState(globalObject, scope, "statement has been finalized"_s);
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
        return throwNodeState(globalObject, scope, "statement has been finalized"_s);
    }
    if (self->capturedGeneration() != stmt->resetGeneration()) {
        return throwNodeState(globalObject, scope, "iterator was invalidated by calling run(), get(), all(), or iterate() on the backing statement"_s);
    }
    JSDatabaseSync::BusyScope busy { stmt->database() };

    int r = sqlite3_step(stmt->statement());
    CHECK_UDF_EXCEPTION(scope, stmt->database());
    if (r == SQLITE_ROW) {
        int numCols = sqlite3_column_count(stmt->statement());
        JSValue row = stmt->returnArrays()
            ? rowToArray(globalObject, scope, stmt->statement(), numCols, stmt->useBigInts())
            : rowToObjectCached(globalObject, scope, stmt, numCols, stmt->useBigInts());
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
        return throwNodeState(globalObject, scope, "database is not open"_s);
    }
    if (self->session() == nullptr) {
        return throwNodeState(globalObject, scope, "session is not open"_s);
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
        return throwNodeState(globalObject, scope, "database is not open"_s);
    }
    if (self->session() == nullptr) {
        return throwNodeState(globalObject, scope, "session is not open"_s);
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
// JSNodeSqliteLimits — property-interceptor wrapper over sqlite3_limit()
// ─────────────────────────────────────────────────────────────────────────────

const ClassInfo JSNodeSqliteLimits::s_info = { "DatabaseSyncLimits"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSqliteLimits) };

JSNodeSqliteLimits* JSNodeSqliteLimits::create(VM& vm, Structure* structure, JSDatabaseSync* db)
{
    auto* ptr = new (NotNull, allocateCell<JSNodeSqliteLimits>(vm)) JSNodeSqliteLimits(vm, structure);
    ptr->finishCreation(vm, db);
    return ptr;
}

void JSNodeSqliteLimits::finishCreation(VM& vm, JSDatabaseSync* db)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_database.set(vm, this, db);
}

template<typename Visitor>
void JSNodeSqliteLimits::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSNodeSqliteLimits>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_database);
}
DEFINE_VISIT_CHILDREN(JSNodeSqliteLimits);

GCClient::IsoSubspace* JSNodeSqliteLimits::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSNodeSqliteLimits, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForNodeSqliteLimits.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeSqliteLimits = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForNodeSqliteLimits.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeSqliteLimits = std::forward<decltype(space)>(space); });
}

bool JSNodeSqliteLimits::getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, PropertySlot& slot)
{
    auto* self = uncheckedDowncast<JSNodeSqliteLimits>(object);
    // Only intercept the eleven known names; anything else (symbols,
    // toString, unknown props) falls through to ordinary lookup so the
    // object still behaves like a plain object for debugging / console.
    if (!propertyName.isSymbol()) {
        int id = findLimitId(propertyName.publicName());
        if (id >= 0) {
            auto& vm = getVM(globalObject);
            auto scope = DECLARE_THROW_SCOPE(vm);
            auto* db = self->database();
            if (!db || !db->isOpen()) {
                throwNodeState(globalObject, scope, "database is not open"_s);
                return true;
            }
            int current = sqlite3_limit(db->connection(), id, -1);
            slot.setValue(self, static_cast<unsigned>(PropertyAttribute::DontDelete), jsNumber(current));
            return true;
        }
    }
    return Base::getOwnPropertySlot(object, globalObject, propertyName, slot);
}

bool JSNodeSqliteLimits::put(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSValue value, PutPropertySlot& slot)
{
    auto* self = uncheckedDowncast<JSNodeSqliteLimits>(cell);
    if (!propertyName.isSymbol()) {
        int id = findLimitId(propertyName.publicName());
        if (id >= 0) {
            auto& vm = getVM(globalObject);
            auto scope = DECLARE_THROW_SCOPE(vm);
            auto* db = self->database();
            if (!db || !db->isOpen()) {
                throwNodeState(globalObject, scope, "database is not open"_s);
                return false;
            }
            // Node accepts either a non-negative int32 or +Infinity
            // (which resets to the compile-time maximum by passing the
            // largest possible value — sqlite3_limit clamps). Reject
            // everything else with Node's exact error text.
            int newValue;
            if (value.isNumber()) {
                double d = value.asNumber();
                if (std::isinf(d) && d > 0) {
                    newValue = INT32_MAX;
                } else if (std::isfinite(d) && std::trunc(d) == d && d >= INT32_MIN && d <= INT32_MAX) {
                    newValue = static_cast<int>(d);
                    if (newValue < 0) {
                        Bun::throwError(globalObject, scope, ErrorCode::ERR_OUT_OF_RANGE,
                            "Limit value must be non-negative."_s);
                        return false;
                    }
                } else {
                    Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                        "Limit value must be a non-negative integer or Infinity."_s);
                    return false;
                }
            } else {
                Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                    "Limit value must be a non-negative integer or Infinity."_s);
                return false;
            }
            sqlite3_limit(db->connection(), id, newValue);
            return true;
        }
    }
    return Base::put(cell, globalObject, propertyName, value, slot);
}

void JSNodeSqliteLimits::getOwnPropertyNames(JSObject* object, JSGlobalObject* globalObject, PropertyNameArrayBuilder& names, DontEnumPropertiesMode mode)
{
    auto& vm = getVM(globalObject);
    for (const auto& info : kLimitMapping) {
        names.add(Identifier::fromString(vm, info.name));
    }
    Base::getOwnPropertyNames(object, globalObject, names, mode);
}

// ─────────────────────────────────────────────────────────────────────────────
// JSNodeSqliteTagStore — db.createTagStore()
// ─────────────────────────────────────────────────────────────────────────────

const ClassInfo JSNodeSqliteTagStore::s_info = { "SQLTagStore"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSqliteTagStore) };
const ClassInfo JSNodeSqliteTagStorePrototype::s_info = { "SQLTagStore"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSqliteTagStorePrototype) };

JSNodeSqliteTagStore* JSNodeSqliteTagStore::create(VM& vm, Structure* structure, JSDatabaseSync* db, unsigned capacity)
{
    auto* ptr = new (NotNull, allocateCell<JSNodeSqliteTagStore>(vm)) JSNodeSqliteTagStore(vm, structure);
    ptr->finishCreation(vm, db, capacity);
    return ptr;
}

void JSNodeSqliteTagStore::finishCreation(VM& vm, JSDatabaseSync* db, unsigned capacity)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_database.set(vm, this, db);
    m_capacity = capacity;
}

void JSNodeSqliteTagStore::clear()
{
    m_order.clear();
}

template<typename Visitor>
void JSNodeSqliteTagStore::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSNodeSqliteTagStore>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_database);
    for (auto& e : thisObject->m_order) {
        visitor.append(e.stmt);
    }
}
DEFINE_VISIT_CHILDREN(JSNodeSqliteTagStore);

GCClient::IsoSubspace* JSNodeSqliteTagStore::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSNodeSqliteTagStore, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForNodeSqliteTagStore.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeSqliteTagStore = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForNodeSqliteTagStore.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeSqliteTagStore = std::forward<decltype(space)>(space); });
}

JSStatementSync* JSNodeSqliteTagStore::prepare(JSGlobalObject* globalObject, ThrowScope& scope, CallFrame* callFrame)
{
    auto& vm = getVM(globalObject);
    auto* db = database();
    if (!db || !db->isOpen()) {
        throwNodeState(globalObject, scope, "database is not open"_s);
        return nullptr;
    }

    JSValue arg0 = callFrame->argument(0);
    if (!arg0.isObject() || !isArray(globalObject, arg0)) {
        RETURN_IF_EXCEPTION(scope, nullptr);
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
            "First argument must be an array of strings (template literal)."_s);
        return nullptr;
    }
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSObject* parts = arg0.getObject();
    uint32_t nStrings = static_cast<uint32_t>(toLength(globalObject, parts));
    RETURN_IF_EXCEPTION(scope, nullptr);
    uint32_t nParams = callFrame->argumentCount() > 0 ? callFrame->argumentCount() - 1 : 0;

    // Join the template parts with "?" placeholders. The resulting SQL
    // is also the cache key — identical tag call sites produce
    // identical SQL and hit the same prepared statement.
    WTF::StringBuilder sql;
    for (uint32_t i = 0; i < nStrings; ++i) {
        JSValue part = parts->get(globalObject, i);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (!part.isString()) {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                "Template literal parts must be strings."_s);
            return nullptr;
        }
        sql.append(part.toWTFString(globalObject));
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (i < nParams) sql.append('?');
    }
    WTF::String sqlStr = sql.toString();

    // LRU lookup: hit → move to front; evict stale entries as we go.
    JSStatementSync* stmtObj = nullptr;
    for (size_t i = 0; i < m_order.size(); ++i) {
        if (m_order[i].sql != sqlStr) continue;
        auto* cand = m_order[i].stmt.get();
        if (!cand || cand->isFinalized()) {
            m_order.removeAt(i);
            break;
        }
        stmtObj = cand;
        if (i > 0) {
            Entry e = std::move(m_order[i]);
            m_order.removeAt(i);
            m_order.insert(0, std::move(e));
        }
        break;
    }

    if (!stmtObj) {
        auto utf8 = sqlStr.utf8();
        sqlite3_stmt* stmt = nullptr;
        int r = sqlite3_prepare_v2(db->connection(), utf8.data(), static_cast<int>(utf8.length()), &stmt, nullptr);
        if (r != SQLITE_OK) {
            if (stmt) sqlite3_finalize(stmt);
            throwSqliteError(globalObject, scope, db->connection());
            return nullptr;
        }
        if (!stmt) {
            throwNodeState(globalObject, scope, "The supplied SQL string contains no statements"_s);
            return nullptr;
        }
        auto* zigGlobal = defaultGlobalObject(globalObject);
        auto* structure = zigGlobal->m_JSStatementSyncClassStructure.get(zigGlobal);
        stmtObj = JSStatementSync::create(vm, structure, db, stmt);
        stmtObj->setUseBigInts(db->config().readBigInts);
        stmtObj->setReturnArrays(db->config().returnArrays);
        stmtObj->setAllowBareNamedParams(db->config().allowBareNamedParameters);
        stmtObj->setAllowUnknownNamedParams(db->config().allowUnknownNamedParameters);

        if (m_order.size() >= m_capacity) m_order.removeLast();
        Entry e;
        e.sql = sqlStr;
        e.stmt.set(vm, this, stmtObj);
        m_order.insert(0, std::move(e));
    }

    // Reset + bind positional values. Named-parameter handling is not
    // meaningful for a tagged template.
    sqlite3_stmt* stmt = stmtObj->statement();
    int rr = sqlite3_reset(stmt);
    stmtObj->bumpResetGeneration();
    if (rr != SQLITE_OK) {
        throwSqliteError(globalObject, scope, db->connection());
        return nullptr;
    }
    sqlite3_clear_bindings(stmt);
    int paramCount = sqlite3_bind_parameter_count(stmt);
    for (int i = 0; i < static_cast<int>(nParams) && i < paramCount; ++i) {
        // bindValue is private; reuse bindParams' logic via public path:
        // call the same conversion directly here (subset of bindValue).
        JSValue v = callFrame->argument(static_cast<size_t>(i) + 1);
        int br = SQLITE_OK;
        if (v.isInt32())
            br = sqlite3_bind_int(stmt, i + 1, v.asInt32());
        else if (v.isNumber())
            br = sqlite3_bind_double(stmt, i + 1, v.asNumber());
        else if (v.isString()) {
            auto s = v.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, nullptr);
            auto u = s.utf8();
            br = sqlite3_bind_text(stmt, i + 1, u.data(), static_cast<int>(u.length()), SQLITE_TRANSIENT);
        } else if (v.isNull() || v.isUndefined()) {
            br = sqlite3_bind_null(stmt, i + 1);
        } else if (v.isBigInt()) {
            int64_t iv = JSBigInt::toBigInt64(v);
            br = sqlite3_bind_int64(stmt, i + 1, iv);
        } else if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(v)) {
            auto span = view->span();
            br = sqlite3_bind_blob(stmt, i + 1, span.data(), static_cast<int>(span.size()), SQLITE_TRANSIENT);
        } else {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                makeString("Provided value cannot be bound to SQLite parameter "_s, i + 1));
            return nullptr;
        }
        if (br != SQLITE_OK) {
            throwSqliteError(globalObject, scope, db->connection());
            return nullptr;
        }
    }
    return stmtObj;
}

#define THIS_TAGSTORE()                                                                                                    \
    auto& vm = JSC::getVM(globalObject);                                                                                   \
    auto scope = DECLARE_THROW_SCOPE(vm);                                                                                  \
    JSNodeSqliteTagStore* self = dynamicDowncast<JSNodeSqliteTagStore>(callFrame->thisValue());                            \
    if (!self) [[unlikely]] {                                                                                              \
        scope.throwException(globalObject, createInvalidThisError(globalObject, callFrame->thisValue(), "SQLTagStore"_s)); \
        return {};                                                                                                         \
    }

// Shared tag execution: prepare/reset/bind then drive the cached
// statement with the same semantics as StatementSync's run/get/all.
// No separate StatementExecutionHelper like Node's — the statement
// object already carries everything we need.

JSC_DEFINE_HOST_FUNCTION(jsTagStoreRun, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_TAGSTORE();
    JSDatabaseSync::BusyScope busy { self->database() };
    JSStatementSync* stmt = self->prepare(globalObject, scope, callFrame);
    RETURN_IF_EXCEPTION(scope, {});
    sqlite3_stmt* s = stmt->statement();
    int r;
    while ((r = sqlite3_step(s)) == SQLITE_ROW) {
    }
    CHECK_UDF_EXCEPTION(scope, self->database());
    if (r != SQLITE_DONE) {
        throwSqliteError(globalObject, scope, self->database()->connection());
        sqlite3_reset(s);
        return {};
    }
    sqlite3* conn = sqlite3_db_handle(s);
    int64_t changes = sqlite3_changes64(conn);
    int64_t lastId = sqlite3_last_insert_rowid(conn);
    sqlite3_reset(s);
    JSObject* result = constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
    result->putDirect(vm, Identifier::fromString(vm, "changes"_s),
        stmt->useBigInts() ? JSValue(JSBigInt::makeHeapBigIntOrBigInt32(globalObject, changes)) : jsNumber(static_cast<double>(changes)), 0);
    result->putDirect(vm, Identifier::fromString(vm, "lastInsertRowid"_s),
        stmt->useBigInts() ? JSValue(JSBigInt::makeHeapBigIntOrBigInt32(globalObject, lastId)) : jsNumber(static_cast<double>(lastId)), 0);
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsTagStoreGet, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_TAGSTORE();
    JSDatabaseSync::BusyScope busy { self->database() };
    JSStatementSync* stmt = self->prepare(globalObject, scope, callFrame);
    RETURN_IF_EXCEPTION(scope, {});
    sqlite3_stmt* s = stmt->statement();
    int r = sqlite3_step(s);
    CHECK_UDF_EXCEPTION(scope, self->database());
    if (r == SQLITE_DONE) {
        sqlite3_reset(s);
        return JSValue::encode(jsUndefined());
    }
    if (r != SQLITE_ROW) {
        throwSqliteError(globalObject, scope, self->database()->connection());
        sqlite3_reset(s);
        return {};
    }
    int numCols = sqlite3_column_count(s);
    JSValue row = stmt->returnArrays()
        ? rowToArray(globalObject, scope, s, numCols, stmt->useBigInts())
        : rowToObjectCached(globalObject, scope, stmt, numCols, stmt->useBigInts());
    sqlite3_reset(s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(row);
}

JSC_DEFINE_HOST_FUNCTION(jsTagStoreAll, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_TAGSTORE();
    JSDatabaseSync::BusyScope busy { self->database() };
    JSStatementSync* stmt = self->prepare(globalObject, scope, callFrame);
    RETURN_IF_EXCEPTION(scope, {});
    sqlite3_stmt* s = stmt->statement();
    JSArray* rows = constructEmptyArray(globalObject, nullptr, 0);
    RETURN_IF_EXCEPTION(scope, {});
    int numCols = sqlite3_column_count(s);
    uint32_t idx = 0;
    int r;
    while ((r = sqlite3_step(s)) == SQLITE_ROW) {
        CHECK_UDF_EXCEPTION(scope, self->database());
        JSValue row = stmt->returnArrays()
            ? rowToArray(globalObject, scope, s, numCols, stmt->useBigInts())
            : rowToObjectCached(globalObject, scope, stmt, numCols, stmt->useBigInts());
        if (scope.exception()) [[unlikely]] {
            sqlite3_reset(s);
            return {};
        }
        rows->putDirectIndex(globalObject, idx++, row);
        if (scope.exception()) [[unlikely]] {
            sqlite3_reset(s);
            return {};
        }
    }
    CHECK_UDF_EXCEPTION(scope, self->database());
    sqlite3_reset(s);
    if (r != SQLITE_DONE) {
        throwSqliteError(globalObject, scope, self->database()->connection());
        return {};
    }
    return JSValue::encode(rows);
}

JSC_DEFINE_HOST_FUNCTION(jsTagStoreIterate, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_TAGSTORE();
    JSDatabaseSync::BusyScope busy { self->database() };
    JSStatementSync* stmt = self->prepare(globalObject, scope, callFrame);
    RETURN_IF_EXCEPTION(scope, {});
    auto* zigGlobal = defaultGlobalObject(globalObject);
    auto* structure = zigGlobal->m_JSStatementSyncIteratorClassStructure.get(zigGlobal);
    auto* iter = JSStatementSyncIterator::create(vm, structure, stmt);
    return JSValue::encode(iter);
}

JSC_DEFINE_HOST_FUNCTION(jsTagStoreClear, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_TAGSTORE();
    self->clear();
    (void)scope;
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(jsTagStoreCapacity, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName))
{
    auto* self = dynamicDowncast<JSNodeSqliteTagStore>(JSValue::decode(thisValue));
    if (!self) return JSValue::encode(jsUndefined());
    return JSValue::encode(jsNumber(self->capacity()));
}
JSC_DEFINE_CUSTOM_GETTER(jsTagStoreSize, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName))
{
    auto* self = dynamicDowncast<JSNodeSqliteTagStore>(JSValue::decode(thisValue));
    if (!self) return JSValue::encode(jsUndefined());
    return JSValue::encode(jsNumber(self->size()));
}
JSC_DEFINE_CUSTOM_GETTER(jsTagStoreDb, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName))
{
    auto* self = dynamicDowncast<JSNodeSqliteTagStore>(JSValue::decode(thisValue));
    if (!self) return JSValue::encode(jsUndefined());
    auto* db = self->database();
    return JSValue::encode(db ? JSValue(db) : jsUndefined());
}

static const HashTableValue JSNodeSqliteTagStorePrototypeTableValues[] = {
    { "run"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsTagStoreRun, 0 } },
    { "get"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsTagStoreGet, 0 } },
    { "all"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsTagStoreAll, 0 } },
    { "iterate"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsTagStoreIterate, 0 } },
    { "clear"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsTagStoreClear, 0 } },
    { "capacity"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTagStoreCapacity, nullptr } },
    { "size"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTagStoreSize, nullptr } },
    { "db"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTagStoreDb, nullptr } },
};

void JSNodeSqliteTagStorePrototype::finishCreation(VM& vm, JSGlobalObject*)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSNodeSqliteTagStore::info(), JSNodeSqliteTagStorePrototypeTableValues, *this);
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
        return throwNodeArgType(globalObject, scope, "sourceDb"_s, "an object"_s);
    }
    auto* sourceDb = dynamicDowncast<JSDatabaseSync>(sourceVal);
    if (!sourceDb) {
        return throwNodeArgType(globalObject, scope, "sourceDb"_s, "an object"_s);
    }
    if (!sourceDb->isOpen()) {
        return throwNodeState(globalObject, scope, "database is not open"_s);
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
            return throwNodeArgType(globalObject, scope, "options"_s, "an object"_s);
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
                return throwNodeArgType(globalObject, scope, "options.rate"_s, "an integer"_s);
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
                return throwNodeArgType(globalObject, scope, "options.source"_s, "a string"_s);
            }
            sourceName = sourceV.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
        JSValue targetV = opts->get(globalObject, Identifier::fromString(vm, "target"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!targetV.isUndefined()) {
            if (!targetV.isString()) {
                return throwNodeArgType(globalObject, scope, "options.target"_s, "a string"_s);
            }
            targetName = targetV.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
        JSValue progressV = opts->get(globalObject, Identifier::fromString(vm, "progress"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!progressV.isUndefined()) {
            if (!progressV.isCallable()) {
                return throwNodeArgType(globalObject, scope, "options.progress"_s, "a function"_s);
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
    int r = sqlite3_open_v2(destPathUtf8.data(), &dest, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_URI, nullptr);
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

    // Authorizer return codes + action codes, used by setAuthorizer().
    put("SQLITE_OK"_s, SQLITE_OK);
    put("SQLITE_DENY"_s, SQLITE_DENY);
    put("SQLITE_IGNORE"_s, SQLITE_IGNORE);
    put("SQLITE_CREATE_INDEX"_s, SQLITE_CREATE_INDEX);
    put("SQLITE_CREATE_TABLE"_s, SQLITE_CREATE_TABLE);
    put("SQLITE_CREATE_TEMP_INDEX"_s, SQLITE_CREATE_TEMP_INDEX);
    put("SQLITE_CREATE_TEMP_TABLE"_s, SQLITE_CREATE_TEMP_TABLE);
    put("SQLITE_CREATE_TEMP_TRIGGER"_s, SQLITE_CREATE_TEMP_TRIGGER);
    put("SQLITE_CREATE_TEMP_VIEW"_s, SQLITE_CREATE_TEMP_VIEW);
    put("SQLITE_CREATE_TRIGGER"_s, SQLITE_CREATE_TRIGGER);
    put("SQLITE_CREATE_VIEW"_s, SQLITE_CREATE_VIEW);
    put("SQLITE_DELETE"_s, SQLITE_DELETE);
    put("SQLITE_DROP_INDEX"_s, SQLITE_DROP_INDEX);
    put("SQLITE_DROP_TABLE"_s, SQLITE_DROP_TABLE);
    put("SQLITE_DROP_TEMP_INDEX"_s, SQLITE_DROP_TEMP_INDEX);
    put("SQLITE_DROP_TEMP_TABLE"_s, SQLITE_DROP_TEMP_TABLE);
    put("SQLITE_DROP_TEMP_TRIGGER"_s, SQLITE_DROP_TEMP_TRIGGER);
    put("SQLITE_DROP_TEMP_VIEW"_s, SQLITE_DROP_TEMP_VIEW);
    put("SQLITE_DROP_TRIGGER"_s, SQLITE_DROP_TRIGGER);
    put("SQLITE_DROP_VIEW"_s, SQLITE_DROP_VIEW);
    put("SQLITE_INSERT"_s, SQLITE_INSERT);
    put("SQLITE_PRAGMA"_s, SQLITE_PRAGMA);
    put("SQLITE_READ"_s, SQLITE_READ);
    put("SQLITE_SELECT"_s, SQLITE_SELECT);
    put("SQLITE_TRANSACTION"_s, SQLITE_TRANSACTION);
    put("SQLITE_UPDATE"_s, SQLITE_UPDATE);
    put("SQLITE_ATTACH"_s, SQLITE_ATTACH);
    put("SQLITE_DETACH"_s, SQLITE_DETACH);
    put("SQLITE_ALTER_TABLE"_s, SQLITE_ALTER_TABLE);
    put("SQLITE_REINDEX"_s, SQLITE_REINDEX);
    put("SQLITE_ANALYZE"_s, SQLITE_ANALYZE);
    put("SQLITE_CREATE_VTABLE"_s, SQLITE_CREATE_VTABLE);
    put("SQLITE_DROP_VTABLE"_s, SQLITE_DROP_VTABLE);
    put("SQLITE_FUNCTION"_s, SQLITE_FUNCTION);
    put("SQLITE_SAVEPOINT"_s, SQLITE_SAVEPOINT);
    put("SQLITE_COPY"_s, SQLITE_COPY);
    put("SQLITE_RECURSIVE"_s, SQLITE_RECURSIVE);
    return obj;
}

} // namespace Bun
