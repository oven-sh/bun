// node:sqlite — native implementation of Node.js's `node:sqlite` module.
//
// This uses the bundled sqlite3 amalgamation (sqlite3_local.h / sqlite3.c)
// on all platforms, matching Node.js which always bundles its own SQLite.
// Unlike bun:sqlite, it does not participate in macOS's LAZY_LOAD_SQLITE
// dlopen path — node:sqlite users expect Node's bundled-SQLite semantics
// (and functions like sqlite3_changes64 that older system libraries lack).
//
// Reference: https://github.com/nodejs/node/blob/main/src/node_sqlite.cc
#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/InternalFunction.h>
#include <wtf/HashMap.h>
#include <wtf/text/StringHash.h>
#include <array>

// Forward-declare the opaque SQLite handle types so this header does not
// pull the (large) sqlite3 amalgamation header into every translation unit
// that includes it — notably ZigGlobalObject.cpp and InternalModuleRegistry.cpp,
// which on macOS also see the system sqlite3.h via JSSQLStatement.h.
// NodeSqlite.cpp includes sqlite3_local.h directly for the full API.
extern "C" {
struct sqlite3;
struct sqlite3_stmt;
struct sqlite3_session;
}

namespace Bun {

class JSDatabaseSync;
class JSStatementSync;
class JSNodeSqliteSession;
class JSStatementSyncIterator;
class JSNodeSqliteLimits;
class JSNodeSqliteTagStore;

// ─────────────────────────────────────────────────────────────────────────────
// DatabaseSync
// ─────────────────────────────────────────────────────────────────────────────

// Must equal the number of SQLITE_LIMIT_* categories (SQLITE_LIMIT_LENGTH ..
// SQLITE_LIMIT_TRIGGER_DEPTH). A static_assert in the .cpp enforces this
// against SQLITE_N_LIMIT-1 once the amalgamation header is visible.
static constexpr size_t kNodeSqliteLimitCount = 11;

struct DatabaseSyncOpenConfiguration {
    bool readOnly = false;
    bool enableForeignKeyConstraints = true;
    bool enableDoubleQuotedStringLiterals = false;
    // Node.js turns SQLITE_DBCONFIG_DEFENSIVE on by default; callers can
    // disable it with {defensive: false} or db.enableDefensive(false).
    bool enableDefensive = true;
    bool allowExtension = false;
    int timeout = 0;
    // Per-limit value supplied via the constructor's {limits: {...}}
    // option, applied after open(). Indexed by SQLITE_LIMIT_* id.
    // -1 means "unset" — we never accept a negative limit from the user,
    // so this is an unambiguous sentinel and keeps the struct trivially
    // copyable (std::optional<int>[11] would bloat every DatabaseSync).
    std::array<int, kNodeSqliteLimitCount> initialLimits { -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1 };
    // Defaults inherited by statements prepared on this connection
    // (overridable per-statement via setReadBigInts() etc.).
    bool readBigInts = false;
    bool returnArrays = false;
    bool allowBareNamedParameters = true;
    bool allowUnknownNamedParameters = false;
};

class JSDatabaseSync final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSDatabaseSync* create(JSC::VM& vm, JSC::Structure* structure, WTF::String&& location, DatabaseSyncOpenConfiguration&& config);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    static void destroy(JSC::JSCell* cell) { static_cast<JSDatabaseSync*>(cell)->~JSDatabaseSync(); }
    ~JSDatabaseSync();

    // Open the underlying connection. Throws on the scope if it fails or the
    // database is already open.
    bool open(JSC::JSGlobalObject*, JSC::ThrowScope&);
    void closeInternal();

