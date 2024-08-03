#include "v8/HandleScope.h"

#include "v8/GlobalInternals.h"

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
}

uintptr_t* HandleScope::CreateHandle(internal::Isolate* isolate, uintptr_t value)
{
    // TODO figure out if this is actually used directly
    V8_UNIMPLEMENTED();
    // return buffer->createHandle(value);
    return nullptr;
}

}
