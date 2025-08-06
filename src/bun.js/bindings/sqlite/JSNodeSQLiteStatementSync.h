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

#pragma once

#include "root.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/JSDestructibleObject.h>

#include "headers-handwritten.h"
#include "BunClientData.h"
#include <JavaScriptCore/CallFrame.h>

namespace Bun {

using namespace JSC;
using namespace WebCore;

class JSNodeSQLiteDatabaseSync;

class JSNodeSQLiteStatementSync final : public JSC::JSDestructibleObject {
    using Base = JSC::JSDestructibleObject;

public:
    static constexpr unsigned StructureFlags = Base::StructureFlags | HasStaticPropertyTable;
    static constexpr bool needsDestruction = true;

    static JSNodeSQLiteStatementSync* create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* statement, JSNodeSQLiteDatabaseSync* database);
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype);

    DECLARE_INFO;

    template<typename CellType, SubspaceAccess>
    static CompleteSubspace* subspaceFor(VM& vm)
    {
        return &vm.destructibleObjectSpace();
    }

    JSObject* statement() const { return m_statement.get(); }
    JSNodeSQLiteDatabaseSync* database() const { return m_database.get(); }

private:
    JSNodeSQLiteStatementSync(VM& vm, Structure* structure);

    void finishCreation(VM& vm, JSGlobalObject* globalObject, JSObject* statement, JSNodeSQLiteDatabaseSync* database);

    DECLARE_VISIT_CHILDREN;

    WriteBarrier<JSObject> m_statement;
    WriteBarrier<JSNodeSQLiteDatabaseSync> m_database;
};

JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncPrototypeFunctionRun);
JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncPrototypeFunctionGet);
JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncPrototypeFunctionAll);
JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncPrototypeFunctionValues);
JSC_DECLARE_HOST_FUNCTION(jsNodeSQLiteStatementSyncPrototypeFunctionFinalize);
JSC_DECLARE_CUSTOM_GETTER(jsNodeSQLiteStatementSyncPrototype_sourceSQL);

} // namespace Bun