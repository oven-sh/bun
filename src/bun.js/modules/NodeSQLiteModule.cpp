#include "NodeSQLiteModule.h"
#include "../bindings/sqlite/JSNodeSQLiteDatabaseSync.h"
#include "../bindings/sqlite/JSNodeSQLiteStatementSync.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSCInlines.h"
#include "JavaScriptCore/CallFrame.h"

namespace Zig {

using namespace JSC;
using namespace WebCore;

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeSQLiteBackup, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    // TODO: Implement backup function
    throwException(globalObject, scope, createError(globalObject, "backup function not implemented"_s));
    return {};
}

// Wrapper for DatabaseSync constructor
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeSQLiteDatabaseSyncWrapper, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!callFrame->newTarget()) {
        throwTypeError(globalObject, scope, "Class constructor DatabaseSync cannot be invoked without 'new'"_s);
        return {};
    }

    auto* zigGlobalObject = jsCast<GlobalObject*>(defaultGlobalObject(globalObject));
    Structure* structure = zigGlobalObject->JSNodeSQLiteDatabaseSyncStructure();
    auto* object = Bun::JSNodeSQLiteDatabaseSync::create(vm, structure);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(object);
}

// Wrapper for StatementSync constructor  
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeSQLiteStatementSyncWrapper, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // StatementSync cannot be created directly - it's created via database.prepare()
    throwTypeError(globalObject, scope, "StatementSync cannot be constructed directly. Use database.prepare() instead."_s);
    return {};
}

} // namespace Zig