#pragma once

#include "root.h"
#include "_NativeModule.h"

namespace Zig {
using namespace WebCore;
using namespace JSC;

DEFINE_NATIVE_MODULE(NodeSQLite)
{
    INIT_NATIVE_MODULE(4);

    // For now, just export placeholder functions until we get the build working
    put(JSC::Identifier::fromString(vm, "DatabaseSync"_s), JSC::jsUndefined());
    put(JSC::Identifier::fromString(vm, "StatementSync"_s), JSC::jsUndefined());
    
    auto* constants = JSC::constructEmptyObject(lexicalGlobalObject, globalObject->objectPrototype(), 6);
    constants->putDirect(vm, JSC::Identifier::fromString(vm, "SQLITE_CHANGESET_OMIT"_s), JSC::jsNumber(0));
    constants->putDirect(vm, JSC::Identifier::fromString(vm, "SQLITE_CHANGESET_REPLACE"_s), JSC::jsNumber(1));
    constants->putDirect(vm, JSC::Identifier::fromString(vm, "SQLITE_CHANGESET_ABORT"_s), JSC::jsNumber(2));
    constants->putDirect(vm, JSC::Identifier::fromString(vm, "SQLITE_CHANGESET_DATA"_s), JSC::jsNumber(1));
    constants->putDirect(vm, JSC::Identifier::fromString(vm, "SQLITE_CHANGESET_NOTFOUND"_s), JSC::jsNumber(2));
    constants->putDirect(vm, JSC::Identifier::fromString(vm, "SQLITE_CHANGESET_CONFLICT"_s), JSC::jsNumber(3));
    put(JSC::Identifier::fromString(vm, "constants"_s), constants);
    
    put(JSC::Identifier::fromString(vm, "backup"_s), JSC::jsUndefined());

    RETURN_NATIVE_MODULE();
}

} // namespace Zig