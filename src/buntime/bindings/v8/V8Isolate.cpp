#include "V8Isolate.h"
#include "V8HandleScope.h"
#include "shim/GlobalInternals.h"
#include "ZigGlobalObject.h"
#include "real_v8.h"
#include "v8_compatibility_assertions.h"

static_assert(offsetof(v8::Isolate, m_roots) == real_v8::internal::Internals::kIsolateRootsOffset, "Isolate roots array is at wrong offset");

#define CHECK_ROOT_INDEX(NAME)                                                                                                                \
    static_assert(v8::Isolate::NAME == real_v8::internal::Internals::NAME, "Isolate root index " #NAME " does not match between Bun and V8"); \
    static_assert(v8::Isolate::NAME < std::tuple_size_v<decltype(v8::Isolate::m_roots)>, "Bun v8::Isolate roots array is too small for index " #NAME);

CHECK_ROOT_INDEX(kUndefinedValueRootIndex)
CHECK_ROOT_INDEX(kTheHoleValueRootIndex)
CHECK_ROOT_INDEX(kNullValueRootIndex)
CHECK_ROOT_INDEX(kTrueValueRootIndex)
CHECK_ROOT_INDEX(kFalseValueRootIndex)

namespace v8 {

// Returns the isolate inside which the current thread is running or nullptr.
Isolate* Isolate::TryGetCurrent()
{
    auto* global = defaultGlobalObject();

    return global ? &global->V8GlobalInternals()->m_isolate : nullptr;
}

// Returns the isolate inside which the current thread is running.
Isolate* Isolate::GetCurrent()
{
    auto* global = defaultGlobalObject();

    return global ? &global->V8GlobalInternals()->m_isolate : nullptr;
}

Local<Context> Isolate::GetCurrentContext()
{
    return currentHandleScope()->createLocal<Context>(m_globalObject->vm(), m_globalObject);
}

Isolate::Isolate(shim::GlobalInternals* globalInternals)
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

} // namespace v8
