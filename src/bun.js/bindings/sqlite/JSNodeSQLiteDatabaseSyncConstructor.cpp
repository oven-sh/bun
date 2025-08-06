#include "root.h"

#include "JSNodeSQLiteDatabaseSyncConstructor.h"
#include "JSNodeSQLiteDatabaseSync.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>

namespace Bun {

using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(nodeSQLiteDatabaseSyncConstructorCall);
static JSC_DECLARE_HOST_FUNCTION(nodeSQLiteDatabaseSyncConstructorConstruct);

const ClassInfo JSNodeSQLiteDatabaseSyncConstructor::s_info = { "DatabaseSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteDatabaseSyncConstructor) };

JSNodeSQLiteDatabaseSyncConstructor::JSNodeSQLiteDatabaseSyncConstructor(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure, nodeSQLiteDatabaseSyncConstructorCall, nodeSQLiteDatabaseSyncConstructorConstruct)
{
}

JSNodeSQLiteDatabaseSyncConstructor* JSNodeSQLiteDatabaseSyncConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* prototype)
{
    JSNodeSQLiteDatabaseSyncConstructor* constructor = new (NotNull, allocateCell<JSNodeSQLiteDatabaseSyncConstructor>(vm)) JSNodeSQLiteDatabaseSyncConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

void JSNodeSQLiteDatabaseSyncConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
{
    Base::finishCreation(vm, 1, "DatabaseSync"_s, PropertyAdditionMode::WithStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
}

JSC_DEFINE_HOST_FUNCTION(nodeSQLiteDatabaseSyncConstructorCall, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // DatabaseSync() called as function is not allowed
    throwTypeError(globalObject, scope, "Class constructor DatabaseSync cannot be invoked without 'new'"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(nodeSQLiteDatabaseSyncConstructorConstruct, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto* structure = zigGlobalObject->m_JSNodeSQLiteDatabaseSyncClassStructure.get(zigGlobalObject);
    
    JSNodeSQLiteDatabaseSync* thisObject = JSNodeSQLiteDatabaseSync::create(vm, structure);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(thisObject);
}

} // namespace Bun