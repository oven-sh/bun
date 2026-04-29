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

// ─────────────────────────────────────────────────────────────────────────────
// DatabaseSync
// ─────────────────────────────────────────────────────────────────────────────

struct DatabaseSyncOpenConfiguration {
    bool readOnly = false;
    bool enableForeignKeyConstraints = true;
    bool enableDoubleQuotedStringLiterals = false;
    bool allowExtension = false;
    int timeout = 0;
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

    JSC::WriteBarrier<JSDatabaseSync> m_database;
    std::optional<WTF::HashMap<WTF::String, WTF::String>> m_bareNamedParams;

private:
    JSStatementSync(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(JSC::VM& vm, JSDatabaseSync* db, sqlite3_stmt* stmt);

    bool bindValue(JSC::JSGlobalObject*, JSC::ThrowScope&, int index, JSC::JSValue);

    sqlite3_stmt* m_stmt = nullptr;
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

// Module-level constants object (SQLITE_CHANGESET_*).
JSC::JSValue createNodeSqliteConstants(JSC::VM&, JSC::JSGlobalObject*);

} // namespace Bun
