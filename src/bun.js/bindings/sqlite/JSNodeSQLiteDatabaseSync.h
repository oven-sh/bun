#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/Structure.h>
#include "sqlite3_local.h"

namespace Bun {

class JSNodeSQLiteDatabaseSync final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSNodeSQLiteDatabaseSync* create(JSC::VM& vm, JSC::Structure* structure);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename MyClassT, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    static void destroy(JSC::JSCell* cell);

    sqlite3* database() const { return m_db; }
    void setDatabase(sqlite3* db) { m_db = db; }
    void closeDatabase();

private:
    JSNodeSQLiteDatabaseSync(JSC::VM& vm, JSC::Structure* structure);
    ~JSNodeSQLiteDatabaseSync();
    void finishCreation(JSC::VM& vm);

    sqlite3* m_db;

public:
};

void setupJSNodeSQLiteDatabaseSyncClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun