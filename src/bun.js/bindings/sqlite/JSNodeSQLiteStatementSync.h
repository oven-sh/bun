#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/WriteBarrier.h>
#include "sqlite3_local.h"

namespace Bun {

class JSNodeSQLiteDatabaseSync;

class JSNodeSQLiteStatementSync final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::HasStaticPropertyTable;

    static JSNodeSQLiteStatementSync* create(JSC::VM& vm, JSC::Structure* structure, JSNodeSQLiteDatabaseSync* database);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename MyClassT, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    static void destroy(JSC::JSCell* cell);

    sqlite3_stmt* statement() const { return m_stmt; }
    JSNodeSQLiteDatabaseSync* database() const { return m_database.get(); }
    void finalizeStatement();

private:
    JSNodeSQLiteStatementSync(JSC::VM& vm, JSC::Structure* structure, JSNodeSQLiteDatabaseSync* database);
    ~JSNodeSQLiteStatementSync();
    void finishCreation(JSC::VM& vm);

    sqlite3_stmt* m_stmt;
    JSC::WriteBarrier<JSNodeSQLiteDatabaseSync> m_database;

public:
};

void setupJSNodeSQLiteStatementSyncClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun