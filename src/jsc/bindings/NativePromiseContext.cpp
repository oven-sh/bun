#include "NativePromiseContext.h"

#include "ZigGlobalObject.h"

// Implemented in Zig (src/runtime/api/NativePromiseContext.zig). Switches on
// tag to release the ref on the right native type.
extern "C" void Bun__NativePromiseContext__destroy(void* ctx, uint8_t tag);

namespace Bun {

namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo NativePromiseContext::s_info = {
    "NativePromiseContext"_s,
    nullptr,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(NativePromiseContext)
};

NativePromiseContext* NativePromiseContext::create(JSC::VM& vm, JSC::Structure* structure, void* ctx, Tag tag)
{
    ASSERT(ctx);
    NativePromiseContext* cell = new (NotNull, JSC::allocateCell<NativePromiseContext>(vm))
        NativePromiseContext(vm, structure, ctx, tag);
    cell->finishCreation(vm);
    return cell;
}

NativePromiseContext::~NativePromiseContext()
{
    if (void* ctx = pointer()) {
        Bun__NativePromiseContext__destroy(ctx, static_cast<uint8_t>(tag()));
    }
}

void NativePromiseContext::destroy(JSC::JSCell* cell)
{
    static_cast<NativePromiseContext*>(cell)->~NativePromiseContext();
}

} // namespace Bun

extern "C" JSC::EncodedJSValue Bun__NativePromiseContext__create(Zig::GlobalObject* globalObject, void* ctx, uint8_t tag)
{
    auto& vm = JSC::getVM(globalObject);
    auto* cell = Bun::NativePromiseContext::create(
        vm,
        globalObject->NativePromiseContextStructure(),
        ctx,
        static_cast<Bun::NativePromiseContext::Tag>(tag));
    return JSC::JSValue::encode(cell);
}

extern "C" void* Bun__NativePromiseContext__take(JSC::EncodedJSValue encodedValue)
{
    auto* cell = uncheckedDowncast<Bun::NativePromiseContext>(JSC::JSValue::decode(encodedValue));
    return cell->take();
}
