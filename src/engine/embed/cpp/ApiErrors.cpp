#include "engine/Engine.h"

namespace JSC {

void VM::setOnComputeErrorInfo(ErrorInfoFunction&& function)
{
    m_onComputeErrorInfo = WTF::move(function);
    Engine::vm_hook_format_stack_frames(*this);
}

void VM::setOnComputeErrorInfoJSValue(ErrorInfoFunctionJSValue&& function)
{
    m_onComputeErrorInfoJSValue = WTF::move(function);
    Engine::vm_hook_compute_stack(*this);
}

void VM::setComputeLineColumnWithSourcemap(Function<void(VM&, SourceProvider*, LineColumn&, String&)>&& function)
{
    m_computeLineColumnWithSourcemap = WTF::move(function);
    Engine::vm_hook_map_position(*this);
}

static String& asString(StringImpl** slot) { return *reinterpret_cast<String*>(slot); }

extern "C" EncodedJSValue engine_host_compute_stack(VM* vm, ErrorInstance* error, LineColumn* position, StringImpl** sourceURL)
{
    return JSValue::encode(vm->onComputeErrorInfoJSValue()(*vm, *error->stackTrace(), position->line, position->column, asString(sourceURL), error));
}

extern "C" StringImpl* engine_host_format_stack_frames(VM* vm, Vector<StackFrame>* frames, LineColumn* position, StringImpl** sourceURL)
{
    return Engine::leak(vm->onComputeErrorInfo()(*vm, *frames, position->line, position->column, asString(sourceURL)));
}

extern "C" void engine_host_map_position(VM* vm, SourceProvider* provider, LineColumn* position, StringImpl** sourceURL)
{
    vm->computeLineColumnWithSourcemap()(*vm, provider, *position, asString(sourceURL));
}

} // namespace JSC
