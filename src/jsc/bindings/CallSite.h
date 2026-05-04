/**
 * This source code is licensed under the terms found in the LICENSE file in
 * node-jsc's root directory.
 */

#pragma once

#include "ErrorStackTrace.h"

#include <JavaScriptCore/JSObject.h>
#include "BunClientData.h"
#include "wtf/text/OrdinalNumber.h"

using namespace JSC;
using namespace WebCore;

namespace Zig {

class JSCStackFrame;

class CallSite final : public JSC::JSNonFinalObject {
public:
    enum class Flags {
        IsStrict = 1,
        IsEval = 2,
        IsConstructor = 4,
        IsNative = 8,
        IsWasm = 16,
        IsFunction = 32,
        IsAsync = 64,
    };

private:
    JSC::WriteBarrier<JSC::Unknown> m_thisValue;
    JSC::WriteBarrier<JSC::Unknown> m_function;
    JSC::WriteBarrier<JSC::Unknown> m_functionName;
    JSC::WriteBarrier<JSC::Unknown> m_sourceURL;
    OrdinalNumber m_lineNumber;
    OrdinalNumber m_columnNumber;
    unsigned int m_flags;

public:
    using Base = JSC::JSNonFinalObject;

    static CallSite* create(JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSCStackFrame& stackFrame, bool encounteredStrictFrame)
    {
        auto& vm = JSC::getVM(globalObject);
        CallSite* callSite = new (NotNull, JSC::allocateCell<CallSite>(vm)) CallSite(vm, structure);
        callSite->finishCreation(vm, globalObject, stackFrame, encounteredStrictFrame);
        return callSite;
    }

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;

        return WebCore::subspaceForImpl<CallSite, UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForCallSite.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForCallSite = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForCallSite.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForCallSite = std::forward<decltype(space)>(space); });
    }

    JSC::JSValue thisValue() const { return m_thisValue.get(); }
    JSC::JSValue function() const { return m_function.get(); }
    JSC::JSValue functionName() const { return m_functionName.get(); }
    JSC::JSValue sourceURL() const { return m_sourceURL.get(); }
    OrdinalNumber lineNumber() const { return m_lineNumber; }
    OrdinalNumber columnNumber() const { return m_columnNumber; }
    bool isEval() const { return m_flags & static_cast<unsigned int>(Flags::IsEval); }
    bool isConstructor() const { return m_flags & static_cast<unsigned int>(Flags::IsConstructor); }
    bool isStrict() const { return m_flags & static_cast<unsigned int>(Flags::IsStrict); }
    bool isNative() const { return m_flags & static_cast<unsigned int>(Flags::IsNative); }
    bool isAsync() const { return m_flags & static_cast<unsigned int>(Flags::IsAsync); }

    void setLineNumber(OrdinalNumber lineNumber) { m_lineNumber = lineNumber; }
    void setColumnNumber(OrdinalNumber columnNumber) { m_columnNumber = columnNumber; }
    void setSourceURL(JSC::VM& vm, JSC::JSString* sourceURL) { m_sourceURL.set(vm, this, sourceURL); }

    void formatAsString(JSC::VM& vm, JSC::JSGlobalObject* globalObject, WTF::StringBuilder& sb);

private:
    CallSite(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
        , m_lineNumber(OrdinalNumber::beforeFirst())
        , m_columnNumber(OrdinalNumber::beforeFirst())
        , m_flags(0)
    {
    }

    void finishCreation(VM& vm, JSC::JSGlobalObject* globalObject, JSCStackFrame& stackFrame, bool encounteredStrictFrame);

    DECLARE_VISIT_CHILDREN;
};

JSValue createNativeFrameForTesting(Zig::GlobalObject* globalObject);
}
