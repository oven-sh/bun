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
#include "JSNodeSQLiteDatabaseSync.h"
#include "JSNodeSQLiteStatementSync.h"
#include "JSSQLStatement.h"

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

const ClassInfo JSNodeSQLiteDatabaseSync::s_info = { "DatabaseSync"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodeSQLiteDatabaseSync) };

JSNodeSQLiteDatabaseSync* JSNodeSQLiteDatabaseSync::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, const String& filename, JSObject* options)
{
    auto* instance = new (NotNull, allocateCell<JSNodeSQLiteDatabaseSync>(vm)) JSNodeSQLiteDatabaseSync(vm, structure);
    instance->finishCreation(vm, globalObject, filename, options);
    return instance;
}

Structure* JSNodeSQLiteDatabaseSync::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSNodeSQLiteDatabaseSync::JSNodeSQLiteDatabaseSync(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSNodeSQLiteDatabaseSync::finishCreation(VM& vm, JSGlobalObject* globalObject, const String& filename, JSObject* options)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    
    // Create options for underlying Database
    JSObject* bunOptions = constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
    
    if (options) {
        
        // Convert Node.js options to Bun options
        JSValue readOnlyValue = options->get(globalObject, PropertyName(Identifier::fromString(vm, "readOnly"_s)));
        if (readOnlyValue.isBoolean()) {
            bunOptions->putDirect(vm, PropertyName(Identifier::fromString(vm, "readonly"_s)), readOnlyValue);
        }
        
        // TODO: Process Node.js options like timeout, enableForeignKeys, readBigInts, returnArrays
        // For now, we just pass along the readOnly flag to Bun
        
        RETURN_IF_EXCEPTION(throwScope, );
    }
    
    // Create the underlying Bun Database
    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    
    // Get the BunSql module
    JSValue sqliteModule = zigGlobalObject->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::BunSql);
    RETURN_IF_EXCEPTION(throwScope, );
    
    // Get the Database constructor from the default export
    JSValue databaseConstructor = sqliteModule.get(globalObject, vm.propertyNames->defaultKeyword);
    RETURN_IF_EXCEPTION(throwScope, );
    
    if (!databaseConstructor.isConstructor()) {
        throwTypeError(globalObject, throwScope, "Database is not a constructor"_s);
        return;
    }
    
    if (databaseConstructor.isConstructor()) {
        MarkedArgumentBuffer args;
        args.append(jsString(vm, filename));
        args.append(bunOptions);
        
        JSValue result = JSC::construct(globalObject, databaseConstructor, args, "Database constructor"_s);
        RETURN_IF_EXCEPTION(throwScope, );
        
        if (result.isObject()) {
            m_database.set(vm, this, result.getObject());
        }
    }
}

DEFINE_VISIT_CHILDREN(JSNodeSQLiteDatabaseSync);

template<typename Visitor>
void JSNodeSQLiteDatabaseSync::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<JSNodeSQLiteDatabaseSync*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(cell, visitor);
    visitor.append(thisObject->m_database);
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncPrototypeFunctionPrepare, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSNodeSQLiteDatabaseSync*>(callFrame->thisValue());
    if (!thisObject) {
        return throwVMTypeError(globalObject, scope, "Expected DatabaseSync"_s);
    }
    
    if (callFrame->argumentCount() < 1) {
        return throwVMTypeError(globalObject, scope, "Missing required argument: sql"_s);
    }
    
    JSValue sqlValue = callFrame->argument(0);
    if (!sqlValue.isString()) {
        return throwVMTypeError(globalObject, scope, "SQL must be a string"_s);
    }
    
    String sql = sqlValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
    
    // Call the underlying database.query() method
    JSObject* database = thisObject->database();
    if (!database) {
        return throwVMError(globalObject, scope, "Database is not open"_s);
    }
    
    JSValue queryMethod = database->get(globalObject, PropertyName(Identifier::fromString(vm, "query"_s)));
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
    
    if (!queryMethod.isCallable()) {
        return throwVMError(globalObject, scope, "Database query method is not callable"_s);
    }
    
    MarkedArgumentBuffer args;
    args.append(sqlValue);
    
    JSValue statement = JSC::call(globalObject, queryMethod, args, "Database prepare"_s);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
    
    // Wrap the statement in JSNodeSQLiteStatementSync
    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSNodeSQLiteStatementSyncStructure();
    
    auto* statementSync = JSNodeSQLiteStatementSync::create(vm, globalObject, structure, statement.getObject(), thisObject);
    
    RELEASE_AND_RETURN(scope, JSValue::encode(statementSync));
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncPrototypeFunctionExec, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSNodeSQLiteDatabaseSync*>(callFrame->thisValue());
    if (!thisObject) {
        return throwVMTypeError(globalObject, scope, "Expected DatabaseSync"_s);
    }
    
    if (callFrame->argumentCount() < 1) {
        return throwVMTypeError(globalObject, scope, "Missing required argument: sql"_s);
    }
    
    JSValue sqlValue = callFrame->argument(0);
    if (!sqlValue.isString()) {
        return throwVMTypeError(globalObject, scope, "SQL must be a string"_s);
    }
    
    // Call the underlying database.exec() method
    JSObject* database = thisObject->database();
    if (!database) {
        return throwVMError(globalObject, scope, "Database is not open"_s);
    }
    
    JSValue execMethod = database->get(globalObject, PropertyName(Identifier::fromString(vm, "exec"_s)));
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
    
    if (!execMethod.isCallable()) {
        return throwVMError(globalObject, scope, "Database exec method is not callable"_s);
    }
    
    MarkedArgumentBuffer args;
    args.append(sqlValue);
    
    JSValue result = JSC::call(globalObject, execMethod, args, "Database exec"_s);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
    
    RELEASE_AND_RETURN(scope, JSValue::encode(result));
}

JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteDatabaseSyncPrototypeFunctionClose, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSNodeSQLiteDatabaseSync*>(callFrame->thisValue());
    if (!thisObject) {
        return throwVMTypeError(globalObject, scope, "Expected DatabaseSync"_s);
    }
    
    // Call the underlying database.close() method
    JSObject* database = thisObject->database();
    if (database) {
        JSValue closeMethod = database->get(globalObject, PropertyName(Identifier::fromString(vm, "close"_s)));
        RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
        
        if (closeMethod.isCallable()) {
            MarkedArgumentBuffer args;
            JSC::call(globalObject, closeMethod, args, "Database close"_s);
        }
        
        thisObject->m_database.clear();
    }
    
    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}

} // namespace Bun