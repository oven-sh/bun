#include "V8HandleScope.h"
#include "shim/GlobalInternals.h"
#include "v8_compatibility_assertions.h"

// I haven't found an inlined function which accesses HandleScope fields, so I'm assuming the field
// offsets do *not* need to match (also, our fields have different types and meanings anyway).
// But the size must match, because if our HandleScope is too big it'll clobber other stack variables.
ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::HandleScope)

namespace v8 {

HandleScope::HandleScope(Isolate* isolate)
    : m_isolate(isolate)
    , m_previousHandleScope(m_isolate->globalInternals()->currentHandleScope())
    , m_buffer(shim::HandleScopeBuffer::create(
          isolate->vm(),
          isolate->globalInternals()->handleScopeBufferStructure(isolate->globalObject())))
{
    m_isolate->globalInternals()->setCurrentHandleScope(this);
}

HandleScope::~HandleScope()
{
    m_isolate->globalInternals()->setCurrentHandleScope(m_previousHandleScope);
    m_buffer->clear();
    m_buffer = nullptr;
}

uintptr_t* HandleScope::CreateHandle(internal::Isolate* i_isolate, uintptr_t value)
{
    auto* isolate = reinterpret_cast<Isolate*>(i_isolate);
    auto* handleScope = isolate->globalInternals()->currentHandleScope();
    TaggedPointer* newSlot = handleScope->m_buffer->createHandleFromExistingObject(TaggedPointer::fromRaw(value), isolate);
    // basically a reinterpret
    return newSlot->asRawPtrLocation();
}

} // namespace v8
