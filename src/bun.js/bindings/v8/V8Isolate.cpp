#include "V8Isolate.h"
#include "V8HandleScope.h"
#include "V8GlobalInternals.h"

namespace v8 {

// Returns the isolate inside which the current thread is running or nullptr.
Isolate* Isolate::TryGetCurrent()
{
    auto* global = Bun__getDefaultGlobalObject();

    return global ? &global->V8GlobalInternals()->m_isolate : nullptr;
}

// Returns the isolate inside which the current thread is running.
Isolate* Isolate::GetCurrent()
{
    auto* global = Bun__getDefaultGlobalObject();

    return global ? &global->V8GlobalInternals()->m_isolate : nullptr;
}

Local<Context> Isolate::GetCurrentContext()
{
    return currentHandleScope()->createLocal<Context>(m_globalObject->vm(), m_globalObject);
}

Isolate::Isolate(GlobalInternals* globalInternals)
    : m_globalInternals(globalInternals)
    , m_globalObject(globalInternals->m_globalObject)
{
    m_roots[kUndefinedValueRootIndex] = TaggedPointer(&globalInternals->m_undefinedValue);
    m_roots[kNullValueRootIndex] = TaggedPointer(&globalInternals->m_nullValue);
    m_roots[kTrueValueRootIndex] = TaggedPointer(&globalInternals->m_trueValue);
    m_roots[kFalseValueRootIndex] = TaggedPointer(&globalInternals->m_falseValue);
}

HandleScope* Isolate::currentHandleScope()
{
    return m_globalInternals->currentHandleScope();
}

}