    sqlite3* connection() const { return m_db; }
    bool isOpen() const { return m_db != nullptr; }
    // Bumped on every successful open(). Statements/sessions capture this
    // at creation and compare instead of the raw sqlite3* — after
    // close()+open() the allocator may recycle the exact same address for
    // the new connection (ABA), so pointer equality isn't a sound
    // "same connection" check.
    unsigned openGeneration() const { return m_openGeneration; }
    // deserialize() replaces the backing database without a
    // close()+open() cycle, so it bumps the generation manually to
    // invalidate every outstanding StatementSync/Session wrapper. We do
    // NOT sqlite3_finalize() those stmts here — the JS wrappers still
    // hold the raw handle and will free it themselves on GC, so a
    // pre-emptive finalize would make them double-free.
    void bumpOpenGeneration() { ++m_openGeneration; }
    bool allowLoadExtension() const { return m_config.allowExtension; }
    bool enableLoadExtensionIsOn() const { return m_enableLoadExtension; }
    void setEnableLoadExtension(bool v) { m_enableLoadExtension = v; }

    const DatabaseSyncOpenConfiguration& config() const { return m_config; }

    // User-defined functions call back into JS from inside sqlite3_step().
    // If the JS callback throws, we record that here so the enclosing
    // step()/exec() can propagate the JS exception instead of wrapping the
    // uninformative "user-defined function raised exception" SQLite error.
    bool takeIgnoreNextSqliteError()
    {
        bool v = m_ignoreNextSqliteError;
        m_ignoreNextSqliteError = false;
        return v;
    }
    void setIgnoreNextSqliteError() { m_ignoreNextSqliteError = true; }

    void trackSession(sqlite3_session* s) { m_sessions.append(s); }
    void untrackSession(sqlite3_session* s) { m_sessions.removeFirst(s); }

    // setAuthorizer(cb) callback and the lazily-created limits wrapper.
    // Kept as GC-traced fields on the DatabaseSync cell rather than a
    // C-side Strong<> so a db → authorizer-closure → db cycle is
    // collectable (Node stores the callback in an internal field on the
    // wrapper object for the same reason).
    JSC::WriteBarrier<JSC::JSObject> m_authorizer;
    JSC::WriteBarrier<JSNodeSqliteLimits> m_limits;

    // Incremented for the duration of any native call that hands this
    // connection into SQLite and may re-enter JS (option-getter, xFunc,
    // xFilter, progress, …). close() rejects with ERR_INVALID_STATE while
    // non-zero so a re-entrant close() can't free the sqlite3* out from
    // under the in-flight C call. [Symbol.dispose] becomes a no-op.
    bool isBusy() const { return m_busyDepth > 0; }
    struct BusyScope {
        JSDatabaseSync* db;
        BusyScope(JSDatabaseSync* d)
            : db(d)
        {
            if (db) ++db->m_busyDepth;
        }
        ~BusyScope()
        {
            if (db) --db->m_busyDepth;
        }
    };

private:
    JSDatabaseSync(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm);

    WTF::String m_location;
    DatabaseSyncOpenConfiguration m_config {};
    sqlite3* m_db = nullptr;
    unsigned m_openGeneration = 0;
    unsigned m_busyDepth = 0;
    // Sessions must be deleted before sqlite3_close_v2() to avoid
    // use-after-free inside the preupdate hook; track them by raw handle
    // (not JS object) so close() can sweep regardless of GC ordering.
    WTF::Vector<sqlite3_session*> m_sessions;
    bool m_enableLoadExtension = false;
    bool m_ignoreNextSqliteError = false;
};

class JSDatabaseSyncPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    DECLARE_INFO;

    static JSDatabaseSyncPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        auto* ptr = new (NotNull, JSC::allocateCell<JSDatabaseSyncPrototype>(vm)) JSDatabaseSyncPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSDatabaseSyncPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSDatabaseSyncPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

class JSDatabaseSyncConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    DECLARE_INFO;

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSDatabaseSyncConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);

private:
    JSDatabaseSyncConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, call, construct)
    {
    }
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject* prototype);
};

// ─────────────────────────────────────────────────────────────────────────────
// StatementSync
// ─────────────────────────────────────────────────────────────────────────────

