#pragma once

#include "v8.h"
#include "v8/Isolate.h"
#include "v8/internal.h"
#include "v8/HandleScopeBuffer.h"

namespace v8 {

class Isolate;

class HandleScope {
public:
    BUN_EXPORT HandleScope(Isolate* isolate);
    BUN_EXPORT ~HandleScope();
    BUN_EXPORT uintptr_t* CreateHandle(internal::Isolate* isolate, uintptr_t value);

    template<typename T> Local<T> createLocal(TaggedPointer tagged)
    {
        TaggedPointer* handle = reinterpret_cast<TaggedPointer*>(buffer->createHandle(tagged.value));
        return Local<T>(handle);
    }

private:
    // must be 24 bytes to match V8 layout
    Isolate* isolate;
    HandleScope* prev;
    HandleScopeBuffer* buffer;
};

}
