#pragma once

#include "root.h"
#include "_NativeModule.h"
#include "../bindings/sqlite/JSNodeSQLiteDatabaseSync.h"
#include "../bindings/sqlite/JSNodeSQLiteStatementSync.h"
#include "JavaScriptCore/ObjectConstructor.h"

namespace Zig {
using namespace WebCore;
using namespace JSC;

JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeSQLiteBackup);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeSQLiteDatabaseSyncWrapper);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeSQLiteStatementSyncWrapper);

DEFINE_NATIVE_MODULE(NodeSQLite)
{
    INIT_NATIVE_MODULE(4);

    // Get the ZigGlobalObject to access LazyClassStructures
    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    
    // DatabaseSync constructor using LazyClassStructure
    auto* databaseSyncConstructor = zigGlobalObject->m_JSNodeSQLiteDatabaseSyncClassStructure.constructorInitializedOnMainThread(zigGlobalObject);
    put(JSC::Identifier::fromString(vm, "DatabaseSync"_s), databaseSyncConstructor);
    
    // StatementSync constructor using LazyClassStructure
    auto* statementSyncConstructor = zigGlobalObject->m_JSNodeSQLiteStatementSyncClassStructure.constructorInitializedOnMainThread(zigGlobalObject);
    put(JSC::Identifier::fromString(vm, "StatementSync"_s), statementSyncConstructor);

    // backup function
    auto* backupFunction = JSC::JSFunction::create(vm, globalObject, 0, "backup"_s, jsFunctionNodeSQLiteBackup, ImplementationVisibility::Public, NoIntrinsic, jsFunctionNodeSQLiteBackup);
    put(JSC::Identifier::fromString(vm, "backup"_s), backupFunction);
    
    // Constants object
    JSC::JSObject* constants = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 6);
    constants->putDirect(vm, JSC::Identifier::fromString(vm, "SQLITE_CHANGESET_OMIT"_s), JSC::jsNumber(0));
    constants->putDirect(vm, JSC::Identifier::fromString(vm, "SQLITE_CHANGESET_REPLACE"_s), JSC::jsNumber(1));
    constants->putDirect(vm, JSC::Identifier::fromString(vm, "SQLITE_CHANGESET_ABORT"_s), JSC::jsNumber(2));
    constants->putDirect(vm, JSC::Identifier::fromString(vm, "SQLITE_CHANGESET_DATA"_s), JSC::jsNumber(1));
    constants->putDirect(vm, JSC::Identifier::fromString(vm, "SQLITE_CHANGESET_NOTFOUND"_s), JSC::jsNumber(2));
    constants->putDirect(vm, JSC::Identifier::fromString(vm, "SQLITE_CHANGESET_CONFLICT"_s), JSC::jsNumber(3));
    constants->putDirect(vm, JSC::Identifier::fromString(vm, "SQLITE_CHANGESET_CONSTRAINT"_s), JSC::jsNumber(4));
    constants->putDirect(vm, JSC::Identifier::fromString(vm, "SQLITE_CHANGESET_FOREIGN_KEY"_s), JSC::jsNumber(5));
    put(JSC::Identifier::fromString(vm, "constants"_s), constants);
}

} // namespace Zig