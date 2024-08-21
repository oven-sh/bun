#pragma once

#include "v8.h"
#include "V8Isolate.h"
#include "v8_internal.h"
#include "V8HandleScopeBuffer.h"

namespace v8 {

class Number;

class HandleScope {
public:
    BUN_EXPORT HandleScope(Isolate* isolate);
    BUN_EXPORT ~HandleScope();

    template<typename T> Local<T> createLocal(JSC::VM& vm, JSC::JSValue value)
    {
        // TODO(@190n) handle more types
        if (value.isString()) {
            return Local<T>(buffer->createHandle(value.asCell(), &Map::string_map, vm));
        } else if (value.isCell()) {
            return Local<T>(buffer->createHandle(value.asCell(), &Map::object_map, vm));
        } else if (value.isInt32()) {
            return Local<T>(buffer->createSmiHandle(value.asInt32()));
        } else if (value.isNumber()) {
            return Local<T>(buffer->createDoubleHandle(value.asNumber()));
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
        TaggedPointer* handle = buffer->createRawHandle(ptr);
        return Local<T>(handle);
    }

    friend class EscapableHandleScopeBase;

protected:
    // must be 24 bytes to match V8 layout
    Isolate* isolate;
    HandleScope* prev;
    HandleScopeBuffer* buffer;

    // is protected in v8, which matters on windows
    BUN_EXPORT static uintptr_t* CreateHandle(internal::Isolate* isolate, uintptr_t value);
};

static_assert(sizeof(HandleScope) == 24, "HandleScope has wrong layout");

}
