/**
 * This source code is licensed under the terms found in the LICENSE file in
 * node-jsc's root directory.
 */

#pragma once

#include "root.h"
#include "headers-handwritten.h"

#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/DebuggerPrimitives.h>
#include <JavaScriptCore/StackFrame.h>
#include "BunClientData.h"
#include "ZigGlobalObject.h"
#include "wtf/text/OrdinalNumber.h"

using namespace JSC;
using namespace WebCore;

namespace Zig {

// A frame as Error.prepareStackTrace sees it: a view over the record Bun::populateStackFrame
// derives, plus what only the JSC::StackFrame has (the callee, its strictness, the source ID).
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
        IsSloppyFunctionCall = 128,
        IsBuiltin = 256,
    };

private:
    JSC::WriteBarrier<JSC::Unknown> m_thisValue;
    JSC::WriteBarrier<JSC::Unknown> m_function;
    JSC::WriteBarrier<JSC::Unknown> m_functionName;
    // Empty for a frame with no source URL: fileName() stands in a placeholder for those.
    JSC::WriteBarrier<JSC::Unknown> m_sourceURL;
    OrdinalNumber m_lineNumber;
    OrdinalNumber m_columnNumber;
    intptr_t m_sourceID;
    unsigned int m_flags;

public:
    using Base = JSC::JSNonFinalObject;

    static CallSite* create(JSC::JSGlobalObject* globalObject, JSC::Structure* structure, const JSC::StackFrame& stackFrame, const ZigStackFrame& record, bool encounteredStrictFrame)
    {
        auto& vm = JSC::getVM(globalObject);
        CallSite* callSite = new (NotNull, JSC::allocateCell<CallSite>(vm)) CallSite(vm, structure);
        callSite->finishCreation(vm, stackFrame, record, encounteredStrictFrame);
        return callSite;
    }

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;

        return WebCore::subspaceForImpl<CallSite, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForCallSite, m_subspaceForCallSite));
    }

    JSC::JSValue thisValue() const { return m_thisValue.get(); }
    JSC::JSValue function() const { return m_function.get(); }
    JSC::JSValue functionName() const { return m_functionName.get(); }
    // What getFileName() returns: the source URL, or a placeholder for a frame that has none.
    JSC::JSString* fileName(JSC::VM&) const;
    OrdinalNumber lineNumber() const { return m_lineNumber; }
    OrdinalNumber columnNumber() const { return m_columnNumber; }
    intptr_t sourceID() const { return m_sourceID; }
    bool isEval() const { return m_flags & static_cast<unsigned int>(Flags::IsEval); }
    bool isConstructor() const { return m_flags & static_cast<unsigned int>(Flags::IsConstructor); }
    bool isStrict() const { return m_flags & static_cast<unsigned int>(Flags::IsStrict); }
    bool isNative() const { return m_flags & static_cast<unsigned int>(Flags::IsNative); }
    bool isWasm() const { return m_flags & static_cast<unsigned int>(Flags::IsWasm); }
    bool isBuiltin() const { return m_flags & static_cast<unsigned int>(Flags::IsBuiltin); }
    bool isAsync() const { return m_flags & static_cast<unsigned int>(Flags::IsAsync); }
    bool isSloppyFunctionCall() const { return m_flags & static_cast<unsigned int>(Flags::IsSloppyFunctionCall); }

    // The line of error.stack for this frame, without its "    at ".
    void formatAsString(JSC::VM& vm, JSC::JSGlobalObject* globalObject, WTF::StringBuilder& sb);

private:
    CallSite(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
        , m_lineNumber(OrdinalNumber::beforeFirst())
        , m_columnNumber(OrdinalNumber::beforeFirst())
        , m_sourceID(JSC::noSourceID)
        , m_flags(0)
    {
    }

    void finishCreation(VM& vm, const JSC::StackFrame& stackFrame, const ZigStackFrame& record, bool encounteredStrictFrame);

    DECLARE_VISIT_CHILDREN;
};

JSValue createNativeFrameForTesting(Zig::GlobalObject* globalObject);
}
