#pragma once
#include "root.h"
#include <JavaScriptCore/DOMJITCallDOMGetterSnippet.h>
#include <JavaScriptCore/DOMJITGetterSetter.h>
#include <JavaScriptCore/DOMJITSignature.h>
#include <JavaScriptCore/FrameTracers.h>

// What the JIT compilers emit in place of a call to a member of an interface.
namespace Bun::Bindgen::DOMJIT {

using Snippet = Ref<JSC::DOMJIT::CallDOMGetterSnippet>;
using Effect = JSC::DOMJIT::Effect;
using HeapRange = JSC::DOMJIT::HeapRange;

// Two reads of one object are merged if they have the same number: it is unique among the members that an instance has.
template<uint16_t number> constexpr Effect readsAttribute = Effect::forDef(HeapRange::fromConstant<number, number + 1>());
// Not `top()`, which stands for the stack too.
constexpr Effect readsNativeState = Effect::forRead(HeapRange::fromConstant<0, UINT16_MAX - 1>());
constexpr Effect doesAnything {};

enum class Member : uint8_t {
    Bool,
    U8,
    U16,
    I32,
};

// It emits code that puts the answer in `result`, or else takes one of the jumps. It changes nothing but `result` and `scratch`.
using Shortcut = JSC::CCallHelpers::JumpList(JSC::CCallHelpers&, JSC::GPRReg result, JSC::GPRReg thisObject, JSC::GPRReg scratch);

Snippet tryOrCall(Shortcut*, JSC::GetValueFunc::Ptr, Effect);
Snippet loadFieldOrNull(unsigned offset, Effect);
Snippet loadFieldOrCall(unsigned offset, JSC::GetValueFunc::Ptr, Effect);
Snippet loadMember(unsigned offset, Member, Effect);
Snippet call(JSC::J_JITOperation_GP, Effect);

}

#define BINDGEN_OPERATION_PROLOGUE(globalObject)                    \
    auto& vm = JSC::getVM(globalObject);                            \
    IGNORE_WARNINGS_BEGIN("frame-address")                          \
    JSC::CallFrame* callFrame = DECLARE_CALL_FRAME(vm);             \
    IGNORE_WARNINGS_END                                             \
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame); \
    auto scope = DECLARE_THROW_SCOPE(vm)
