#include "NativePromiseContext.h"

#include "ZigGlobalObject.h"

// Implemented in src/runtime/api/NativePromiseContext.rs. Switches on
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

NativePromiseContext* NativePromiseContext::create(JSC::VM& vm, JSC::Structure* structure, void* ctx, Tag tag, JSC::JSValue held)
{
    ASSERT(ctx);
    NativePromiseContext* cell = new (NotNull, JSC::allocateCell<NativePromiseContext>(vm))
        NativePromiseContext(vm, structure, ctx, tag);
    cell->finishCreation(vm);
    if (held)
        cell->m_held.set(vm, cell, held);
    return cell;
}

template<typename Visitor>
void NativePromiseContext::visitChildrenImpl(JSC::JSCell* cell, Visitor& visitor)
{
    auto* thisObject = static_cast<NativePromiseContext*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_held);
}

DEFINE_VISIT_CHILDREN(NativePromiseContext);

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

extern "C" JSC::EncodedJSValue Bun__NativePromiseContext__create(Zig::GlobalObject* globalObject, void* ctx, uint8_t tag, JSC::EncodedJSValue held)
{
    auto& vm = JSC::getVM(globalObject);
    auto* cell = Bun::NativePromiseContext::create(
        vm,
        globalObject->NativePromiseContextStructure(),
        ctx,
        static_cast<Bun::NativePromiseContext::Tag>(tag),
        JSC::JSValue::decode(held));
    return JSC::JSValue::encode(cell);
}

// Returns null (leaving the cell to its destructor) unless `encodedValue` is a
// NativePromiseContext created with `expectedTag`, so the Rust side can hand
// the pointer back as the type that tag names.
extern "C" void* Bun__NativePromiseContext__take(JSC::EncodedJSValue encodedValue, uint8_t expectedTag)
{
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    auto* cell = value ? dynamicDowncast<Bun::NativePromiseContext>(value) : nullptr;
    ASSERT_WITH_MESSAGE(cell, "NativePromiseContext::take on a foreign cell");
    if (!cell) [[unlikely]]
        return nullptr;
    ASSERT_WITH_MESSAGE(cell->tag() == static_cast<Bun::NativePromiseContext::Tag>(expectedTag), "NativePromiseContext::take with the wrong tag");
    if (cell->tag() != static_cast<Bun::NativePromiseContext::Tag>(expectedTag)) [[unlikely]]
        return nullptr;
    return cell->take();
}