class JSStatementSync final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSStatementSync* create(JSC::VM& vm, JSC::Structure* structure, JSDatabaseSync* db, sqlite3_stmt* stmt);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    static void destroy(JSC::JSCell* cell) { static_cast<JSStatementSync*>(cell)->~JSStatementSync(); }
    ~JSStatementSync();

    sqlite3_stmt* statement() const { return m_stmt; }
    sqlite3* connection() const;
    JSDatabaseSync* database() const { return m_database.get(); }
    // A statement is considered finalized either when it has been
    // explicitly finalized or when its owning database has been closed
    // (the underlying sqlite3_stmt* then points into a zombie connection
    // and must not be stepped).
    bool isFinalized() const;
    void finalizeStatement();

    bool useBigInts() const { return m_useBigInts; }
    bool returnArrays() const { return m_returnArrays; }
    bool allowBareNamedParams() const { return m_allowBareNamedParams; }
    bool allowUnknownNamedParams() const { return m_allowUnknownNamedParams; }
    void setUseBigInts(bool v) { m_useBigInts = v; }
    void setReturnArrays(bool v) { m_returnArrays = v; }
    void setAllowBareNamedParams(bool v) { m_allowBareNamedParams = v; }
    void setAllowUnknownNamedParams(bool v) { m_allowUnknownNamedParams = v; }

    // Incremented whenever run()/get()/all()/iterate() resets the statement,
    // so a live StatementSyncIterator can detect that its cursor position
    // has been invalidated by another call on the same statement.
    unsigned resetGeneration() const { return m_resetGeneration; }
    void bumpResetGeneration() { ++m_resetGeneration; }

    // Bind callFrame->argument(anon_start..) to the statement using Node.js
    // semantics. Returns false and throws on failure.
    bool bindParams(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::CallFrame*);
    // Single-value JS → sqlite3_bind_* conversion with Node's validation
    // (int32 fast path, BigInt round-trip overflow check, undefined
    // rejected). Public so SQLTagStore can reuse the one canonical
    // JS→SQLite bridge instead of maintaining a drifted copy.
    bool bindValue(JSC::JSGlobalObject*, JSC::ThrowScope&, int index, JSC::JSValue);

    JSC::WriteBarrier<JSDatabaseSync> m_database;
    std::optional<WTF::HashMap<WTF::String, WTF::String>> m_bareNamedParams;

    // Structure-caching fast path for result rows (mirrors bun:sqlite's
    // JSSQLStatement). For queries whose column list fits in a final
    // object's inline storage, we precompute one null-prototype Structure
    // with a slot per distinct column name and then fill each row via
    // putDirectOffset instead of running the generic put machinery per
    // cell. Built lazily on the first step() that yields columns;
    // invalidated when the statement is reset with a different shape.
    JSC::Structure* ensureRowStructure(JSC::JSGlobalObject*);
    void invalidateRowStructure();
    JSC::Structure* rowStructure() const { return m_rowStructure.get(); }
    // Per-result-column index into the structure's inline slots.
    // Duplicate column names share the first occurrence's slot so the
    // later column overwrites it — last-wins, matching Node's V8
    // Object::Set() row builder and the generic rowToObject() fallback.
    const WTF::Vector<int8_t>& columnOffsets() const { return m_columnOffsets; }

private:
    JSStatementSync(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(JSC::VM& vm, JSDatabaseSync* db, sqlite3_stmt* stmt);

    sqlite3_stmt* m_stmt = nullptr;
    JSC::WriteBarrier<JSC::Structure> m_rowStructure;
    WTF::Vector<int8_t> m_columnOffsets;
    int m_rowColumnCount = -1;
    // Open-generation this statement was prepared on. After db.close()
    // + db.open() the JSDatabaseSync may even get the *same* sqlite3*
    // back (allocator reuse — ABA), so compare the generation counter
    // rather than the raw handle to let isFinalized() detect a stale
    // statement instead of stepping a dead handle and reporting
    // `errcode: 0 "not an error"` from the new connection.
    unsigned m_originGeneration = 0;
    unsigned m_resetGeneration = 0;
    bool m_useBigInts : 1 = false;
    bool m_returnArrays : 1 = false;
    bool m_allowBareNamedParams : 1 = true;
    bool m_allowUnknownNamedParams : 1 = false;
};

class JSStatementSyncPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    DECLARE_INFO;

    static JSStatementSyncPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        auto* ptr = new (NotNull, JSC::allocateCell<JSStatementSyncPrototype>(vm)) JSStatementSyncPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSStatementSyncPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSStatementSyncPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

class JSStatementSyncConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    DECLARE_INFO;

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSStatementSyncConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);

private:
    JSStatementSyncConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, call, construct)
    {
    }
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject* prototype);
};

// ─────────────────────────────────────────────────────────────────────────────
// StatementSyncIterator — lazy row cursor returned by iterate().
//
// Not its own public constructor; the prototype chain is
//   iter → StatementSyncIteratorPrototype → %IteratorPrototype%
// so for-of, spread, Iterator helpers all work.
// ─────────────────────────────────────────────────────────────────────────────

class JSStatementSyncIterator final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSStatementSyncIterator* create(JSC::VM& vm, JSC::Structure* structure, JSStatementSync* stmt);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    static void destroy(JSC::JSCell* cell) { static_cast<JSStatementSyncIterator*>(cell)->~JSStatementSyncIterator(); }
    ~JSStatementSyncIterator() = default;

    JSStatementSync* statement() const { return m_statement.get(); }
    bool done() const { return m_done; }
    void setDone() { m_done = true; }
    unsigned capturedGeneration() const { return m_capturedGeneration; }

    JSC::WriteBarrier<JSStatementSync> m_statement;

private:
    JSStatementSyncIterator(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(JSC::VM& vm, JSStatementSync* stmt);

    unsigned m_capturedGeneration = 0;
    bool m_done = false;
};

class JSStatementSyncIteratorPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    DECLARE_INFO;

    static JSStatementSyncIteratorPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        auto* ptr = new (NotNull, JSC::allocateCell<JSStatementSyncIteratorPrototype>(vm)) JSStatementSyncIteratorPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSStatementSyncIteratorPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSStatementSyncIteratorPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

// ─────────────────────────────────────────────────────────────────────────────
// Session — thin wrapper over sqlite3_session* returned by
// DatabaseSync.prototype.createSession(). No public constructor.
// ─────────────────────────────────────────────────────────────────────────────

class JSNodeSqliteSession final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSNodeSqliteSession* create(JSC::VM& vm, JSC::Structure* structure, JSDatabaseSync* db, sqlite3_session* session);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    static void destroy(JSC::JSCell* cell) { static_cast<JSNodeSqliteSession*>(cell)->~JSNodeSqliteSession(); }
    ~JSNodeSqliteSession();

    sqlite3_session* session() const { return m_session; }
    JSDatabaseSync* database() const { return m_database.get(); }
    // True once the owning database has been closed (closeInternal()
    // frees every tracked sqlite3_session* without touching the wrappers)
    // OR re-opened to a different connection — in either case m_session is
    // dangling and must not be used.
    bool isStale() const;
    void deleteSession();

    JSC::WriteBarrier<JSDatabaseSync> m_database;

private:
    JSNodeSqliteSession(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(JSC::VM& vm, JSDatabaseSync* db, sqlite3_session* session);

    sqlite3_session* m_session = nullptr;
    // See JSStatementSync::m_originGeneration — same close()+open() guard.
    unsigned m_originGeneration = 0;
};

class JSNodeSqliteSessionPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    DECLARE_INFO;

    static JSNodeSqliteSessionPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        auto* ptr = new (NotNull, JSC::allocateCell<JSNodeSqliteSessionPrototype>(vm)) JSNodeSqliteSessionPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSNodeSqliteSessionPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSNodeSqliteSessionPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

