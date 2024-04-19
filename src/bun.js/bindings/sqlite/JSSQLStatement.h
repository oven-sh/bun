/*
 * Copyright (C) 2023 Codeblog Corp
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

#include "headers-handwritten.h"
#include "BunClientData.h"
#include <JavaScriptCore/CallFrame.h>

#ifndef LAZY_LOAD_SQLITE_DEFAULT_SETTING
#if defined(__APPLE__)
#define LAZY_LOAD_SQLITE_DEFAULT_SETTING 1
#endif
#endif

#ifndef LAZY_LOAD_SQLITE
#ifdef LAZY_LOAD_SQLITE_DEFAULT_SETTING
#define LAZY_LOAD_SQLITE LAZY_LOAD_SQLITE_DEFAULT_SETTING
#endif
#endif

#ifndef LAZY_LOAD_SQLITE
#define LAZY_LOAD_SQLITE 0
#endif

#if LAZY_LOAD_SQLITE
#include "sqlite3.h"
#else
#include "sqlite3_local.h"
#endif

namespace WebCore {

class JSSQLStatementConstructor final : public JSC::JSFunction {
public:
    using Base = JSC::JSFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSSQLStatementConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure);

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSFunctionType, StructureFlags), info());
    }

private:
    JSSQLStatementConstructor(JSC::VM& vm, NativeExecutable* native, JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, native, globalObject, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
static_assert(sizeof(JSSQLStatementConstructor) == sizeof(JSFunction), "Allocate JSSQLStatementConstructor in JSFunction IsoSubspace");
Structure* createJSSQLStatementStructure(JSGlobalObject* globalObject);

JSValue createJSSQLStatementConstructor(Zig::GlobalObject* globalObject);

} // namespace WebCore
