#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/Structure.h>
#include <wtf/text/WTFString.h>
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
    
    const WTF::String& path() const { return m_path; }
    void setPath(const WTF::String& path) { m_path = path; }
    
    void setOptions(bool readBigInts, bool returnArrays, bool allowBareNamedParameters, bool allowUnknownNamedParameters) {
        m_readBigInts = readBigInts;
        m_returnArrays = returnArrays;
        m_allowBareNamedParameters = allowBareNamedParameters;
        m_allowUnknownNamedParameters = allowUnknownNamedParameters;
    }
    
    bool readBigInts() const { return m_readBigInts; }
    bool returnArrays() const { return m_returnArrays; }
    bool allowBareNamedParameters() const { return m_allowBareNamedParameters; }
    bool allowUnknownNamedParameters() const { return m_allowUnknownNamedParameters; }

private:
    JSNodeSQLiteDatabaseSync(JSC::VM& vm, JSC::Structure* structure);
    ~JSNodeSQLiteDatabaseSync();
    void finishCreation(JSC::VM& vm);

    sqlite3* m_db;
    WTF::String m_path;
    bool m_readBigInts = false;
    bool m_returnArrays = false;
    bool m_allowBareNamedParameters = true;
    bool m_allowUnknownNamedParameters = false;

public:
};

void setupJSNodeSQLiteDatabaseSyncClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun