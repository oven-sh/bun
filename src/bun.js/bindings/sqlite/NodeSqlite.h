// node:sqlite — native implementation of Node.js's `node:sqlite` module.
//
// This shares the bundled sqlite3 amalgamation with bun:sqlite
// (JSSQLStatement.cpp) but exposes Node.js's DatabaseSync / StatementSync
// API shape and error semantics.
//
// Reference: https://github.com/nodejs/node/blob/main/src/node_sqlite.cc
#pragma once

#include "root.h"
#include "JSSQLStatement.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/InternalFunction.h>
#include <wtf/HashMap.h>
#include <wtf/text/StringHash.h>

namespace Bun {

class JSDatabaseSync;
class JSStatementSync;

// ─────────────────────────────────────────────────────────────────────────────
// DatabaseSync
// ─────────────────────────────────────────────────────────────────────────────

struct DatabaseSyncOpenConfiguration {
    bool readOnly = false;
    bool enableForeignKeyConstraints = true;
    bool enableDoubleQuotedStringLiterals = false;
    bool allowExtension = false;
    int timeout = 0;
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

    static JSDatabaseSync* create(JSC::VM& vm, JSC::Structure* structure, WTF::String&& location, DatabaseSyncOpenConfiguration&& config, bool openImmediately);

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
    bool allowLoadExtension() const { return m_config.allowExtension; }
    bool enableLoadExtensionIsOn() const { return m_enableLoadExtension; }
    void setEnableLoadExtension(bool v) { m_enableLoadExtension = v; }

private:
    JSDatabaseSync(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm);

    WTF::String m_location;
    DatabaseSyncOpenConfiguration m_config {};
    sqlite3* m_db = nullptr;
    bool m_enableLoadExtension = false;
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

// Module-level constants object (SQLITE_CHANGESET_*).
JSC::JSValue createNodeSqliteConstants(JSC::VM&, JSC::JSGlobalObject*);

} // namespace Bun
