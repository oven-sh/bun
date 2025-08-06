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

DEFINE_NATIVE_MODULE(NodeSQLite)
{
    INIT_NATIVE_MODULE(4);

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

    // Placeholder constructors (actual constructor export needs further debugging)
    auto* databaseSyncPlaceholder = JSC::JSFunction::create(vm, globalObject, 0, "DatabaseSync"_s, jsFunctionNodeSQLiteBackup, ImplementationVisibility::Public, NoIntrinsic, jsFunctionNodeSQLiteBackup);
    put(JSC::Identifier::fromString(vm, "DatabaseSync"_s), databaseSyncPlaceholder);
    
    auto* statementSyncPlaceholder = JSC::JSFunction::create(vm, globalObject, 0, "StatementSync"_s, jsFunctionNodeSQLiteBackup, ImplementationVisibility::Public, NoIntrinsic, jsFunctionNodeSQLiteBackup);
    put(JSC::Identifier::fromString(vm, "StatementSync"_s), statementSyncPlaceholder);
}

} // namespace Zig