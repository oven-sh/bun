#include "V8HandleScope.h"

#include "V8GlobalInternals.h"

namespace v8 {

HandleScope::HandleScope(Isolate* isolate_)
    : m_isolate(isolate_)
    , m_previousHandleScope(m_isolate->globalInternals()->currentHandleScope())
    , m_buffer(HandleScopeBuffer::create(isolate_->vm(), isolate_->globalInternals()->handleScopeBufferStructure(isolate_->globalObject())))
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
    return &newSlot->m_value;
}

}
