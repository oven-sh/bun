#include "root.h"

#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/JSBigInt.h"
#include "JavaScriptCore/Structure.h"
#include "JavaScriptCore/ThrowScope.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "JavaScriptCore/JSType.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/HeapAnalyzer.h"
#include "JavaScriptCore/JSDestructibleObjectHeapCellType.h"
#include "JavaScriptCore/SlotVisitorMacros.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/SubspaceInlines.h"
#include "JavaScriptCore/PropertyNameArray.h"
#include "JavaScriptCore/ObjectPrototype.h"

#include "JSNodeSQLiteStatementSyncConstructor.h"
#include "JSNodeSQLiteStatementSync.h"
#include "JSNodeSQLiteDatabaseSync.h"
#include "ZigGlobalObject.h"
#include "BunBuiltinNames.h"
#include "ErrorCode.h"

#include "sqlite3_local.h"
#include <wtf/text/WTFString.h>

namespace Bun {

using namespace JSC;
using namespace WebCore;

static JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncConstructor);

const ClassInfo JSNodeSQLiteStatementSyncConstructor::s_info = { "StatementSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteStatementSyncConstructor) };

JSNodeSQLiteStatementSyncConstructor* JSNodeSQLiteStatementSyncConstructor::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype)
{
    JSNodeSQLiteStatementSyncConstructor* constructor = new (NotNull, JSC::allocateCell<JSNodeSQLiteStatementSyncConstructor>(vm)) JSNodeSQLiteStatementSyncConstructor(vm, structure);
    constructor->finishCreation(vm, prototype);
    return constructor;
}

JSC::Structure* JSNodeSQLiteStatementSyncConstructor::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
}

JSNodeSQLiteStatementSyncConstructor::JSNodeSQLiteStatementSyncConstructor(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure, jsNodeSQLiteStatementSyncConstructor, jsNodeSQLiteStatementSyncConstructor)
{
}

void JSNodeSQLiteStatementSyncConstructor::finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
{
    Base::finishCreation(vm, 2, "StatementSync"_s);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteStatementSyncConstructor, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!callFrame->newTarget()) {
        throwTypeError(globalObject, scope, "Class constructor StatementSync cannot be invoked without 'new'"_s);
        return {};
    }

    throwTypeError(globalObject, scope, "StatementSync cannot be constructed directly"_s);
    return {};
}

} // namespace Bun