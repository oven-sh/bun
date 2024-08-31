#include "V8HandleScope.h"

#include "V8GlobalInternals.h"

namespace v8 {

HandleScope::HandleScope(Isolate* isolate_)
    : isolate(isolate_)
    , prev(isolate->globalInternals()->currentHandleScope())
    , buffer(HandleScopeBuffer::create(isolate_->vm(), isolate_->globalInternals()->handleScopeBufferStructure(isolate_->globalObject())))
{
    isolate->globalInternals()->setCurrentHandleScope(this);
}

HandleScope::~HandleScope()
{
    isolate->globalInternals()->setCurrentHandleScope(prev);
    buffer->clear();
    buffer = nullptr;
}

uintptr_t* HandleScope::CreateHandle(internal::Isolate* i_isolate, uintptr_t value)
{
    auto* isolate = reinterpret_cast<Isolate*>(i_isolate);
    auto* handleScope = isolate->globalInternals()->currentHandleScope();
    TaggedPointer* newSlot = handleScope->buffer->createHandleFromExistingObject(TaggedPointer::fromRaw(value), isolate);
    // basically a reinterpret
    return &newSlot->value;
}

}
