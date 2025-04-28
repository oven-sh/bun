#pragma once

#include "v8.h"
#include "V8Isolate.h"
#include "v8_internal.h"
#include "shim/HandleScopeBuffer.h"
#include "shim/GlobalInternals.h"
#include "shim/Map.h"

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
            return Local<T>(m_buffer->createHandle(value.asCell(), &shim::Map::string_map(), vm));
        } else if (value.isCell()) {
            return Local<T>(m_buffer->createHandle(value.asCell(), &shim::Map::object_map(), vm));
        } else if (value.isInt32()) {
            return Local<T>(m_buffer->createSmiHandle(value.asInt32()));
        } else if (value.isNumber()) {
            return Local<T>(m_buffer->createDoubleHandle(value.asNumber()));
        } else if (value.isUndefined()) {
            return Local<T>(m_isolate->undefinedSlot());
        } else if (value.isNull()) {
            return Local<T>(m_isolate->nullSlot());
        } else if (value.isTrue()) {
            return Local<T>(m_isolate->trueSlot());
        } else if (value.isFalse()) {
            return Local<T>(m_isolate->falseSlot());
        } else {
            V8_UNIMPLEMENTED();
            return Local<T>();
        }
    }

    friend class EscapableHandleScopeBase;

protected:
    // must be 24 bytes to match V8 layout
    Isolate* m_isolate;
    HandleScope* m_previousHandleScope;
    shim::HandleScopeBuffer* m_buffer;

    // is protected in v8, which matters on windows
    BUN_EXPORT static uintptr_t* CreateHandle(internal::Isolate* isolate, uintptr_t value);
};

static_assert(sizeof(HandleScope) == 24, "HandleScope has wrong layout");

} // namespace v8
