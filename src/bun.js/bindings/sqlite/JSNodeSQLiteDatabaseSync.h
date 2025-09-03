#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSValue.h>
#include <JavaScriptCore/Strong.h>
#include <wtf/text/WTFString.h>
#include <wtf/HashMap.h>

#if LAZY_LOAD_SQLITE
#include "lazy_sqlite3.h"
#else
#include "sqlite3_local.h"
#endif

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
    
    // Individual setters for statement-level overrides
    void setReadBigInts(bool readBigInts) { m_readBigInts = readBigInts; }
    void setAllowBareNamedParameters(bool allow) { m_allowBareNamedParameters = allow; }
    
    bool readBigInts() const { return m_readBigInts; }
    bool returnArrays() const { return m_returnArrays; }
    bool allowBareNamedParameters() const { return m_allowBareNamedParameters; }
    bool allowUnknownNamedParameters() const { return m_allowUnknownNamedParameters; }

    // User-defined function support structures - COMMENTED OUT FOR COMPILATION
    // TODO: Fix Strong<JSValue> template issues and visitor implementation
    /*
    struct UserFunction {
        JSC::Strong<JSC::JSFunction> callback;
        bool deterministic;
        bool directOnly;
        bool useBigIntArguments;
        bool varargs;
        
        UserFunction(JSC::VM& vm, JSNodeSQLiteDatabaseSync* database, JSC::JSFunction* func, 
                    bool det, bool direct, bool useBigInt, bool var)
            : callback(vm, func)
            , deterministic(det)
            , directOnly(direct)
            , useBigIntArguments(useBigInt)
            , varargs(var)
        {
        }
    };

    struct AggregateFunction {
        JSC::Strong<JSC::JSFunction> stepCallback;
        JSC::Strong<JSC::JSFunction> resultCallback;
        JSC::Strong<JSC::JSFunction> inverseCallback;
        JSC::Strong<JSC::JSValue> startValue;
        bool deterministic;
        bool directOnly;
        bool useBigIntArguments;
        bool varargs;
        
        AggregateFunction(JSC::VM& vm, JSNodeSQLiteDatabaseSync* database, JSC::JSFunction* step, 
                         JSC::JSFunction* result, JSC::JSFunction* inverse, JSC::JSValue start,
                         bool det, bool direct, bool useBigInt, bool var)
            : stepCallback(vm, step)
            , resultCallback(vm, result)
            , inverseCallback(vm, inverse)
            , startValue(vm, start)
            , deterministic(det)
            , directOnly(direct)
            , useBigIntArguments(useBigInt)
            , varargs(var)
        {
        }
    };
    
    // Function registry access
    WTF::HashMap<WTF::String, std::unique_ptr<UserFunction>> m_userFunctions;
    WTF::HashMap<WTF::String, std::unique_ptr<AggregateFunction>> m_aggregateFunctions;
    */
    
    void clearUserFunctions();

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