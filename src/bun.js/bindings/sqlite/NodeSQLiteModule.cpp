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
#include "NodeSQLiteModule.h"
#include "JSNodeSQLiteDatabaseSync.h"
#include "JSNodeSQLiteStatementSync.h"

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

namespace Bun {

using namespace JSC;
using namespace WebCore;

// DatabaseSync Constructor
JSC_DEFINE_HOST_FUNCTION(jsDatabaseSyncConstructor, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    if (callFrame->argumentCount() < 1) {
        return throwVMTypeError(globalObject, scope, "Missing required argument: filename"_s);
    }
    
    JSValue filenameValue = callFrame->argument(0);
    if (!filenameValue.isString()) {
        return throwVMTypeError(globalObject, scope, "Filename must be a string"_s);
    }
    
    String filename = filenameValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
    
    JSObject* options = nullptr;
    if (callFrame->argumentCount() > 1 && callFrame->argument(1).isObject()) {
        options = callFrame->argument(1).getObject();
    }
    
    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->JSNodeSQLiteDatabaseSyncStructure();
    
    auto* database = JSNodeSQLiteDatabaseSync::create(vm, globalObject, structure, filename, options);
    
    RELEASE_AND_RETURN(scope, JSValue::encode(database));
}

// StatementSync Constructor (should not be called directly)
JSC_DEFINE_HOST_FUNCTION(jsStatementSyncConstructor, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    return throwVMTypeError(globalObject, scope, "StatementSync cannot be constructed directly"_s);
}

// backup function
JSC_DEFINE_HOST_FUNCTION(jsNodeSQLiteBackup, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    // TODO: Implement backup functionality
    return throwVMError(globalObject, scope, "backup() is not yet implemented"_s);
}

// Create DatabaseSync prototype
static JSObject* createDatabaseSyncPrototype(VM& vm, JSGlobalObject* globalObject)
{
    auto* prototype = constructEmptyObject(globalObject, globalObject->objectPrototype(), 3);
    
    // Add methods to prototype
    prototype->putDirect(vm, PropertyName(Identifier::fromString(vm, "prepare"_s)), 
        JSFunction::create(vm, globalObject, 1, "prepare"_s, jsNodeSQLiteDatabaseSyncPrototypeFunctionPrepare, ImplementationVisibility::Public, NoIntrinsic, jsNodeSQLiteDatabaseSyncPrototypeFunctionPrepare));
    
    prototype->putDirect(vm, PropertyName(Identifier::fromString(vm, "exec"_s)), 
        JSFunction::create(vm, globalObject, 1, "exec"_s, jsNodeSQLiteDatabaseSyncPrototypeFunctionExec, ImplementationVisibility::Public, NoIntrinsic, jsNodeSQLiteDatabaseSyncPrototypeFunctionExec));
    
    prototype->putDirect(vm, PropertyName(Identifier::fromString(vm, "close"_s)), 
        JSFunction::create(vm, globalObject, 0, "close"_s, jsNodeSQLiteDatabaseSyncPrototypeFunctionClose, ImplementationVisibility::Public, NoIntrinsic, jsNodeSQLiteDatabaseSyncPrototypeFunctionClose));
    
    return prototype;
}

// Create StatementSync prototype
static JSObject* createStatementSyncPrototype(VM& vm, JSGlobalObject* globalObject)
{
    auto* prototype = constructEmptyObject(globalObject, globalObject->objectPrototype(), 3);
    
    // Add methods to prototype
    prototype->putDirect(vm, PropertyName(Identifier::fromString(vm, "run"_s)), 
        JSFunction::create(vm, globalObject, 0, "run"_s, jsNodeSQLiteStatementSyncPrototypeFunctionRun, ImplementationVisibility::Public, NoIntrinsic, jsNodeSQLiteStatementSyncPrototypeFunctionRun));
    
    prototype->putDirect(vm, PropertyName(Identifier::fromString(vm, "get"_s)), 
        JSFunction::create(vm, globalObject, 0, "get"_s, jsNodeSQLiteStatementSyncPrototypeFunctionGet, ImplementationVisibility::Public, NoIntrinsic, jsNodeSQLiteStatementSyncPrototypeFunctionGet));
    
    prototype->putDirect(vm, PropertyName(Identifier::fromString(vm, "all"_s)), 
        JSFunction::create(vm, globalObject, 0, "all"_s, jsNodeSQLiteStatementSyncPrototypeFunctionAll, ImplementationVisibility::Public, NoIntrinsic, jsNodeSQLiteStatementSyncPrototypeFunctionAll));
    
    prototype->putDirect(vm, PropertyName(Identifier::fromString(vm, "values"_s)), 
        JSFunction::create(vm, globalObject, 0, "values"_s, jsNodeSQLiteStatementSyncPrototypeFunctionValues, ImplementationVisibility::Public, NoIntrinsic, jsNodeSQLiteStatementSyncPrototypeFunctionValues));
    
    prototype->putDirect(vm, PropertyName(Identifier::fromString(vm, "finalize"_s)), 
        JSFunction::create(vm, globalObject, 0, "finalize"_s, jsNodeSQLiteStatementSyncPrototypeFunctionFinalize, ImplementationVisibility::Public, NoIntrinsic, jsNodeSQLiteStatementSyncPrototypeFunctionFinalize));
    
    // Add sourceSQL getter
    auto* getterSetter = CustomGetterSetter::create(vm, jsNodeSQLiteStatementSyncPrototype_sourceSQL, nullptr);
    prototype->putDirectCustomAccessor(vm, PropertyName(Identifier::fromString(vm, "sourceSQL"_s)), getterSetter, PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor);
    
    return prototype;
}

void generateNodeSQLiteModule(JSGlobalObject* globalObject, JSObject* moduleExports)
{
    VM& vm = globalObject->vm();
    auto* zigGlobalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    
    // Use the LazyClassStructure that was set up in ZigGlobalObject.h
    auto* databaseSyncConstructor = zigGlobalObject->JSNodeSQLiteDatabaseSyncConstructor();
    auto* statementSyncConstructor = zigGlobalObject->JSNodeSQLiteStatementSyncConstructor();
    
    // Export DatabaseSync and StatementSync
    moduleExports->putDirect(vm, PropertyName(Identifier::fromString(vm, "DatabaseSync"_s)), databaseSyncConstructor);
    moduleExports->putDirect(vm, PropertyName(Identifier::fromString(vm, "StatementSync"_s)), statementSyncConstructor);
    
    // Export backup function
    auto* backupFunction = JSFunction::create(vm, globalObject, 2, "backup"_s, jsNodeSQLiteBackup, ImplementationVisibility::Public, NoIntrinsic, jsNodeSQLiteBackup);
    moduleExports->putDirect(vm, PropertyName(Identifier::fromString(vm, "backup"_s)), backupFunction);
    
    // Export constants
    auto* constants = constructEmptyObject(globalObject, globalObject->objectPrototype(), 6);
    
    // SQLite changeset constants
    constants->putDirect(vm, PropertyName(Identifier::fromString(vm, "SQLITE_CHANGESET_OMIT"_s)), jsNumber(0));
    constants->putDirect(vm, PropertyName(Identifier::fromString(vm, "SQLITE_CHANGESET_REPLACE"_s)), jsNumber(1));
    constants->putDirect(vm, PropertyName(Identifier::fromString(vm, "SQLITE_CHANGESET_ABORT"_s)), jsNumber(2));
    constants->putDirect(vm, PropertyName(Identifier::fromString(vm, "SQLITE_CHANGESET_DATA"_s)), jsNumber(1));
    constants->putDirect(vm, PropertyName(Identifier::fromString(vm, "SQLITE_CHANGESET_NOTFOUND"_s)), jsNumber(2));
    constants->putDirect(vm, PropertyName(Identifier::fromString(vm, "SQLITE_CHANGESET_CONFLICT"_s)), jsNumber(3));
    constants->putDirect(vm, PropertyName(Identifier::fromString(vm, "SQLITE_CHANGESET_CONSTRAINT"_s)), jsNumber(4));
    constants->putDirect(vm, PropertyName(Identifier::fromString(vm, "SQLITE_CHANGESET_FOREIGN_KEY"_s)), jsNumber(5));
    
    moduleExports->putDirect(vm, PropertyName(Identifier::fromString(vm, "constants"_s)), constants);
}

} // namespace Bun