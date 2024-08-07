#pragma once

#include "v8.h"
#include "v8/Isolate.h"
#include "v8/internal.h"
#include "v8/HandleScopeBuffer.h"

namespace v8 {

class Number;

class HandleScope {
public:
    BUN_EXPORT HandleScope(Isolate* isolate);
    BUN_EXPORT ~HandleScope();
    BUN_EXPORT uintptr_t* CreateHandle(internal::Isolate* isolate, uintptr_t value);

    template<typename T> Local<T> createLocal(JSC::JSValue value)
    {
        // TODO(@190n) handle more types
        if (value.isCell()) {
            return Local<T>(buffer->createHandle(value.asCell(), &Map::object_map));
        } else if (value.isInt32()) {
            return Local<T>(buffer->createSmiHandle(value.asInt32()));
        } else if (value.isUndefined()) {
            return Local<T>(isolate->globalInternals()->undefinedSlot());
        } else if (value.isNull()) {
            return Local<T>(isolate->globalInternals()->nullSlot());
        } else if (value.isTrue()) {
            return Local<T>(isolate->globalInternals()->trueSlot());
        } else if (value.isFalse()) {
            return Local<T>(isolate->globalInternals()->falseSlot());
        } else {
            V8_UNIMPLEMENTED();
            return Local<T>();
        }
    }

    template<typename T> Local<T> createRawLocal(void* ptr)
    {
        TaggedPointer* handle = buffer->createHandle(ptr, &Map::raw_ptr_map);
        return Local<T>(handle);
    }

    friend class EscapableHandleScopeBase;

protected:
    // must be 24 bytes to match V8 layout
    Isolate* isolate;
    HandleScope* prev;
    HandleScopeBuffer* buffer;
};

static_assert(sizeof(HandleScope) == 24, "HandleScope has wrong layout");

}
