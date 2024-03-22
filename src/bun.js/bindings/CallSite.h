/**
 * This source code is licensed under the terms found in the LICENSE file in
 * node-jsc's root directory.
 */

#pragma once

#include "ErrorStackTrace.h"

#include <JavaScriptCore/JSObject.h>
#include "BunClientData.h"

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
    };

private:
    JSC::WriteBarrier<JSC::Unknown> m_thisValue;
    JSC::WriteBarrier<JSC::Unknown> m_function;
    JSC::WriteBarrier<JSC::Unknown> m_functionName;
    JSC::WriteBarrier<JSC::Unknown> m_sourceURL;
    int32_t m_lineNumber = -1;
    int32_t m_columnNumber = -1;
    unsigned int m_flags;

public:
    using Base = JSC::JSNonFinalObject;

    static CallSite* create(JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSCStackFrame& stackFrame, bool encounteredStrictFrame)
    {
        JSC::VM& vm = globalObject->vm();
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
    int32_t lineNumber() const { return m_lineNumber; }
    int32_t columnNumber() const { return m_columnNumber; }
    bool isEval() const { return m_flags & static_cast<unsigned int>(Flags::IsEval); }
    bool isConstructor() const { return m_flags & static_cast<unsigned int>(Flags::IsConstructor); }
    bool isStrict() const { return m_flags & static_cast<unsigned int>(Flags::IsStrict); }
    bool isNative() const { return m_flags & static_cast<unsigned int>(Flags::IsNative); }

    void setLineNumber(int32_t lineNumber) { m_lineNumber = lineNumber; }
    void setColumnNumber(int32_t columnNumber) { m_columnNumber = columnNumber; }

    void formatAsString(JSC::VM& vm, JSC::JSGlobalObject* globalObject, WTF::StringBuilder& sb);

private:
    CallSite(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
        , m_lineNumber(-1)
        , m_columnNumber(-1)
        , m_flags(0)
    {
    }

    void finishCreation(VM& vm, JSC::JSGlobalObject* globalObject, JSCStackFrame& stackFrame, bool encounteredStrictFrame);

    DECLARE_VISIT_CHILDREN;
};

}
