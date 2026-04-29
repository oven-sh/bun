#include "../bindings/sqlite/NodeSqlite.h"
#include "../bindings/ZigGlobalObject.h"
#include <JavaScriptCore/JSGlobalObject.h>

namespace Bun {
JSC_DECLARE_HOST_FUNCTION(jsNodeSqliteBackup);
}

namespace Zig {

DEFINE_NATIVE_MODULE(NodeSqlite)
{
    INIT_NATIVE_MODULE(4);

    put(JSC::Identifier::fromString(vm, "DatabaseSync"_s),
        globalObject->m_JSDatabaseSyncClassStructure.constructorInitializedOnMainThread(globalObject));

    put(JSC::Identifier::fromString(vm, "StatementSync"_s),
        globalObject->m_JSStatementSyncClassStructure.constructorInitializedOnMainThread(globalObject));

    put(JSC::Identifier::fromString(vm, "constants"_s),
        Bun::createNodeSqliteConstants(vm, globalObject));

    // backup.length === 2 (sourceDb, path) — Node's test-sqlite-backup
    // asserts it. putNativeFn hardcodes 1, so construct the function
    // ourselves.
    {
        auto id = JSC::Identifier::fromString(vm, "backup"_s);
        put(id, JSC::JSFunction::create(vm, globalObject, 2, id.string(),
                    Bun::jsNodeSqliteBackup, JSC::ImplementationVisibility::Public,
                    JSC::NoIntrinsic, Bun::jsNodeSqliteBackup));
    }

    RETURN_NATIVE_MODULE();
}

} // namespace Zig
