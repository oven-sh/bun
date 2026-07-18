// node:sqlite — native implementation of Node.js's `node:sqlite` module.
// See header for overview.

// Use the same SQLite library bun:sqlite uses so both APIs share one POSIX-
// lock inode map (howtocorrupt.html §2.2.1). On macOS that is the dlopen'd
// system libsqlite3.dylib (LAZY_LOAD_SQLITE=1); Apple's build lacks
// sqlite3_load_extension and older releases lack the session extension, so
// those APIs runtime-gate on the dlsym result and point at
// Database.setCustomSQLite(). On Linux/Windows the bundled amalgamation is
// linked.
#ifndef LAZY_LOAD_SQLITE
#define LAZY_LOAD_SQLITE 0
#endif

// The bundled amalgamation's version, for process.versions.sqlite before any
// library is loaded. On the LAZY_LOAD_SQLITE (macOS) branch SQLITE_VERSION
// comes from the SDK's <sqlite3.h> — the CI build machine's, not what runs
// — so use this deterministic constant instead. The static_assert on the
// !LAZY branch below fails the Linux/Windows build if it drifts from
// sqlite3_local.h.
#define BUN_SQLITE_BUNDLED_VERSION "3.53.2"
#define BUN_SQLITE_BUNDLED_VERSION_NUMBER 3053002

#if LAZY_LOAD_SQLITE
#include "lazy_sqlite3.h"
#define LAZY_SQLITE_HAS_LOAD_EXTENSION() (lazy_sqlite3_load_extension != nullptr)
#else
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
static_assert(BUN_SQLITE_BUNDLED_VERSION_NUMBER == SQLITE_VERSION_NUMBER,
    "update BUN_SQLITE_BUNDLED_VERSION to match sqlite3_local.h");
static inline int lazyLoadSQLite() { return 0; }
static constexpr bool lazy_sqlite3_has_session = true;
#define LAZY_SQLITE_HAS_LOAD_EXTENSION() true
#endif

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
#include <wtf/Lock.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/StdLibExtras.h>
#include <wtf/text/MakeString.h>
#include <limits>

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

// One-time process-global sqlite3_config() and the exit-time WAL checkpoint
// helper are defined in JSSQLStatement.cpp so bun:sqlite (which does not
// depend on this file) owns them. Forward-declared here rather than in
// lazy_sqlite3.h because that header is only included on the dlopen path.
extern "C" void Bun__initializeSQLite();
extern "C" void Bun__sqliteCheckpointForTermination(sqlite3*);

// process.versions.sqlite — the loaded library's version if a library has
// been loaded. Otherwise probe the library that WOULD be loaded via a
// throwaway dlopen and cache the result, WITHOUT assigning the global
// sqlite3_handle — so reading process.versions still doesn't defeat
// Database.setCustomSQLite(), and callers who read it before the first
// open see the version the runtime actually uses (not the bundled
// constant, which on macOS isn't linked into the binary at all).
extern "C" const char* Bun__sqlite3_version()
{
#if LAZY_LOAD_SQLITE
    if (sqlite3_handle && lazy_sqlite3_libversion)
        return lazy_sqlite3_libversion();
#if !OS(WINDOWS)
    static const char* probed = []() -> const char* {
        void* h = dlopen(sqlite3_lib_path, RTLD_LAZY | RTLD_LOCAL);
        if (!h) return nullptr;
        auto fn = reinterpret_cast<const char* (*)()>(dlsym(h, "sqlite3_libversion"));
        const char* out = nullptr;
        if (fn) {
            static char buf[24];
            const char* v = fn();
            size_t n = v ? strnlen(v, sizeof(buf) - 1) : 0;
            memcpy(buf, v, n);
            buf[n] = '\0';
            out = buf;
        }
        dlclose(h);
        return out;
    }();
    if (probed) return probed;
#endif
#endif
    return BUN_SQLITE_BUNDLED_VERSION;
}

namespace Bun {

using namespace JSC;
using namespace WebCore;

// SQLite TEXT / column names / errmsg can carry non-UTF-8 bytes (a Latin-1
// blob CAST to TEXT, a column aliased with such a string). WTF::String::
// fromUTF8 returns a NULL string on any invalid byte and jsString(null) then
// yields "" — the drift #31514 fixed for bun:sqlite. Decode with U+FFFD
// replacement everywhere we surface SQLite-owned bytes to JS.
static ALWAYS_INLINE WTF::String sqliteText(const char* p, size_t len)
{
    return WTF::String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const uint8_t*>(p), len });
}
static ALWAYS_INLINE WTF::String sqliteText(const char* p)
{
    return p ? sqliteText(p, strlen(p)) : WTF::String();
}

// Adopt a sqlite3_malloc'd buffer (serialize/changeset/patchset output) as a
// Uint8Array without a copy; the ArrayBuffer destructor runs sqlite3_free.
// Same technique bun:sqlite's serialize() uses (JSSQLStatement.cpp).
static JSC::JSUint8Array* adoptSqliteBuffer(JSGlobalObject* globalObject, void* data, size_t len)
{
    auto* structure = globalObject->typedArrayStructureWithTypedArrayType<JSC::TypeUint8>();
    if (!data || !len) {
        if (data) sqlite3_free(data);
        return JSC::JSUint8Array::create(globalObject, structure, 0);
    }
    auto buffer = ArrayBuffer::createFromBytes({ static_cast<uint8_t*>(data), len },
        createSharedTask<void(void*)>([](void* p) { sqlite3_free(p); }));
    return JSC::JSUint8Array::create(globalObject, structure, WTF::move(buffer), 0, len);
}

// ─────────────────────────────────────────────────────────────────────────────
// Error helpers (match Node.js node_sqlite.cc shapes)
// ─────────────────────────────────────────────────────────────────────────────

// Every ERR_SQLITE_ERROR carries `errcode` (the extended result code) and
// `errstr` (its canonical English text), matching node_sqlite.cc.
static JSObject* createNodeSqliteError(JSGlobalObject* globalObject, int errcode, const WTF::String& message)
{
    auto& vm = getVM(globalObject);
    auto* zigGlobal = defaultGlobalObject(globalObject);
    JSObject* error = createError(zigGlobal, ErrorCode::ERR_SQLITE_ERROR, message);
    error->putDirect(vm, Identifier::fromString(vm, "errcode"_s), jsNumber(errcode), 0);
    error->putDirect(vm, Identifier::fromString(vm, "errstr"_s), jsString(vm, WTF::String::fromUTF8(sqlite3_errstr(errcode))), 0);
    return error;
}

static void throwSqliteError(JSGlobalObject* globalObject, ThrowScope& scope, sqlite3* db)
{
    scope.throwException(globalObject,
        createNodeSqliteError(globalObject, sqlite3_extended_errcode(db), sqliteText(sqlite3_errmsg(db))));
}

static void throwSqliteMessage(JSGlobalObject* globalObject, ThrowScope& scope, int errcode, const WTF::String& message)
{
    scope.throwException(globalObject, createNodeSqliteError(globalObject, errcode, message));
}