// ─────────────────────────────────────────────────────────────────────────────
// DatabaseSyncLimits — the object returned by `db.limits`. Reads and
// writes to its eleven named properties (length, sqlLength, …) call
// sqlite3_limit() on the owning connection. No prototype (so an
// overridden Object.prototype can't shadow a limit name). Intercepted
// via getOwnPropertySlot/put/getOwnPropertyNames rather than per-name
// accessors so the properties present as enumerable *own* data-like
// properties (Node's tests do `Object.keys(db.limits)`).
// ─────────────────────────────────────────────────────────────────────────────

class JSNodeSqliteLimits final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesGetOwnPropertySlot | JSC::OverridesPut | JSC::OverridesGetOwnPropertyNames | JSC::ProhibitsPropertyCaching;

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSNodeSqliteLimits* create(JSC::VM& vm, JSC::Structure* structure, JSDatabaseSync* db);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    static void destroy(JSC::JSCell* cell) { static_cast<JSNodeSqliteLimits*>(cell)->~JSNodeSqliteLimits(); }
    ~JSNodeSqliteLimits() = default;

    JSDatabaseSync* database() const { return m_database.get(); }

    static bool getOwnPropertySlot(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);
    static bool put(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::JSValue, JSC::PutPropertySlot&);
    static void getOwnPropertyNames(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyNameArrayBuilder&, JSC::DontEnumPropertiesMode);

    JSC::WriteBarrier<JSDatabaseSync> m_database;

private:
    JSNodeSqliteLimits(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(JSC::VM& vm, JSDatabaseSync* db);
};

// ─────────────────────────────────────────────────────────────────────────────
// SQLTagStore — returned by db.createTagStore(). A small LRU of
// prepared StatementSyncs keyed on the joined template-literal string,
// so sql.get`SELECT … ${x}` reuses the same compiled statement across
// calls. No public constructor.
// ─────────────────────────────────────────────────────────────────────────────

class JSNodeSqliteTagStore final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSNodeSqliteTagStore* create(JSC::VM& vm, JSC::Structure* structure, JSDatabaseSync* db, unsigned capacity);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    static void destroy(JSC::JSCell* cell) { static_cast<JSNodeSqliteTagStore*>(cell)->~JSNodeSqliteTagStore(); }
    ~JSNodeSqliteTagStore() = default;

    JSDatabaseSync* database() const { return m_database.get(); }
    unsigned capacity() const { return m_capacity; }
    unsigned size() const { return static_cast<unsigned>(m_order.size()); }
    void clear();

    // Build SQL from the template-tag arguments ("part0 ? part1 ? …"),
    // look it up in the cache (or prepare a fresh StatementSync and
    // insert it, evicting the least-recently-used entry if at capacity)
    // and bind the interpolated values to the result. Returns nullptr
    // and throws on any failure.
    JSStatementSync* prepare(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::CallFrame*);

    JSC::WriteBarrier<JSDatabaseSync> m_database;

private:
    JSNodeSqliteTagStore(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(JSC::VM& vm, JSDatabaseSync* db, unsigned capacity);

    struct Entry {
        WTF::String sql;
        JSC::WriteBarrier<JSStatementSync> stmt;
    };
    // Move-to-front LRU. O(n) is fine at the small capacities Node
    // documents (default 1000, tests use 10); the structure-caching on
    // StatementSync is where the real win is, this just avoids
    // re-preparing the SQL.
    WTF::Vector<Entry> m_order;
    unsigned m_capacity = 1000;
};

class JSNodeSqliteTagStorePrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    DECLARE_INFO;

    static JSNodeSqliteTagStorePrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        auto* ptr = new (NotNull, JSC::allocateCell<JSNodeSqliteTagStorePrototype>(vm)) JSNodeSqliteTagStorePrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSNodeSqliteTagStorePrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSNodeSqliteTagStorePrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

// Module-level constants object (SQLITE_CHANGESET_* + authorizer codes).
JSC::JSValue createNodeSqliteConstants(JSC::VM&, JSC::JSGlobalObject*);

} // namespace Bun
