/*
 * Copyright (C) 2024 Codeblog Corp
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "root.h"
#include "JSNodeSQLiteStatementSync.h"
#include "JSNodeSQLiteDatabaseSync.h"

#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/JSBigInt.h"
#include "JavaScriptCore/Structure.h"
#include "JavaScriptCore/ThrowScope.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "JavaScriptCore/JSType.h"
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/HeapAnalyzer.h>
#include <JavaScriptCore/JSDestructibleObjectHeapCellType.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/AbstractSlotVisitorInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/GetPtr.h>
#include <wtf/PointerPreparations.h>
#include <wtf/URL.h>
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include "GCDefferalContext.h"
#include <JavaScriptCore/DOMJITAbstractHeap.h>
#include "DOMJITIDLConvert.h"
#include "DOMJITIDLType.h"
#include "JSBuffer.h"
#include "DOMJITIDLTypeFilter.h"
#include "DOMJITHelpers.h"
#include <JavaScriptCore/DFGAbstractHeap.h>
#include "wtf/SIMDUTF.h"
#include <JavaScriptCore/ObjectPrototype.h>
#include "BunBuiltinNames.h"
#include "sqlite3_error_codes.h"

namespace Bun {

using namespace JSC;
using namespace WebCore;

const ClassInfo JSNodeSQLiteStatementSync::s_info = { "StatementSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteStatementSync) };

JSNodeSQLiteStatementSync* JSNodeSQLiteStatementSync::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* statement, JSNodeSQLiteDatabaseSync* database)
{
    auto* instance = new (NotNull, allocateCell<JSNodeSQLiteStatementSync>(vm)) JSNodeSQLiteStatementSync(vm, structure);
    instance->finishCreation(vm, globalObject, statement, database);
    return instance;
}

Structure* JSNodeSQLiteStatementSync::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSNodeSQLiteStatementSync::JSNodeSQLiteStatementSync(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSNodeSQLiteStatementSync::finishCreation(VM& vm, JSGlobalObject* globalObject, JSObject* statement, JSNodeSQLiteDatabaseSync* database)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    
    m_statement.set(vm, this, statement);
    m_database.set(vm, this, database);
}

DEFINE_VISIT_CHILDREN(JSNodeSQLiteStatementSync);

template<typename Visitor>
void JSNodeSQLiteStatementSync::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<JSNodeSQLiteStatementSync*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(cell, visitor);
    visitor.append(thisObject->m_statement);
    visitor.append(thisObject->m_database);
}

static JSValue callStatementMethod(JSGlobalObject* globalObject, JSObject* statement, const String& methodName, const MarkedArgumentBuffer& args, bool expectsReturn = true)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    JSValue method = statement->get(globalObject, PropertyName(Identifier::fromString(vm, methodName)));
    RETURN_IF_EXCEPTION(scope, JSValue());
    
    if (!method.isCallable()) {
        throwVMError(globalObject, scope, "Statement method is not callable"_s);
        return JSValue();
    }
    
    JSValue result = JSC::call(globalObject, method, args, "Statement method call"_s);
    RETURN_IF_EXCEPTION(scope, JSValue());
    
    return result;
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteStatementSyncPrototypeFunctionRun, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSNodeSQLiteStatementSync*>(callFrame->thisValue());
    if (!thisObject) {
        return throwVMTypeError(globalObject, scope, "Expected StatementSync"_s);
    }
    
    JSObject* statement = thisObject->statement();
    if (!statement) {
        return throwVMError(globalObject, scope, "Statement is not valid"_s);
    }
    
    MarkedArgumentBuffer args;
    for (size_t i = 0; i < callFrame->argumentCount(); i++) {
        args.append(callFrame->argument(i));
    }
    
    JSValue result = callStatementMethod(globalObject, statement, "run"_s, args);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
    
    RELEASE_AND_RETURN(scope, JSValue::encode(result));
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteStatementSyncPrototypeFunctionGet, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSNodeSQLiteStatementSync*>(callFrame->thisValue());
    if (!thisObject) {
        return throwVMTypeError(globalObject, scope, "Expected StatementSync"_s);
    }
    
    JSObject* statement = thisObject->statement();
    if (!statement) {
        return throwVMError(globalObject, scope, "Statement is not valid"_s);
    }
    
    MarkedArgumentBuffer args;
    for (size_t i = 0; i < callFrame->argumentCount(); i++) {
        args.append(callFrame->argument(i));
    }
    
    JSValue result = callStatementMethod(globalObject, statement, "get"_s, args);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
    
    RELEASE_AND_RETURN(scope, JSValue::encode(result));
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteStatementSyncPrototypeFunctionAll, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSNodeSQLiteStatementSync*>(callFrame->thisValue());
    if (!thisObject) {
        return throwVMTypeError(globalObject, scope, "Expected StatementSync"_s);
    }
    
    JSObject* statement = thisObject->statement();
    if (!statement) {
        return throwVMError(globalObject, scope, "Statement is not valid"_s);
    }
    
    MarkedArgumentBuffer args;
    for (size_t i = 0; i < callFrame->argumentCount(); i++) {
        args.append(callFrame->argument(i));
    }
    
    JSValue result = callStatementMethod(globalObject, statement, "all"_s, args);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
    
    RELEASE_AND_RETURN(scope, JSValue::encode(result));
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteStatementSyncPrototypeFunctionValues, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSNodeSQLiteStatementSync*>(callFrame->thisValue());
    if (!thisObject) {
        return throwVMTypeError(globalObject, scope, "Expected StatementSync"_s);
    }
    
    JSObject* statement = thisObject->statement();
    if (!statement) {
        return throwVMError(globalObject, scope, "Statement is not valid"_s);
    }
    
    MarkedArgumentBuffer args;
    for (size_t i = 0; i < callFrame->argumentCount(); i++) {
        args.append(callFrame->argument(i));
    }
    
    JSValue result = callStatementMethod(globalObject, statement, "values"_s, args);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
    
    RELEASE_AND_RETURN(scope, JSValue::encode(result));
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteStatementSyncPrototypeFunctionFinalize, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSNodeSQLiteStatementSync*>(callFrame->thisValue());
    if (!thisObject) {
        return throwVMTypeError(globalObject, scope, "Expected StatementSync"_s);
    }
    
    JSObject* statement = thisObject->statement();
    if (!statement) {
        return throwVMError(globalObject, scope, "Statement is not valid"_s);
    }
    
    MarkedArgumentBuffer args;
    callStatementMethod(globalObject, statement, "finalize"_s, args, false);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
    
    // Clear the statement reference
    thisObject->m_statement.clear();
    
    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeSQLiteStatementSyncPrototype_sourceSQL, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSNodeSQLiteStatementSync*>(JSValue::decode(thisValue));
    if (!thisObject) {
        return throwVMTypeError(globalObject, scope, "Expected StatementSync"_s);
    }
    
    JSObject* statement = thisObject->statement();
    if (!statement) {
        return JSValue::encode(jsNull());
    }
    
    JSValue result = statement->get(globalObject, PropertyName(Identifier::fromString(vm, "native"_s)));
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsNull()));
    
    if (result.isObject()) {
        JSValue sql = result.getObject()->get(globalObject, PropertyName(Identifier::fromString(vm, "toString"_s)));
        RETURN_IF_EXCEPTION(scope, JSValue::encode(jsNull()));
        
        if (sql.isCallable()) {
            MarkedArgumentBuffer args;
            JSValue sqlResult = JSC::call(globalObject, sql, args, "SQL toString"_s);
            RETURN_IF_EXCEPTION(scope, JSValue::encode(jsNull()));
            return JSValue::encode(sqlResult);
        }
    }
    
    RELEASE_AND_RETURN(scope, JSValue::encode(jsNull()));
}

} // namespace Bun