// The session extension, sqlite3_deserialize, sqlite3_db_config, and friends
// report failure only in their RETURN code, so `r` is truth. Use the handle's
// richer extended code/message only when its primary code AGREES with `r`.
static void throwSqliteReturnCodeError(JSGlobalObject* globalObject, ThrowScope& scope, sqlite3* db, int r)
{
    // A stale prior error or a benign SQLITE_ROW/DONE left on the handle
    // never matches `r`, so neither can ever be reported in place of it.
    int onHandle = db ? sqlite3_extended_errcode(db) : SQLITE_OK;
    if ((onHandle & 0xff) == (r & 0xff)) {
        throwSqliteError(globalObject, scope, db);
        return;
    }
    throwSqliteMessage(globalObject, scope, r, sqliteText(sqlite3_errstr(r)));
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

// Node.js installs these getters via InstanceTemplate()->SetAccessorProperty
// (DontDelete), so they are OWN properties — Object.keys(db) lists them and
// {...db} copies them. Install in each finishCreation rather than on the
// prototype; subsequent instances follow the cached structure transitions.
static ALWAYS_INLINE void putNodeInstanceGetter(VM& vm, JSObject* target, ASCIILiteral name, JSC::GetValueFunc getter)
{
    target->putDirectCustomAccessor(vm, Identifier::fromString(vm, name),
        CustomGetterSetter::create(vm, getter, nullptr),
        PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete);
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

// run()/get()/all()/iterate() call sqlite3_reset before stepping. If a UDF
// invoked from this statement's own step() re-enters that path,
// sqlite3_reset corrupts the running VDBE and sqlite3_step segfaults (Node
// v26.3.0 crashes here too). Refuse before touching the handle.
#define REQUIRE_STMT_IDLE(self)                                                               \
    do {                                                                                      \
        if ((self)->isStepping()) [[unlikely]]                                                \
            return throwNodeState(globalObject, scope, "statement is currently executing"_s); \
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
// the "user function raised an exception" wrapper — propagate it instead.
// Node's m_ignoreNextSqliteError flag is unnecessary; the pending
// exception IS the signal.
#define CHECK_UDF_EXCEPTION(scope) RETURN_IF_EXCEPTION(scope, {})

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
        return jsString(vm, sqliteText(reinterpret_cast<const char*>(text), len));
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
    } else if (value.isNumber()) {
        // Match Node: always REAL. isInt32() is a tag-bit check — branching
        // on it would be representation-dependent (see bindValue()).
        sqlite3_result_double(ctx, value.asNumber());
    } else if (value.isString()) {
        auto str = value.toWTFString(globalObject);
        if (str.isNull()) {
            sqlite3_result_error(ctx, "", 0);
            return;
        }
        auto utf8 = str.utf8();
        // The *64 variants reject an over-INT_MAX length with SQLITE_TOOBIG
        // instead of narrowing it into `int` (a negative length is undefined
        // for the 32-bit bind/result API). Same in bindValue() below.
        sqlite3_result_text64(ctx, utf8.data(), utf8.length(), SQLITE_TRANSIENT, SQLITE_UTF8);
    } else if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(value)) {
        auto span = view->span();
        // sqlite3_result_blob64(nullptr, 0) sets NULL, not an empty BLOB —
        // Node binds a zero-length BLOB for a detached view (its
        // ArrayBufferViewContents falls back to non-null stack storage), so
        // hand SQLite a non-null sentinel when the vector is gone.
        sqlite3_result_blob64(ctx, span.data() ? static_cast<const void*>(span.data()) : "", span.size(), SQLITE_TRANSIENT);
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
// when the function is re-registered/removed. The JS callback is held as a
// raw pointer here and rooted by JSDatabaseSync::m_registeredCallbacks (a
// GC-traced field on the cell, see addRegisteredCallback) — NOT by a C-side
// Strong<>, so a callback closure that captures the database does not pin the
// cell forever; the db → closure → db cycle stays collectable, exactly like
// m_authorizer. The raw fn_ pointer is safe because the context is only
// invoked while a query runs on this connection (the cell is on the stack).
// xDestroy itself MUST NOT touch fn_ — with unfinalized statements the
// connection is zombified and xDestroy may run after the cell has been swept
// (see the comment on xDestroy below); superseded roots are released by
// releaseSupersededRegistration() at the registration site.
// ─────────────────────────────────────────────────────────────────────────────

struct NodeSqliteUDF {
    WTF_MAKE_TZONE_ALLOCATED_INLINE(NodeSqliteUDF);

public:
    NodeSqliteUDF(JSGlobalObject* globalObject, JSObject* fn, bool useBigIntArgs)
        : globalObject_(globalObject)
        , fn_(fn)
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

        JSValue fn = self->fn_;
        auto callData = JSC::getCallData(fn);
        JSValue result = JSC::call(globalObject, fn, callData, jsUndefined(), args);
        if (scope.exception()) [[unlikely]]
            return abortWithPending();
        jsValueToSqliteResult(globalObject, ctx, result);
        if (scope.exception()) [[unlikely]]
            return abortWithPending();
    }

    // MUST stay a plain delete: with unfinalized statements the connection is
    // zombified and this runs from the last sqlite3_finalize() — possibly
    // long after the JSDatabaseSync cell was swept — so it can't touch any
    // GC state. Superseded roots are released at the registration site
    // instead (releaseSupersededRegistration).
    static void xDestroy(void* p) { delete static_cast<NodeSqliteUDF*>(p); }

    JSGlobalObject* globalObject_;
    // Rooted by the owning JSDatabaseSync's m_registeredCallbacks; see the
    // comment above the struct.
    JSObject* fn_;
    bool useBigIntArgs_;
};

// ─────────────────────────────────────────────────────────────────────────────
// User-defined aggregate functions (DatabaseSync.prototype.aggregate)
//
// Per-invocation accumulator state lives in sqlite3_aggregate_context — a
// scratch buffer SQLite zeroes on first access and discards after xFinal. We
// store a Strong<> there so the JS accumulator value survives GC between
// xStep calls (window functions step across multiple sqlite3_step()s).
// Capturing the database in the accumulator is safe: the statement stays
// independently collectable, and finalizing it runs xFinal -> destroyState.
// Capturing the statement itself would root it through this Strong<> and
// leak, since xFinal then never fires; node has the same behavior
// (Global<Value> in sqlite3_aggregate_context, node_sqlite.cc). The
// callbacks (start/step/result/inverse) are raw pointers rooted by the
// cell's m_registeredCallbacks, same as NodeSqliteUDF above.
// ─────────────────────────────────────────────────────────────────────────────

struct NodeSqliteAggregate {
    WTF_MAKE_TZONE_ALLOCATED_INLINE(NodeSqliteAggregate);

public:
    struct State {
        JSC::Strong<JSC::Unknown> value;
        bool initialized;
        bool isWindow;
    };

    NodeSqliteAggregate(JSGlobalObject* globalObject,
        JSValue start, JSObject* step, JSObject* result, JSObject* inverse, bool useBigIntArgs)
        : globalObject_(globalObject)
        , start_(start)
        , step_(step)
        , result_(result)
        , inverse_(inverse)
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
            JSValue startV = start_;
            if (startV.isCallable()) {
                auto callData = JSC::getCallData(startV);
                MarkedArgumentBuffer noArgs;
                startV = JSC::call(globalObject_, startV, callData, jsNull(), noArgs);
                if (scope.exception()) [[unlikely]] {
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
        if (JSObject* rfn = result_) {
            MarkedArgumentBuffer args;
            args.append(state->value.get());
            auto callData = JSC::getCallData(rfn);
            result = JSC::call(globalObject_, rfn, callData, jsNull(), args);
            if (scope.exception()) [[unlikely]] {
                sqlite3_result_error(ctx, "", 0);
                if (isFinal) destroyState(ctx);
                return;
            }
        } else {
            result = state->value.get();
        }
        jsValueToSqliteResult(globalObject_, ctx, result);
        (void)scope.exception();
        if (isFinal) destroyState(ctx);
    }

    static void xStep(sqlite3_context* ctx, int argc, sqlite3_value** argv)
    {
        auto* self = static_cast<NodeSqliteAggregate*>(sqlite3_user_data(ctx));
        self->stepBase(ctx, argc, argv, self->step_);
    }
    static void xInverse(sqlite3_context* ctx, int argc, sqlite3_value** argv)
    {
        auto* self = static_cast<NodeSqliteAggregate*>(sqlite3_user_data(ctx));
        self->stepBase(ctx, argc, argv, self->inverse_);
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
    // Same constraint as NodeSqliteUDF::xDestroy — may run after the cell is
    // gone (zombified connection), so it must not touch GC state.
    static void xDestroy(void* p) { delete static_cast<NodeSqliteAggregate*>(p); }

    JSGlobalObject* globalObject_;
    // Rooted by the owning JSDatabaseSync's m_registeredCallbacks; see the
    // comment above the struct.
    JSValue start_;
    JSObject* step_;
    JSObject* result_;
    JSObject* inverse_;
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
        return jsString(vm, sqliteText(reinterpret_cast<const char*>(text), len));
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
        // Column names are user-controlled (`SELECT 1 AS "0"`); an
        // index-string key must go to indexed storage, not through
        // putDirect's named-property path (which asserts !parseIndex).
        row->putDirectMayBeIndex(globalObject, Identifier::fromString(vm, sqliteText(name)), v);
        RETURN_IF_EXCEPTION(scope, {});
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
    // ensureRowStructure() reads sqlite3_column_count() afresh; all
    // callers pass a post-step numCols, so these agree. The min()
    // is a belt-and-suspenders bound so any future caller that
    // passes a stale count can't walk past the offsets vector.
    int limit = std::min(numCols, static_cast<int>(offsets.size()));
    for (int i = 0; i < limit; ++i) {
        JSValue v = columnToJS(globalObject, scope, stmt, i, useBigInts);
        RETURN_IF_EXCEPTION(scope, {});
        int8_t off = offsets[static_cast<size_t>(i)];
        // Duplicate names map to the same offset, so a later column
        // overwrites the earlier one — last-wins, matching Node's
        // V8 Object::Set() loop and the generic rowToObject() path.
        row->putDirectOffset(vm, static_cast<PropertyOffset>(off), v);
    }
    return row;
}

static JSValue rowToArray(JSGlobalObject* globalObject, ThrowScope& scope, sqlite3_stmt* stmt, int numCols, bool useBigInts)
{
    auto& vm = getVM(globalObject);
    (void)vm;
    JSArray* row = constructEmptyArray(globalObject, nullptr, numCols);
    RETURN_IF_EXCEPTION(scope, {});
    for (int i = 0; i < numCols; ++i) {
        JSValue v = columnToJS(globalObject, scope, stmt, i, useBigInts);
        RETURN_IF_EXCEPTION(scope, {});
        row->putDirectIndex(globalObject, i, v);
        RETURN_IF_EXCEPTION(scope, {});
    }
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

JSC_DECLARE_CUSTOM_GETTER(jsDatabaseSyncIsOpen);
JSC_DECLARE_CUSTOM_GETTER(jsDatabaseSyncIsTransaction);
JSC_DECLARE_CUSTOM_GETTER(jsDatabaseSyncLimits);

void JSDatabaseSync::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    putNodeInstanceGetter(vm, this, "isOpen"_s, jsDatabaseSyncIsOpen);
    putNodeInstanceGetter(vm, this, "isTransaction"_s, jsDatabaseSyncIsTransaction);
    putNodeInstanceGetter(vm, this, "limits"_s, jsDatabaseSyncLimits);
}

// DatabaseSync handles are GC cells and the VM is not destructed on a normal
// exit, so an unclosed file-backed database would never reach
// sqlite3_close_v2(); Node closes them on environment teardown.
static WTF::Lock openDatabasesLock;
// Keyed by the owning VM, captured while the cell is provably alive: the exit
// walk filters on the stored pointer instead of dereferencing cells that
// another thread's heap may be sweeping. Entries are not GC roots.
static WTF::HashMap<JSDatabaseSync*, JSC::VM*>& openDatabases()
{
    static WTF::NeverDestroyed<WTF::HashMap<JSDatabaseSync*, JSC::VM*>> map;
    return map;
}

static void registerOpenDatabase(JSDatabaseSync* db, JSC::VM& vm)
{
    // The destructor is what removes the raw pointer again (via
    // closeInternal), so it must run before the cell's memory is reused.
    static_assert(JSDatabaseSync::needsDestruction == JSC::NeedsDestruction);
    WTF::Locker locker { openDatabasesLock };
    openDatabases().set(db, &vm);
}

static void unregisterOpenDatabase(JSDatabaseSync* db)
{
    WTF::Locker locker { openDatabasesLock };
    openDatabases().remove(db);
}

JSDatabaseSync::~JSDatabaseSync()
{
    // Reachable with a BusyScope still on the stack only when process.exit()
    // was called from inside a UDF/authorizer and the heap is destructed on
    // exit; closing the connection mid-sqlite3_step is a use-after-free.
    if (!isBusy()) {
        closeInternal();
        return;
    }
    // Pure bookkeeping: neither write calls into SQLite. dbGone stops
    // deleteSession() double-freeing the handle sqlite3_close_v2 will free
    // when the process actually exits, and the registry must not keep a
    // dangling pointer.
    for (auto& record : m_sessions)
        record->dbGone = true;
    unregisterOpenDatabase(this);
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
    if (!m_db) return;

    // A BusyScope is on the stack (re-entrant close from an option getter /
    // UDF / authorizer). From a UDF close_v2 only zombifies, but from an
    // authorizer during prepare() no Vdbe exists yet and close_v2 frees the
    // sqlite3* while sqlite3Prepare is still holding it. Mark closed now
    // (m_db == nullptr), stash the handle, and let the outermost BusyScope
    // run the teardown. UDF contexts hold raw JSObject* rooted by
    // m_registeredCallbacks, so that clear must wait too.
    if (isBusy()) {
        m_deferredClose = m_db;
        m_db = nullptr;
        return;
    }

    // Sessions must go before close_v2: the preupdate hook they install
    // keeps a back-pointer into the connection, and close_v2 does NOT
    // tear them down.
    deleteTrackedSessions();
    sqlite3_close_v2(m_db);
    m_db = nullptr;
    unregisterOpenDatabase(this);
    m_namedRegistrations.clear();
    Locker locker { cellLock() };
    m_registeredCallbacks.clear();
}

void JSDatabaseSync::finishDeferredClose()
{
    ASSERT(!isBusy());
    // open() refuses while m_deferredClose is set, so m_db is still null and
    // m_sessions / m_registeredCallbacks belong to the deferred handle.
    ASSERT(!m_db);
    sqlite3* handle = m_deferredClose;
    m_deferredClose = nullptr;
    if (!handle) return;
    deleteTrackedSessions();
    sqlite3_close_v2(handle);
    unregisterOpenDatabase(this);
    m_namedRegistrations.clear();
    Locker locker { cellLock() };
    m_registeredCallbacks.clear();
}

// Called from ExitHandler::dispatch_on_exit, on the main thread only; entries
// owned by another VM (a worker) are skipped by the stored-VM comparison
// without ever touching the foreign cell.
extern "C" void Bun__closeAllNodeSqliteDatabasesForTermination(JSC::JSGlobalObject* globalObject)
{
    JSC::VM* mainVM = &globalObject->vm();
    WTF::Vector<JSDatabaseSync*> toClose;
    {
        WTF::Locker locker { openDatabasesLock };
        for (auto& entry : openDatabases()) {
            if (entry.value == mainVM)
                toClose.append(entry.key);
        }
    }
    for (auto* db : toClose) {
        // process.exit() inside a UDF/authorizer reaches here with
        // sqlite3_step() still on the C stack; closing that connection is
        // the same use-after-free a busy close() refuses. Leave it alone.
        if (db->isBusy())
            continue;
        if (sqlite3* handle = db->connection())
            Bun__sqliteCheckpointForTermination(handle);
        // closeInternal() re-takes openDatabasesLock to unregister, so the
        // snapshot lock above must already be dropped; it also nulls m_db,
        // making a later GC destructor a no-op rather than a double close.
        db->closeInternal();
    }
}

void JSDatabaseSync::deleteTrackedSessions()
{
    for (auto& record : m_sessions) {
        // Every caller enters with m_busyDepth == 0 (deserialize() checks
        // isBusy() before taking its own BusyScope), and inUse is only set
        // inside a nested BusyScope that completes synchronously, so this
        // can never see a live changeset().
        ASSERT(!record->inUse);
        if (record->handle) {
            sqlite3session_delete(record->handle);
            record->handle = nullptr;
        }
        record->dbGone = true;
    }
    m_sessions.clear();
}

void JSDatabaseSync::sweepOrphanedSessions()
{
    // Deferred cleanup for sessions whose JS wrapper was GC'd without
    // close(): the wrapper's destructor cannot call into SQLite (it can run
    // mid-sqlite3_step), so it only flags the record. Skip while busy — a
    // UDF callback can re-enter exec()/prepare() while the connection is
    // inside sqlite3_step and the preupdate hook may be iterating sessions.
    if (m_sessions.isEmpty() || m_busyDepth > 0)
        return;
    m_sessions.removeAllMatching([](auto& record) {
        if (!record->wrapperGone)
            return false;
        if (record->handle) {
            sqlite3session_delete(record->handle);
            record->handle = nullptr;
        }
        record->dbGone = true;
        return true;
    });
}

bool JSDatabaseSync::open(JSGlobalObject* globalObject, ThrowScope& scope)
{
    // m_deferredClose: close() from inside a UDF/authorizer stashed the old
    // handle and its close_v2 runs when the outermost BusyScope unwinds.
    // Opening now would orphan that handle (a second close overwrites the
    // single slot) and put new-connection sessions into the vector
    // finishDeferredClose() is about to sweep, so refuse until it completes.
    if (m_db || m_deferredClose) {
        throwNodeState(globalObject, scope, "database is already open"_s);
        return false;
    }

#if LAZY_LOAD_SQLITE
    if (lazyLoadSQLite() < 0) [[unlikely]] {
        scope.throwException(globalObject, createError(globalObject, WTF::String::fromUTF8(dlerror())));
        return false;
    }
#endif

    // Must run before the first sqlite3_open_v2 in the process, from either
    // module; see the definition in JSSQLStatement.cpp.
    Bun__initializeSQLite();

    // SQLITE_OPEN_URI mirrors Node's `default_flags = SQLITE_OPEN_URI`
    // (node_sqlite.cc). Strings, Uint8Arrays, and URL objects all reach
    // sqlite3ParseUri verbatim (validateDatabasePath passes a URL's raw
    // href through), so a `file:…?mode=ro` / `?cache=shared` query is
    // honoured on any of those input types.
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
    // Register before the fallible configuration calls below: each of their
    // failure paths goes through closeInternal(), which unregisters.
    registerOpenDatabase(this, globalObject->vm());

#if LAZY_LOAD_SQLITE
    // Apple's system libsqlite3 defaults SQLITE_FCNTL_PERSIST_WAL on;
    // clear it so the last close() unlinks the -wal/-shm sidecars like
    // Node.js's bundled build does. Only covers the "main" schema — a later
    // ATTACH picks up Apple's default per-unixFile in unixOpen and its
    // sidecars persist; addressing that needs sqlite3_db_name at close time.
    int off = 0;
    sqlite3_file_control(m_db, nullptr, SQLITE_FCNTL_PERSIST_WAL, &off);
#endif

    int v = m_config.enableDoubleQuotedStringLiterals ? 1 : 0;
    sqlite3_db_config(m_db, SQLITE_DBCONFIG_DQS_DML, v, nullptr);
    sqlite3_db_config(m_db, SQLITE_DBCONFIG_DQS_DDL, v, nullptr);

    v = m_config.enableForeignKeyConstraints ? 1 : 0;
    if (int r = sqlite3_db_config(m_db, SQLITE_DBCONFIG_ENABLE_FKEY, v, nullptr); r != SQLITE_OK) {
        throwSqliteReturnCodeError(globalObject, scope, m_db, r);
        closeInternal();
        return false;
    }

    v = m_config.enableDefensive ? 1 : 0;
    if (int r = sqlite3_db_config(m_db, SQLITE_DBCONFIG_DEFENSIVE, v, nullptr); r != SQLITE_OK) {
        throwSqliteReturnCodeError(globalObject, scope, m_db, r);
        closeInternal();
        return false;
    }

    for (const auto& info : kLimitMapping) {
        int initial = m_config.initialLimits[static_cast<size_t>(info.id)];
        if (initial >= 0) sqlite3_limit(m_db, info.id, initial);
    }

    if (int r = sqlite3_busy_timeout(m_db, m_config.timeout); r != SQLITE_OK) {
        throwSqliteReturnCodeError(globalObject, scope, m_db, r);
        closeInternal();
        return false;
    }

    if (m_config.allowExtension) {
        if (!LAZY_SQLITE_HAS_LOAD_EXTENSION()) [[unlikely]] {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_LOAD_SQLITE_EXTENSION,
                "the loaded SQLite library was built with SQLITE_OMIT_LOAD_EXTENSION.\n"
                "note: on macOS, install a full SQLite (e.g. `brew install sqlite`) and call "
                "`require(\"bun:sqlite\").Database.setCustomSQLite(path)` before opening a database."_s);
            closeInternal();
            return false;
        }
        if (int r = sqlite3_db_config(m_db, SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, 1, nullptr); r != SQLITE_OK) {
            throwSqliteReturnCodeError(globalObject, scope, m_db, r);
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
    // visitChildren runs on a GC thread concurrently with the mutator, and
    // function()/aggregate() append to this vector — take the cell lock on
    // both sides so the iteration doesn't race a reallocation.
    Locker locker { thisObject->cellLock() };
    for (auto& callback : thisObject->m_registeredCallbacks)
        visitor.append(callback);
}
DEFINE_VISIT_CHILDREN(JSDatabaseSync);

size_t JSDatabaseSync::addRegisteredCallback(VM& vm, JSValue value)
{
    Locker locker { cellLock() };
    // Reuse a slot released by releaseSupersededRegistration() before growing
    // the vector, so re-registering the same function name doesn't accumulate
    // roots for the connection's lifetime.
    for (size_t i = 0; i < m_registeredCallbacks.size(); ++i) {
        if (m_registeredCallbacks[i].get().isEmpty()) {
            m_registeredCallbacks[i].set(vm, this, value);
            return i;
        }
    }
    m_registeredCallbacks.append(JSC::WriteBarrier<JSC::Unknown>());
    m_registeredCallbacks.last().set(vm, this, value);
    return m_registeredCallbacks.size() - 1;
}

void JSDatabaseSync::releaseSupersededRegistration(const WTF::String& name, int argc)
{
    for (size_t i = 0; i < m_namedRegistrations.size(); ++i) {
        auto& reg = m_namedRegistrations[i];
        // SQLite replaces registrations case-insensitively (ASCII), so match
        // the same way or a re-registration under different casing would
        // keep the superseded callback rooted until close().
        if (reg.argc != argc || !WTF::equalIgnoringASCIICase(reg.name, name))
            continue;
        {
            Locker locker { cellLock() };
            for (size_t slot : reg.slots) {
                if (slot != kNoCallbackSlot && slot < m_registeredCallbacks.size())
                    m_registeredCallbacks[slot].clear();
            }
        }
        m_namedRegistrations.removeAt(i);
        return;
    }
}

void JSDatabaseSync::rememberRegistration(const WTF::String& name, int argc, const std::array<size_t, 4>& slots)
{
    m_namedRegistrations.append(NamedRegistration { name, argc, slots });
}

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
    // Node allows re-entrant close(); sqlite3_close_v2 zombifies while any
    // stmt is outstanding, and option-reading paths REQUIRE_DB_OPEN again
    // before the sqlite call.
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
    JSDatabaseSync::BusyScope busy { self };
    JSValue sqlVal = callFrame->argument(0);
    if (!sqlVal.isString()) {
        return throwNodeArgType(globalObject, scope, "sql"_s, "a string"_s);
    }
    auto sql = sqlVal.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto utf8 = sql.utf8();
    // Capture before the call: a UDF/authorizer re-entering close() nulls
    // m_db (deferred close) but the handle itself stays valid until this
    // frame's BusyScope unwinds, so read the error from it.
    sqlite3* conn = self->connection();
    int r = sqlite3_exec(conn, utf8.data(), nullptr, nullptr, nullptr);
    CHECK_UDF_EXCEPTION(scope);
    if (r != SQLITE_OK) {
        throwSqliteError(globalObject, scope, conn);
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

    // Read options BEFORE prepare so error precedence matches Node
    // (bad option → ERR_INVALID_ARG_TYPE, never a SQLite error) and no
    // option-read failure needs a compensating sqlite3_finalize.
    const auto& cfg = self->config();
    bool readBigInts = cfg.readBigInts;
    bool returnArrays = cfg.returnArrays;
    bool allowBare = cfg.allowBareNamedParameters;
    bool allowUnknown = cfg.allowUnknownNamedParameters;

    JSValue optsVal = callFrame->argument(1);
    if (!optsVal.isUndefined()) {
        if (!optsVal.isObject()) {
            return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                "The \"options\" argument must be an object."_s);
        }
        JSObject* opts = optsVal.getObject();
        if (!readBoolOption(globalObject, scope, opts, "readBigInts"_s, readBigInts)) return {};
        if (!readBoolOption(globalObject, scope, opts, "returnArrays"_s, returnArrays)) return {};
        if (!readBoolOption(globalObject, scope, opts, "allowBareNamedParameters"_s, allowBare)) return {};
        if (!readBoolOption(globalObject, scope, opts, "allowUnknownNamedParameters"_s, allowUnknown)) return {};
        // An options getter above may have re-entered close(); re-check
        // before handing SQLite the connection.
        REQUIRE_DB_OPEN(self);
    }

    auto utf8 = sql.utf8();
    sqlite3_stmt* stmt = nullptr;
    // utf8.data() is NUL-terminated (CString); -1 lets SQLite compute the
    // length and avoids narrowing a size_t into int. Capture the connection
    // before the call for the error path (see jsDatabaseSyncExec).
    sqlite3* conn = self->connection();
    int r = sqlite3_prepare_v2(conn, utf8.data(), -1, &stmt, nullptr);
    // prepare() runs the authorizer callback (if any), which may
    // throw — surface that over SQLite's generic "not authorized".
    CHECK_UDF_EXCEPTION(scope);
    if (r != SQLITE_OK) {
        throwSqliteError(globalObject, scope, conn);
        return {};
    }
    // sqlite3_prepare_v2 returns SQLITE_OK with *ppStmt == nullptr for empty /
    // comment-only input — Node returns a StatementSync whose accessors throw
    // ERR_INVALID_STATE "statement has been finalized" via REQUIRE_STMT.

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
    return JSValue::encode(jsString(vm, sqliteText(filename)));
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
        return throwNodeState(globalObject, scope,
            "Cannot enable extension loading because it was disabled at database creation."_s);
    }
    // Apple's OMIT_LOAD_EXTENSION build rejects this db_config op; silently
    // succeed for `false` (extensions were never enabled) — `true` is caught
    // by the allowExtension constructor gate above.
    if (LAZY_SQLITE_HAS_LOAD_EXTENSION()) {
        int r = sqlite3_db_config(self->connection(), SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION, allow ? 1 : 0, nullptr);
        if (r != SQLITE_OK) {
            throwSqliteReturnCodeError(globalObject, scope, self->connection(), r);
            return {};
        }
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
        WTF::String message = errmsg ? sqliteText(errmsg) : WTF::String::fromUTF8(sqlite3_errstr(r));
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

    bool useBigIntArgs = false;
    bool varargs = false;
    bool deterministic = false;
    bool directOnly = false;
    // Node validates on arity: with three arguments the middle one MUST be an
    // object, so `function(name, undefined, fn)` throws.
    if (fnIndex == 2) {
        JSValue optsVal = callFrame->uncheckedArgument(1);
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

    // An options getter above may have re-entered close(); re-check before
    // handing SQLite the connection (Node segfaults here — Bun throws).
    REQUIRE_DB_OPEN(self);
    auto* udf = new NodeSqliteUDF(globalObject, fn, useBigIntArgs);
    auto nameUtf8 = name.utf8();
    int r = sqlite3_create_function_v2(self->connection(), nameUtf8.data(), argc, textRep,
        udf, NodeSqliteUDF::xFunc, nullptr, nullptr, NodeSqliteUDF::xDestroy);
    if (r != SQLITE_OK) {
        // SQLite owns udf once xDestroy is passed in — it invokes xDestroy
        // on the failure path too (name too long / nArg out of range /
        // SQLITE_BUSY), so a manual delete here would double-free.
        throwSqliteReturnCodeError(globalObject, scope, self->connection(), r);
        return {};
    }
    // SQLite has dropped any previous (name, argc) registration, so release
    // its roots, then root the new callback on the cell — the raw pointer in
    // the UDF context stays valid for the registration's lifetime without
    // pinning the cell.
    self->releaseSupersededRegistration(name, argc);
    std::array<size_t, 4> slots { JSDatabaseSync::kNoCallbackSlot, JSDatabaseSync::kNoCallbackSlot, JSDatabaseSync::kNoCallbackSlot, JSDatabaseSync::kNoCallbackSlot };
    slots[0] = self->addRegisteredCallback(vm, fn);
    self->rememberRegistration(name, argc, slots);
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

    // An options getter above may have re-entered close().
    REQUIRE_DB_OPEN(self);
    auto* agg = new NodeSqliteAggregate(globalObject, startV, stepFn, resultFn, inverseFn, useBigIntArgs);
    auto nameUtf8 = name.utf8();
    auto xInverse = inverseFn ? NodeSqliteAggregate::xInverse : nullptr;
    auto xValue = inverseFn ? NodeSqliteAggregate::xValue : nullptr;
    int r = sqlite3_create_window_function(self->connection(), nameUtf8.data(), argc, textRep, agg,
        NodeSqliteAggregate::xStep, NodeSqliteAggregate::xFinal, xValue, xInverse, NodeSqliteAggregate::xDestroy);
    if (r != SQLITE_OK) {
        // SQLite already invoked xDestroy(agg) on the failure path.
        throwSqliteReturnCodeError(globalObject, scope, self->connection(), r);
        return {};
    }
    // SQLite has dropped any previous (name, argc) registration, so release
    // its roots, then root every value the aggregate context references; the
    // context itself only holds raw pointers (see NodeSqliteUDF comment).
    self->releaseSupersededRegistration(name, argc);
    std::array<size_t, 4> slots { JSDatabaseSync::kNoCallbackSlot, JSDatabaseSync::kNoCallbackSlot, JSDatabaseSync::kNoCallbackSlot, JSDatabaseSync::kNoCallbackSlot };
    slots[0] = self->addRegisteredCallback(vm, startV);
    slots[1] = self->addRegisteredCallback(vm, stepFn);
    if (resultFn) slots[2] = self->addRegisteredCallback(vm, resultFn);
    if (inverseFn) slots[3] = self->addRegisteredCallback(vm, inverseFn);
    self->rememberRegistration(name, argc, slots);
    return JSValue::encode(jsUndefined());
}

static EncodedJSValue throwSessionUnavailable(JSGlobalObject* globalObject, ThrowScope& scope)
{
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_SQLITE_ERROR,
        "the loaded SQLite library was built without SQLITE_ENABLE_SESSION.\n"
        "note: on macOS, install a full SQLite (e.g. `brew install sqlite`) and call "
        "`require(\"bun:sqlite\").Database.setCustomSQLite(path)` before opening a database."_s);
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncCreateSession, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    if (!lazy_sqlite3_has_session) [[unlikely]]
        return throwSessionUnavailable(globalObject, scope);
    JSDatabaseSync::BusyScope busy { self };

    WTF::String table;
    WTF::String dbName = "main"_s;
    // Node validates on args.Length() > 0: an explicit `createSession(undefined)`
    // throws while `createSession()` does not.
    if (callFrame->argumentCount() > 0) {
        JSValue optsVal = callFrame->uncheckedArgument(0);
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

    // An options getter above may have re-entered close().
    REQUIRE_DB_OPEN(self);
    auto dbNameUtf8 = dbName.utf8();
    sqlite3_session* pSession = nullptr;
    int r = sqlite3session_create(self->connection(), dbNameUtf8.data(), &pSession);
    if (r != SQLITE_OK) {
        throwSqliteReturnCodeError(globalObject, scope, self->connection(), r);
        return {};
    }
    auto tableUtf8 = table.utf8();
    r = sqlite3session_attach(pSession, table.isEmpty() ? nullptr : tableUtf8.data());
    if (r != SQLITE_OK) {
        sqlite3session_delete(pSession);
        throwSqliteReturnCodeError(globalObject, scope, self->connection(), r);
        return {};
    }

    auto record = adoptRef(*new NodeSqliteSessionRecord);
    record->handle = pSession;
    self->trackSession(record.copyRef());
    auto* zigGlobal = defaultGlobalObject(globalObject);
    auto* structure = zigGlobal->m_JSNodeSqliteSessionClassStructure.get(zigGlobal);
    auto* session = JSNodeSqliteSession::create(vm, structure, self, WTF::move(record));
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
    args.append(jsString(vm, sqliteText(zTab)));
    auto callData = JSC::getCallData(ctx->filter);
    JSValue ret = JSC::call(globalObject, ctx->filter, callData, jsNull(), args);
    if (scope.exception()) [[unlikely]] {
        return 0;
    }
    bool keep = ret.toBoolean(globalObject);
    return keep ? 1 : 0;
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncApplyChangeset, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    if (!lazy_sqlite3_has_session) [[unlikely]]
        return throwSessionUnavailable(globalObject, scope);
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

    // The option getters above can run user JS; if one of them detached the
    // input, span() below would be {nullptr, 0} and the call would "apply"
    // an empty changeset and report success — reject instead (same guard as
    // deserialize()). A genuinely empty changeset (no recorded changes) is
    // still accepted.
    if (buf->isDetached()) {
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE,
            "The \"changeset\" argument must not be detached."_s);
    }

    // sqlite3changeset_apply stores pChangeset (no copy) and streams from
    // it between xFilter/xConflict invocations. Those callbacks re-enter
    // JS, which could detach `buf` (e.g. `changeset.buffer.transfer()`)
    // and let GC free the backing store while SQLite is still reading
    // from it. Copy into an owned buffer so the lifetime is tied to this
    // stack frame regardless of what JS does. Changesets are typically
    // small, so the copy is cheap relative to the safety it buys.
    auto span = buf->span();
    // sqlite3changeset_apply takes an `int` length and has no 64-bit
    // variant; reject anything that would not survive the narrowing
    // instead of letting it wrap to a small or negative count.
    if (span.size() > static_cast<size_t>(std::numeric_limits<int>::max())) {
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_OUT_OF_RANGE,
            "The \"changeset\" argument is too large for SQLite."_s);
    }
    WTF::Vector<uint8_t> owned;
    if (!owned.tryAppend(span)) {
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_MEMORY_ALLOCATION_FAILED,
            "Failed to allocate memory for changeset"_s);
    }
    // sqlite3changeset_apply declares pChangeset as `void*` (non-const)
    // for historical reasons; the buffer is not written to. An options
    // getter above may have re-entered close(); re-check first.
    REQUIRE_DB_OPEN(self);
    int r = sqlite3changeset_apply(self->connection(),
        static_cast<int>(owned.size()), owned.mutableSpan().data(),
        applyChangesetXFilter, applyChangesetXConflict, &ctx);
    CHECK_UDF_EXCEPTION(scope);
    if (r == SQLITE_ABORT) {
        // Conflict handler returned ABORT — Node.js surfaces this as
        // `false` rather than throwing.
        return JSValue::encode(jsBoolean(false));
    }
    if (r != SQLITE_OK) {
        // An invalid conflict-handler return is SQLITE_MISUSE and a malformed
        // changeset is SQLITE_CORRUPT; the vendored tests assert both exactly.
        throwSqliteReturnCodeError(globalObject, scope, self->connection(), r);
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
        throwSqliteReturnCodeError(globalObject, scope, self->connection(), r);
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
// exception (or a non-integer / out-of-range return) becomes SQLITE_DENY;
// the pending exception on the VM is what the outer host function's
// CHECK_UDF_EXCEPTION observes to surface it over "not authorized".
static int nodeSqliteAuthorizerCallback(void* userData, int actionCode, const char* p1, const char* p2, const char* p3, const char* p4)
{
    auto* db = static_cast<JSDatabaseSync*>(userData);
    auto* globalObject = db->globalObject();
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    // sqlite3WalkExprNN maps WRC_Prune to continue for sibling columns in
    // one expression (SELECT a + b), so a throw on `a` re-fires the
    // authorizer for `b` with the exception still pending — same guard as
    // xFunc / applyChangesetXConflict.
    if (scope.exception()) [[unlikely]]
        return SQLITE_DENY;

    auto* fn = db->m_authorizer.get();
    if (!fn) [[unlikely]]
        return SQLITE_OK;

    auto toJS = [&](const char* s) -> JSValue {
        return s ? jsString(vm, sqliteText(s)) : jsNull();
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
        throwSqliteReturnCodeError(globalObject, scope, self->connection(), r);
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
    // Capture before the call: the authorizer fires from inside
    // sqlite3_serialize's internal PRAGMA prepare and may re-enter close()
    // (deferred, nulls m_db); read the error from the captured handle.
    sqlite3* conn = self->connection();
    unsigned char* data = sqlite3_serialize(conn, dbNameUtf8.data(), &size, 0);
    // For non-memdb schemas (regular :memory: or file-backed)
    // sqlite3_serialize internally prepares `PRAGMA "<s>".page_count`,
    // which fires the authorizer with SQLITE_PRAGMA. Surface a thrown
    // JS exception over SQLite's "not authorized" — same as
    // exec()/prepare()/deserialize()/TagStore. On this path `data` is
    // already null (no cleanup needed).
    if (scope.exception()) [[unlikely]] {
        if (data) sqlite3_free(data);
        return {};
    }
    // sqlite3_serialize returns null with size==0 for a brand-new empty
    // schema whose database file hasn't been materialised yet (e.g.
    // serialising an ATTACHed :memory: schema that has had no DDL) — Node
    // treats that as an empty Uint8Array; null with size!=0 is a real
    // failure on the connection.
    if (data == nullptr && size != 0) {
        throwSqliteError(globalObject, scope, conn);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(adoptSqliteBuffer(globalObject, data, static_cast<size_t>(size))));
}

JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncDeserialize, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_DATABASE();
    REQUIRE_DB_OPEN(self);
    // deserialize() tears down every prepared statement on the connection
    // (they all refer to schema that's about to be replaced), so refuse
    // while anything is mid-execution.
    if (self->isBusy()) {
        return throwNodeState(globalObject, scope, "cannot deserialize database while a statement is executing"_s);
    }
    JSDatabaseSync::BusyScope busy { self };

    auto* buf = dynamicDowncast<JSC::JSUint8Array>(callFrame->argument(0));
    if (!buf) {
        return throwNodeArgType(globalObject, scope, "buffer"_s, "a Uint8Array"_s);
    }
    if (buf->span().size() == 0) {
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

    // The opts.dbName [[Get]] above may have re-entered close(); re-check
    // before handing SQLite the connection (Node segfaults here).
    REQUIRE_DB_OPEN(self);

    // SQLITE_DESERIALIZE_FREEONCLOSE hands ownership of the buffer to
    // SQLite (freed on close) — it must therefore come from
    // sqlite3_malloc64. Copy the input in case JS later mutates or
    // detaches it; also required for the zombie-statement case where
    // the connection outlives this call.
    //
    // Capture the span only AFTER the opts.dbName [[Get]] above —
    // a hostile getter can buf.buffer.transfer() + GC, freeing the
    // backing store that an earlier span would still point into
    // (same buffer-detach UAF class applyChangeset guards against
    // by copying before its callbacks). A post-detach span() is
    // {nullptr, 0}, which the emptiness re-check catches.
    auto span = buf->span();
    if (buf->isDetached() || span.size() == 0) {
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE,
            "The \"buffer\" argument must not be empty."_s);
    }
    unsigned char* owned = static_cast<unsigned char*>(sqlite3_malloc64(span.size()));
    if (!owned) {
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_MEMORY_ALLOCATION_FAILED,
            "Failed to allocate memory for SQLite deserialize"_s);
    }
    memcpy(owned, span.data(), span.size());

    // Invalidate every existing statement first — after the schema
    // swap they reference tables that no longer exist. Node
    // sqlite3_finalize()s its tracked statements here; we can't
    // (the JS wrappers still own those handles and finalize on GC, so
    // a pre-emptive finalize would double-free), but an un-reset
    // iterate() cursor holds a read transaction that makes
    // sqlite3_deserialize()'s internal ATTACH return SQLITE_BUSY.
    // Reset every outstanding stmt on the connection so the swap
    // succeeds, then bump the open-generation so every JSStatementSync
    // reports isFinalized() (same mechanism close()+open() uses). The
    // bump stays ahead of the fallible call to match Node, which
    // finalizes unconditionally before deserializing.
    for (sqlite3_stmt* s = sqlite3_next_stmt(self->connection(), nullptr); s;
        s = sqlite3_next_stmt(self->connection(), s)) {
        sqlite3_reset(s);
    }
    self->bumpOpenGeneration();

    int r = sqlite3_deserialize(self->connection(), dbNameUtf8.data(), owned,
        static_cast<sqlite3_int64>(span.size()), static_cast<sqlite3_int64>(span.size()),
        SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE);
    // sqlite3_deserialize internally runs `ATTACH x AS <schema>` via
    // sqlite3_prepare_v2, which fires the authorizer callback with
    // SQLITE_ATTACH. If that throws, surface the user's exception over
    // SQLite's "not authorized" — same as exec()/prepare()/TagStore.
    CHECK_UDF_EXCEPTION(scope);
    if (r != SQLITE_OK) {
        // SQLite already freed `owned` (or took ownership) on both
        // success and failure paths once FREEONCLOSE is set. The
        // connection itself is unchanged on failure, so existing
        // sessions stay valid (Node doesn't touch them here either).
        throwSqliteReturnCodeError(globalObject, scope, self->connection(), r);
        return {};
    }
    // The schema swap succeeded. Node leaves sessions attached here, but
    // their preupdate hook would keep recording writes against the new
    // database content until close() — free them like closeInternal()
    // does; the wrappers observe dbGone through the shared record.
    self->deleteTrackedSessions();
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
    auto rejectNul = [&](const WTF::String& s) -> bool {
        if (s.find('\0') == WTF::notFound) return true;
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
            "The \"path\" argument must be a string, Uint8Array, or URL without null bytes."_s);
        return false;
    };
    if (pathVal.isString()) {
        out = pathVal.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        return rejectNul(out);
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
        return rejectNul(out);
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
            return rejectNul(out);
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

    DatabaseSyncOpenConfiguration config {};
    bool openImmediately = true;

    // Node validates on args.Length() > 1, not IsUndefined(): an explicit
    // second argument must be an object (so `new DatabaseSync(p, undefined)`
    // throws while `new DatabaseSync(p)` does not).
    if (callFrame->argumentCount() > 1) {
        JSValue optsVal = callFrame->uncheckedArgument(1);
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

    Structure* structure = zigGlobal->m_JSDatabaseSyncClassStructure.get(zigGlobal);
    JSValue newTarget = callFrame->newTarget();
    if (zigGlobal->m_JSDatabaseSyncClassStructure.constructor(zigGlobal) != newTarget) [[unlikely]] {
        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(), functionGlobalObject->m_JSDatabaseSyncClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }
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

JSC_DECLARE_CUSTOM_GETTER(jsStatementSyncSourceSQL);
JSC_DECLARE_CUSTOM_GETTER(jsStatementSyncExpandedSQL);

void JSStatementSync::finishCreation(VM& vm, JSDatabaseSync* db, sqlite3_stmt* stmt)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    putNodeInstanceGetter(vm, this, "sourceSQL"_s, jsStatementSyncSourceSQL);
    putNodeInstanceGetter(vm, this, "expandedSQL"_s, jsStatementSyncExpandedSQL);
    m_stmt = stmt;
    m_originGeneration = db->openGeneration();
    m_database.set(vm, this, db);
    m_extraMemorySize = stmt ? static_cast<size_t>(sqlite3_stmt_status(stmt, SQLITE_STMTSTATUS_MEMUSED, 0)) : 0;
    if (m_extraMemorySize)
        vm.heap.reportExtraMemoryAllocated(this, m_extraMemorySize);
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
    // A live SteppingScope here means process.exit() from inside a
    // UDF/aggregate under BUN_DESTRUCT_VM_ON_EXIT=1. sqlite3_finalize on a
    // running VDBE fires xFinal, which JSC::call()s raw pointers into a heap
    // that lastChanceToFinalize is sweeping — same skip as ~JSDatabaseSync.
    if (isStepping())
        return;
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
    visitor.reportExtraMemoryVisited(thisObject->m_extraMemorySize);
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
// callers fall back to the generic rowToObject() in that case.
//
// The cache is keyed on m_resetGeneration rather than just the
// column count. sqlite3_prepare_v2 transparently re-prepares on
// SQLITE_SCHEMA, so after `ALTER TABLE … RENAME COLUMN` the same
// statement can return the *same* column count with *different*
// names — a count-only key would serve a stale {oldName: value}
// structure forever (bun:sqlite defends the same technique with a
// per-db write-version; keying on reset-generation gives the same
// correctness for the simpler cost of rebuilding once per
// run/get/all/iterate rather than once per schema change). Within
// a single .all() / .iterate() the generation is constant, so the
// hot loop still hits the cache for every row after the first.
Structure* JSStatementSync::ensureRowStructure(JSGlobalObject* globalObject)
{
    auto& vm = getVM(globalObject);
    int count = sqlite3_column_count(m_stmt);
    if (m_rowResetGeneration == m_resetGeneration && m_rowColumnCount == count && m_rowStructure) {
        return m_rowStructure.get();
    }
    invalidateRowStructure();
    m_rowColumnCount = count;
    m_rowResetGeneration = m_resetGeneration;
    if (count <= 0 || static_cast<unsigned>(count) > JSFinalObject::maxInlineCapacity) {
        return nullptr;
    }

    // First pass: collect distinct names in column order. A join can
    // produce duplicate column names; Node's row builder iterates
    // columns and calls V8 Object::Set()/CreateDataProperty() for each,
    // which *overwrites* on a duplicate key — so the last occurrence
    // wins. Mirror that by giving a duplicate column the same slot
    // offset as the first occurrence; rowToObjectCached() writes
    // columns in order, so the later putDirectOffset overwrites the
    // earlier one just as the generic rowToObject()'s putDirect would.
    m_columnOffsets.reserveCapacity(static_cast<size_t>(count));
    WTF::Vector<Identifier, JSFinalObject::maxInlineCapacity> names;
    for (int i = 0; i < count; ++i) {
        const char* name = sqlite3_column_name(m_stmt, i);
        if (!name || name[0] == '\0') {
            // Pathological — give up on the fast path for this stmt.
            m_columnOffsets.clear();
            return nullptr;
        }
        auto id = Identifier::fromString(vm, sqliteText(name));
        // Structure::addPropertyTransition asserts !parseIndex() —
        // a column aliased to "0", "1", … must go through indexed
        // storage instead. Bail to the generic path, which handles
        // it via putDirectMayBeIndex().
        if (parseIndex(id)) {
            m_columnOffsets.clear();
            return nullptr;
        }
        int8_t off = -1;
        for (size_t j = 0; j < names.size(); ++j) {
            if (names[j] == id) {
                off = static_cast<int8_t>(j);
                break;
            }
        }
        if (off < 0) {
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
        // Match Node: always bind_double, no IsInt32 fast path. Branching on
        // JSC's isInt32() (a tag-bit check) would be representation-dependent:
        // literal 42 vs Float64Array[0]=42 would get different storage classes.
        r = sqlite3_bind_double(m_stmt, index, value.asNumber());
    } else if (value.isString()) {
        auto str = value.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        auto utf8 = str.utf8();
        // *64: see jsValueToSqliteResult().
        r = sqlite3_bind_text64(m_stmt, index, utf8.data(), utf8.length(), SQLITE_TRANSIENT, SQLITE_UTF8);
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
        // sqlite3_bind_blob64(nullptr, 0) leaves the parameter as NULL (see
        // sqlite3.c:bindText's `if(zData!=0)` guard). A detached view's
        // span() is {nullptr, 0}; Node binds it as a zero-length BLOB (its
        // ArrayBufferViewContents falls back to non-null stack storage), so
        // hand SQLite a non-null sentinel when the vector is gone.
        r = sqlite3_bind_blob64(m_stmt, index, span.data() ? static_cast<const void*>(span.data()) : "", span.size(), SQLITE_TRANSIENT);
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

    // Named parameters: Node treats any non-ArrayBufferView object in the
    // first slot as a named-params bag (V8's IsObject() && !IsArrayBufferView()).
    // Arrays are NOT special-cased — Node walks their own-enumerable keys
    // ("0", "1", …) through the named-param path.
    if (argc > 0) {
        JSValue arg0 = callFrame->argument(0);
        if (arg0.isObject() && !dynamicDowncast<JSArrayBufferView>(arg0)) {
            JSObject* named = arg0.getObject();
            if (m_allowBareNamedParams && !m_bareNamedParams.has_value()) {
                // Build into a local first so a mid-loop failure (conflicting
                // prefixes for the same bare name) doesn't leave a partially
                // populated map cached on the statement.
                WTF::HashMap<WTF::String, WTF::String> bare;
                for (int i = 1; i <= paramCount; ++i) {
                    const char* full = sqlite3_bind_parameter_name(m_stmt, i);
                    if (full == nullptr || full[0] == '\0') continue;
                    WTF::String fullStr = sqliteText(full);
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
                // The getter may have re-entered close(); Node finalizes stmts
                // there and throws ERR_SQLITE_ERROR (errcode 7 via
                // sqlite3_errmsg(NULL)) — match that path.
                if (isFinalized()) [[unlikely]] {
                    throwSqliteError(globalObject, scope, connection());
                    return false;
                }
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

// ─── Post-bind step drivers ─────────────────────────────────────────────────
// Shared by jsStatementSync{Run,Get,All} and jsTagStore{Run,Get,All}. Callers
// have already reset/bound the statement and hold a BusyScope; these own the
// StatementResetter and the step loop so both entry points behave identically.

static EncodedJSValue statementStepRun(VM& vm, JSGlobalObject* globalObject, ThrowScope& scope, JSStatementSync* self)
{
    StatementResetter resetter { self->statement() };
    JSStatementSync::SteppingScope stepping { self };
    int r = sqlite3_step(self->statement());
    while (r == SQLITE_ROW)
        r = sqlite3_step(self->statement());
    CHECK_UDF_EXCEPTION(scope);
    // Don't go through self->connection(): a named-parameter getter or UDF
    // callback may have called db.close() since the caller's liveness
    // check, in which case the wrapper's m_db is now null (deferred close)
    // and sqlite3_changes64(NULL) is a raw db->nChange deref — and on the
    // error path sqlite3_errmsg(NULL) reports "out of memory" instead of
    // the real message. sqlite3_db_handle reads the statement's own
    // back-pointer, which survives until the BusyScope unwinds and is what
    // Node's StatementSync::Run uses.
    sqlite3* db = sqlite3_db_handle(self->statement());
    if (r != SQLITE_DONE && r != SQLITE_OK) {
        throwSqliteError(globalObject, scope, db);
        return {};
    }
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

static EncodedJSValue statementStepGet(JSGlobalObject* globalObject, ThrowScope& scope, JSStatementSync* self)
{
    StatementResetter resetter { self->statement() };
    JSStatementSync::SteppingScope stepping { self };
    int r = sqlite3_step(self->statement());
    CHECK_UDF_EXCEPTION(scope);
    if (r == SQLITE_DONE) return JSValue::encode(jsUndefined());
    if (r != SQLITE_ROW) {
        throwSqliteError(globalObject, scope, sqlite3_db_handle(self->statement()));
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

static EncodedJSValue statementStepAll(JSGlobalObject* globalObject, ThrowScope& scope, JSStatementSync* self)
{
    StatementResetter resetter { self->statement() };
    JSStatementSync::SteppingScope stepping { self };
    JSArray* rows = constructEmptyArray(globalObject, nullptr, 0);
    RETURN_IF_EXCEPTION(scope, {});
    int r;
    while ((r = sqlite3_step(self->statement())) == SQLITE_ROW) {
        // Read the column count AFTER step(): sqlite3_prepare_v2's
        // transparent SQLITE_SCHEMA re-prepare (e.g. SELECT * after
        // ALTER TABLE … DROP COLUMN) can change it on the first step,
        // and ensureRowStructure() rebuilds m_columnOffsets with the
        // fresh count — a stale numCols would index that Vector
        // out-of-bounds and putDirectOffset() into a bogus slot.
        int numCols = sqlite3_column_count(self->statement());
        JSValue row = self->returnArrays()
            ? rowToArray(globalObject, scope, self->statement(), numCols, self->useBigInts())
            : rowToObjectCached(globalObject, scope, self, numCols, self->useBigInts());
        RETURN_IF_EXCEPTION(scope, {});
        rows->push(globalObject, row);
        RETURN_IF_EXCEPTION(scope, {});
    }
    CHECK_UDF_EXCEPTION(scope);
    if (r != SQLITE_DONE) {
        throwSqliteError(globalObject, scope, sqlite3_db_handle(self->statement()));
        return {};
    }
    return JSValue::encode(rows);
}

JSC_DEFINE_HOST_FUNCTION(jsStatementSyncRun, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_STATEMENT();
    REQUIRE_STMT(self);
    REQUIRE_STMT_IDLE(self);
    BUSY_SCOPE_STMT(self);
    sqlite3_reset(self->statement());
    self->bumpResetGeneration();
    if (!self->bindParams(globalObject, scope, callFrame)) return {};
    RELEASE_AND_RETURN(scope, statementStepRun(vm, globalObject, scope, self));
}

JSC_DEFINE_HOST_FUNCTION(jsStatementSyncGet, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_STATEMENT();
    REQUIRE_STMT(self);
    REQUIRE_STMT_IDLE(self);
    BUSY_SCOPE_STMT(self);
    sqlite3_reset(self->statement());
    self->bumpResetGeneration();
    if (!self->bindParams(globalObject, scope, callFrame)) return {};
    RELEASE_AND_RETURN(scope, statementStepGet(globalObject, scope, self));
}

JSC_DEFINE_HOST_FUNCTION(jsStatementSyncAll, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_STATEMENT();
    REQUIRE_STMT(self);
    REQUIRE_STMT_IDLE(self);
    BUSY_SCOPE_STMT(self);
    sqlite3_reset(self->statement());
    self->bumpResetGeneration();
    if (!self->bindParams(globalObject, scope, callFrame)) return {};
    RELEASE_AND_RETURN(scope, statementStepAll(globalObject, scope, self));
}

JSC_DEFINE_HOST_FUNCTION(jsStatementSyncIterate, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_STATEMENT();
    REQUIRE_STMT(self);
    REQUIRE_STMT_IDLE(self);
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
            col->putDirect(vm, Identifier::fromString(vm, key), val ? jsString(vm, sqliteText(val)) : jsNull(), 0);
        };
        // On the dlopen path these are stubbed to return nullptr when the
        // loaded library was built without SQLITE_ENABLE_COLUMN_METADATA.
        putStr("column"_s, sqlite3_column_origin_name(self->statement(), i));
        putStr("database"_s, sqlite3_column_database_name(self->statement(), i));
        putStr("name"_s, sqlite3_column_name(self->statement(), i));
        putStr("table"_s, sqlite3_column_table_name(self->statement(), i));
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
    return JSValue::encode(jsString(vm, sqliteText(sql ? sql : "")));
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
    JSValue result = jsString(vm, sqliteText(expanded));
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
    if (stmt->isStepping()) [[unlikely]] {
        return throwNodeState(globalObject, scope, "statement is currently executing"_s);
    }
    JSDatabaseSync::BusyScope busy { stmt->database() };
    JSStatementSync::SteppingScope stepping { stmt };

    int r = sqlite3_step(stmt->statement());
    if (r != SQLITE_ROW && r != SQLITE_DONE) {
        // Deliberate divergence from Node v26.3.0: Node neither resets nor
        // marks the iterator done on a failed step, so catching the error and
        // calling next() again silently re-yields from row 1 (SQLite
        // auto-resets a halted statement). Treat a failed step as exhausting
        // the iterator instead.
        sqlite3_reset(stmt->statement());
        self->setDone();
        CHECK_UDF_EXCEPTION(scope);
        throwSqliteError(globalObject, scope, sqlite3_db_handle(stmt->statement()));
        return {};
    }
    CHECK_UDF_EXCEPTION(scope);
    if (r == SQLITE_ROW) {
        int numCols = sqlite3_column_count(stmt->statement());
        JSValue row = stmt->returnArrays()
            ? rowToArray(globalObject, scope, stmt->statement(), numCols, stmt->useBigInts())
            : rowToObjectCached(globalObject, scope, stmt, numCols, stmt->useBigInts());
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(createIterResult(vm, globalObject, false, row));
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
    // Deliberate divergence: Node v26.3.0 throws ERR_INVALID_STATE on a
    // finalized statement here; we treat it as a no-op so IteratorClose
    // after db.close() doesn't surface a spurious error (matches this
    // module's own [Symbol.dispose]() convention).
    JSStatementSync* stmt = self->statement();
    // Only reset the statement if this iterator still owns it: when a later
    // iterate()/run()/get()/all() bumped the reset generation, the statement
    // was already reset and may be mid-iteration under a newer iterator —
    // resetting again would silently rewind that iterator's cursor.
    // (Deliberate divergence: Node v26.3.0 resets unconditionally here.)
    // isStepping() — this iterator's own sqlite3_step is on the C stack (a
    // UDF re-entered return()); sqlite3_reset on a running VDBE is misuse.
    if (!self->done() && stmt && !stmt->isFinalized() && !stmt->isStepping()
        && self->capturedGeneration() == stmt->resetGeneration()) {
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

JSNodeSqliteSession* JSNodeSqliteSession::create(VM& vm, Structure* structure, JSDatabaseSync* db, Ref<NodeSqliteSessionRecord>&& record)
{
    auto* ptr = new (NotNull, allocateCell<JSNodeSqliteSession>(vm)) JSNodeSqliteSession(vm, structure);
    ptr->finishCreation(vm, db, WTF::move(record));
    return ptr;
}

void JSNodeSqliteSession::finishCreation(VM& vm, JSDatabaseSync* db, Ref<NodeSqliteSessionRecord>&& record)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_record = WTF::move(record);
    m_database.set(vm, this, db);
}

bool JSNodeSqliteSession::isStale() const
{
    // The database frees every tracked session handle out from under the
    // wrappers when it closes, is torn down, or successfully deserialize()s
    // a new database — all of those mark the shared record dbGone.
    auto* db = m_database.get();
    return db == nullptr || !db->isOpen() || !m_record || m_record->dbGone;
}

void JSNodeSqliteSession::deleteSession()
{
    if (!m_record || m_record->handle == nullptr) return;
    // A changeset()/patchset() is on the C stack for this handle;
    // sqlite3session_delete would free it under sessionGenerateChangeset().
    // close() throws ERR_INVALID_STATE for this; Symbol.dispose no-ops.
    if (m_record->inUse) return;
    if (!m_record->dbGone) {
        auto* db = m_database.get();
        db->untrackSession(m_record.get());
        sqlite3session_delete(m_record->handle);
    }
    // If dbGone, the database already freed the handle — don't double-free.
    m_record->handle = nullptr;
}

JSNodeSqliteSession::~JSNodeSqliteSession()
{
    // GC sweep. Never call into SQLite from here — the sweep can run inside
    // an allocation made by a UDF callback while sqlite3_step() is executing
    // on this very connection — and never follow m_database, because the
    // sweep order between the two cells is undefined. Only write to the
    // refcounted record; sweepOrphanedSessions() picks up the flag on the
    // database's next entry point (or close()/teardown does).
    if (auto record = std::exchange(m_record, nullptr))
        record->wrapperGone = true;
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

static EncodedJSValue sessionChangesetCommon(JSGlobalObject* globalObject, CallFrame* callFrame,
    int (*fn)(sqlite3_session*, int*, void**))
{
    THIS_SESSION();
    JSDatabaseSync* db = self->database();
    if (self->isStale()) {
        return throwNodeState(globalObject, scope, "database is not open"_s);
    }
    auto* record = self->record();
    if (!record || record->handle == nullptr) {
        return throwNodeState(globalObject, scope, "session is not open"_s);
    }
    if (record->inUse) {
        return throwNodeState(globalObject, scope, "session is already generating a changeset"_s);
    }
    // sqlite3session_changeset/patchset internally run SAVEPOINT + prepared
    // SELECTs on the connection, which fires the authorizer. BusyScope
    // defers db.close() (and so deleteTrackedSessions/sweepOrphanedSessions)
    // until this frame unwinds; inUse refuses session.close()/Symbol.dispose
    // so the handle isn't freed under sessionGenerateChangeset().
    JSDatabaseSync::BusyScope busy { db };
    record->inUse = true;
    sqlite3* conn = db->connection();
    int nChangeset = 0;
    void* pChangeset = nullptr;
    int r = fn(record->handle, &nChangeset, &pChangeset);
    record->inUse = false;
    // sessionGenerateChangeset transfers the buffer to *ppChangeset before its
    // trailing RELEASE (whose result is discarded) reaches the authorizer, so
    // an exception there returns SQLITE_OK with an owned buffer — free it here
    // (mirrors jsDatabaseSyncSerialize).
    if (scope.exception()) [[unlikely]] {
        if (pChangeset) sqlite3_free(pChangeset);
        return {};
    }
    if (r != SQLITE_OK) {
        if (pChangeset) sqlite3_free(pChangeset);
        throwSqliteReturnCodeError(globalObject, scope, conn, r);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(adoptSqliteBuffer(globalObject, pChangeset, static_cast<size_t>(nChangeset))));
}

JSC_DEFINE_HOST_FUNCTION(jsSessionChangeset, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return sessionChangesetCommon(globalObject, callFrame, sqlite3session_changeset);
}

JSC_DEFINE_HOST_FUNCTION(jsSessionPatchset, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return sessionChangesetCommon(globalObject, callFrame, sqlite3session_patchset);
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
    if (self->record()->inUse) {
        return throwNodeState(globalObject, scope, "session is currently generating a changeset"_s);
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
}

const ClassInfo JSNodeSqliteSessionConstructor::s_info = { "Session"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSqliteSessionConstructor) };

JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSNodeSqliteSessionConstructor::call(JSGlobalObject* globalObject, CallFrame*)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Illegal constructor"_s);
}

JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSNodeSqliteSessionConstructor::construct(JSGlobalObject* globalObject, CallFrame*)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Illegal constructor"_s);
}

JSNodeSqliteSessionConstructor* JSNodeSqliteSessionConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* prototype)
{
    auto* ptr = new (NotNull, allocateCell<JSNodeSqliteSessionConstructor>(vm)) JSNodeSqliteSessionConstructor(vm, structure);
    ptr->finishCreation(vm, globalObject, prototype);
    return ptr;
}

void JSNodeSqliteSessionConstructor::finishCreation(VM& vm, JSGlobalObject*, JSObject* prototype)
{
    Base::finishCreation(vm, 0, "Session"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
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
            // `in` / Reflect.has / VM inquiry: the property always exists;
            // Node's LimitsQuery never checks IsOpen().
            if (slot.internalMethodType() == PropertySlot::InternalMethodType::HasProperty
                || slot.internalMethodType() == PropertySlot::InternalMethodType::VMInquiry) {
                slot.setValue(self, static_cast<unsigned>(PropertyAttribute::DontDelete), jsUndefined());
                return true;
            }
            auto& vm = getVM(globalObject);
            auto scope = DECLARE_THROW_SCOPE(vm);
            auto* db = self->database();
            if (!db || !db->isOpen()) {
                // JSC asserts `!scope.exception() || !result`; the exception
                // propagates to the caller (Node throws from LimitsGetter).
                throwNodeState(globalObject, scope, "database is not open"_s);
                return false;
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

JSC_DECLARE_CUSTOM_GETTER(jsTagStoreCapacity);
JSC_DECLARE_CUSTOM_GETTER(jsTagStoreDb);
JSC_DECLARE_CUSTOM_GETTER(jsTagStoreSize);

void JSNodeSqliteTagStore::finishCreation(VM& vm, JSDatabaseSync* db, unsigned capacity)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    putNodeInstanceGetter(vm, this, "capacity"_s, jsTagStoreCapacity);
    putNodeInstanceGetter(vm, this, "db"_s, jsTagStoreDb);
    putNodeInstanceGetter(vm, this, "size"_s, jsTagStoreSize);
    m_database.set(vm, this, db);
    m_capacity = capacity;
}

void JSNodeSqliteTagStore::clear()
{
    WTF::Locker locker { cellLock() };
    m_order.clear();
}

template<typename Visitor>
void JSNodeSqliteTagStore::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSNodeSqliteTagStore>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_database);
    // JSC's Riptide marker runs concurrently with the mutator, and
    // prepare()/clear() can removeAt()/insert(0,…) — which may
    // realloc or memmove — while this loop walks the vector. Same
    // protocol as WriteBarrierList: serialise mutator-side Vector
    // edits against visitation with the cell's lock.
    WTF::Locker locker { thisObject->cellLock() };
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
    // m_order is walked by visitChildren() on a concurrent marker
    // thread, so every mutation of the Vector (removeAt/insert, and
    // the miss-branch below) is serialised under the cell lock —
    // same protocol as WriteBarrierList.
    JSStatementSync* stmtObj = nullptr;
    {
        WTF::Locker locker { cellLock() };
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
    }

    if (!stmtObj) {
        // A template-strings-array accessor above may have re-entered
        // close(); re-check before handing SQLite the connection.
        if (!db->isOpen()) {
            throwNodeState(globalObject, scope, "database is not open"_s);
            return nullptr;
        }
        auto utf8 = sqlStr.utf8();
        sqlite3_stmt* stmt = nullptr;
        // SQLITE_PREPARE_PERSISTENT: TagStore-cached statements are exactly
        // the "retained for a long time and probably reused many times" case
        // the flag is documented for; it keeps them out of lookaside memory.
        // Intentional divergence from Node (which uses prepare_v2) — the
        // hint is allocator-only, not observable behavior.
        sqlite3* conn = db->connection();
        int r = sqlite3_prepare_v3(conn, utf8.data(), -1, SQLITE_PREPARE_PERSISTENT, &stmt, nullptr);
        // prepare() runs the authorizer callback (if any), which may
        // throw — surface that over SQLite's generic "not authorized"
        // so we don't overwrite the user's exception. Mirrors
        // jsDatabaseSyncPrepare's CHECK_UDF_EXCEPTION.
        if (scope.exception()) [[unlikely]] {
            if (stmt) sqlite3_finalize(stmt);
            return nullptr;
        }
        if (r != SQLITE_OK) {
            if (stmt) sqlite3_finalize(stmt);
            throwSqliteError(globalObject, scope, conn);
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

        {
            WTF::Locker locker { cellLock() };
            if (m_order.size() >= m_capacity) m_order.removeLast();
            Entry e;
            e.sql = sqlStr;
            e.stmt.set(vm, this, stmtObj);
            m_order.insert(0, std::move(e));
        }
    }

    // A UDF re-entering the same tagged template hits the cached statement
    // whose step() is on the C stack; resetting it would segfault the VDBE
    // (see REQUIRE_STMT_IDLE).
    if (stmtObj->isStepping()) [[unlikely]] {
        throwNodeState(globalObject, scope, "statement is currently executing"_s);
        return nullptr;
    }

    // Reset + bind positional values. Named-parameter handling is not
    // meaningful for a tagged template. sqlite3_reset()'s return value
    // is the *previous* step()'s error, not reset's own status — the
    // reset itself always succeeds on a valid handle — so checking it
    // here would spuriously re-throw a cached statement's stale error.
    // StatementSync's run/get/all correctly ignore it for the same
    // reason.
    sqlite3_stmt* stmt = stmtObj->statement();
    sqlite3_reset(stmt);
    // Deliberate divergence from Node v26.3.0: Node's SQLTagStore calls raw
    // sqlite3_reset and never bumps the statement's reset_generation_, so an
    // iterator from tag.iterate`…` silently re-yields from row 1 after any
    // other tag call on the same SQL hits the LRU cache and resets it. Bump
    // here so that iterator throws ERR_INVALID_STATE instead of returning
    // wrong rows.
    stmtObj->bumpResetGeneration();
    sqlite3_clear_bindings(stmt);
    int paramCount = sqlite3_bind_parameter_count(stmt);
    for (int i = 0; i < static_cast<int>(nParams) && i < paramCount; ++i) {
        JSValue v = callFrame->argument(static_cast<size_t>(i) + 1);
        // Reuse StatementSync's canonical JS→SQLite bridge so BigInt
        // overflow, int32 fast path, and undefined rejection stay in
        // sync with stmt.run(...) — a hand-rolled copy here previously
        // drifted and silently truncated 2n**64n to 0.
        if (!stmtObj->bindValue(globalObject, scope, i + 1, v))
            return nullptr;
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

// Shared tag execution: prepare/reset/bind then delegate to the same
// post-bind step drivers StatementSync uses (statementStep{Run,Get,All}),
// so both entry points behave identically and can't drift.

JSC_DEFINE_HOST_FUNCTION(jsTagStoreRun, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_TAGSTORE();
    JSDatabaseSync::BusyScope busy { self->database() };
    JSStatementSync* stmt = self->prepare(globalObject, scope, callFrame);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, statementStepRun(vm, globalObject, scope, stmt));
}

JSC_DEFINE_HOST_FUNCTION(jsTagStoreGet, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_TAGSTORE();
    JSDatabaseSync::BusyScope busy { self->database() };
    JSStatementSync* stmt = self->prepare(globalObject, scope, callFrame);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, statementStepGet(globalObject, scope, stmt));
}

JSC_DEFINE_HOST_FUNCTION(jsTagStoreAll, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    THIS_TAGSTORE();
    JSDatabaseSync::BusyScope busy { self->database() };
    JSStatementSync* stmt = self->prepare(globalObject, scope, callFrame);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, statementStepAll(globalObject, scope, stmt));
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
};

void JSNodeSqliteTagStorePrototype::finishCreation(VM& vm, JSGlobalObject*)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSNodeSqliteTagStore::info(), JSNodeSqliteTagStorePrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const ClassInfo JSNodeSqliteTagStoreConstructor::s_info = { "SQLTagStore"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSqliteTagStoreConstructor) };

JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSNodeSqliteTagStoreConstructor::call(JSGlobalObject* globalObject, CallFrame*)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Illegal constructor"_s);
}

JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSNodeSqliteTagStoreConstructor::construct(JSGlobalObject* globalObject, CallFrame*)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Illegal constructor"_s);
}

JSNodeSqliteTagStoreConstructor* JSNodeSqliteTagStoreConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* prototype)
{
    auto* ptr = new (NotNull, allocateCell<JSNodeSqliteTagStoreConstructor>(vm)) JSNodeSqliteTagStoreConstructor(vm, structure);
    ptr->finishCreation(vm, globalObject, prototype);
    return ptr;
}

void JSNodeSqliteTagStoreConstructor::finishCreation(VM& vm, JSGlobalObject*, JSObject* prototype)
{
    Base::finishCreation(vm, 0, "SQLTagStore"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level exports
// ─────────────────────────────────────────────────────────────────────────────

// backup(sourceDb, path[, options]) → Promise<number>
//
// Divergence from Node.js: Node runs each sqlite3_backup_step on the libuv
// threadpool, so its docs promise "the backed-up database can be used
// normally during the backup process". Bun runs the whole step loop
// synchronously on the JS thread — the returned Promise is resolved before
// this function returns and the event loop is blocked for the duration.
// Matching Node's contract would mean dispatching each step to Bun's
// WorkPool (webcrypto's PhonyWorkQueue is the in-tree precedent).
//
// The `progress` callback still fires between each batch of `rate` pages.
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

    int rate = 100;
    WTF::String sourceName = "main"_s;
    WTF::String targetName = "main"_s;
    JSObject* progressFn = nullptr;

    // Node validates on args.Length() > 2: an explicit `backup(db, p, undefined)`
    // throws while `backup(db, p)` does not.
    if (callFrame->argumentCount() > 2) {
        JSValue optsVal = callFrame->uncheckedArgument(2);
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

    // An options getter (rate/source/target/progress, or href/protocol on a
    // URL-like path) may have re-entered close(); sqlite3_backup_init
    // dereferences pSrcDb->mutex with no API-armor guard.
    if (!sourceDb->isOpen()) {
        return throwNodeState(globalObject, scope, "database is not open"_s);
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
    // The source db is already open (so this can never be the process's first
    // open), but keep the "config before any open" invariant local and free.
    Bun__initializeSQLite();
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

    // Node's BackupJob::AfterThreadPoolWork only reschedules when
    // sqlite3_backup_remaining() != 0. A step that never reaches the page
    // copy (destination locked, source == destination file, source in a
    // write txn) returns BUSY with remaining still 0, so Node rejects on
    // the first iteration instead of spinning. Match that gate exactly —
    // this loop is synchronous on the JS thread, so an unconditional BUSY
    // retry would be an unrecoverable process hang.
    constexpr int kBusyRetrySleepMs = 25;

    int totalPages = 0;
    while (true) {
        r = sqlite3_backup_step(backup, rate);

        if (r != SQLITE_OK && r != SQLITE_DONE && r != SQLITE_BUSY && r != SQLITE_LOCKED) {
            // Hard error. Node's HandleBackupError(resolver, backup_status_)
            // builds the rejection from the step return code itself.
            throwSqliteMessage(globalObject, scope, r, WTF::String::fromUTF8(sqlite3_errstr(r)));
            sqlite3_backup_finish(backup);
            sqlite3_close_v2(dest);
            return rejectWithPending();
        }

        totalPages = sqlite3_backup_pagecount(backup);
        int remaining = sqlite3_backup_remaining(backup);

        if (remaining != 0) {
            if (progressFn) {
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
            // Poll the termination trap so Worker.terminate() / the watchdog
            // can break a very large copy; the VM is being torn down so
            // clean up and unwind without allocating JS.
            if (vm.traps().needHandling(VMTraps::NeedTermination) || vm.hasPendingTerminationException()) [[unlikely]] {
                sqlite3_backup_finish(backup);
                sqlite3_close_v2(dest);
                scope.release();
                return JSValue::encode(jsUndefined());
            }
            if (r == SQLITE_BUSY || r == SQLITE_LOCKED) {
                sqlite3_sleep(kBusyRetrySleepMs);
            }
            continue;
        }

        if (r == SQLITE_DONE) break;

        // remaining == 0 with OK/BUSY/LOCKED: the step never advanced.
        // Node's HandleBackupError(resolver) reads sqlite3_errcode(dest)
        // here — which backup_step leaves untouched — so the observed
        // error is errcode 0 / "not an error". Match that verbatim.
        throwSqliteError(globalObject, scope, dest);
        sqlite3_backup_finish(backup);
        sqlite3_close_v2(dest);
        return rejectWithPending();
    }

    r = sqlite3_backup_finish(backup);
    if (r != SQLITE_OK) {
        throwSqliteMessage(globalObject, scope, r, WTF::String::fromUTF8(sqlite3_errstr(r)));
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
