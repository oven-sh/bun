#pragma once

#include "v8.h"
#include "v8/Isolate.h"
#include "v8/internal.h"
#include "v8/HandleScopeBuffer.h"

namespace v8 {

class Isolate;
class Number;

class HandleScope {
public:
    BUN_EXPORT HandleScope(Isolate* isolate);
    BUN_EXPORT ~HandleScope();
    BUN_EXPORT uintptr_t* CreateHandle(internal::Isolate* isolate, uintptr_t value);

    template<typename T> Local<T> createLocal(JSCell* object)
    {
        TaggedPointer* handle = buffer->createHandle(object);
        return Local<T>(handle);
    }

    Local<Number> createLocalSmi(int32_t smi)
    {
        TaggedPointer* handle = buffer->createSmiHandle(smi);
        return Local<Number>(handle);
    }

private:
    // must be 24 bytes to match V8 layout
    Isolate* isolate;
    HandleScope* prev;
    HandleScopeBuffer* buffer;
};

}
