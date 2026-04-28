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

    putNativeFn(JSC::Identifier::fromString(vm, "backup"_s), Bun::jsNodeSqliteBackup);

    RETURN_NATIVE_MODULE();
}

} // namespace Zig
