#include "NativeMicrotaskContext.h"

namespace Bun {

const JSC::ClassInfo NativeMicrotaskContext::s_info = {
    "NativeMicrotaskContext"_s,
    nullptr,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(NativeMicrotaskContext)
};

NativeMicrotaskContext* NativeMicrotaskContext::create(JSC::VM& vm, JSC::Structure* structure, void* ctx, Callback run, Callback drop)
{
    ASSERT(ctx && run && drop);
    NativeMicrotaskContext* cell = new (NotNull, JSC::allocateCell<NativeMicrotaskContext>(vm))
        NativeMicrotaskContext(vm, structure, ctx, run, drop);
    cell->finishCreation(vm);
    return cell;
}

void NativeMicrotaskContext::run()
{
    void* ctx = std::exchange(m_ctx, nullptr);
    ASSERT(ctx);
    m_run(ctx);
}

NativeMicrotaskContext::~NativeMicrotaskContext()
{
    if (void* ctx = std::exchange(m_ctx, nullptr))
        m_drop(ctx);
}

void NativeMicrotaskContext::destroy(JSC::JSCell* cell)
{
    static_cast<NativeMicrotaskContext*>(cell)->~NativeMicrotaskContext();
}

} // namespace Bun
