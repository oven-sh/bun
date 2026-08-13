#pragma once

#include "v8.h"
#include "V8Value.h"
#include "V8Local.h"
#include "V8Isolate.h"
#include "V8Maybe.h"
#include "V8Context.h"
#include "V8Data.h"
#include "V8MaybeLocal.h"
#include "V8Name.h"

namespace v8 {

namespace internal {
enum ExternalPointerTag : uint16_t;
}

enum PropertyAttribute {
    None = 0,
    ReadOnly = 1 << 0,
    DontEnum = 1 << 1,
    DontDelete = 1 << 2,
};

BUN_EXPORT internal::ExternalPointerTag ToExternalPointerTag(uint16_t api_tag);

class Object : public Value {
public:
    BUN_EXPORT static Local<Object> New(Isolate* isolate);
    BUN_EXPORT Maybe<bool> Set(Local<Context> context, Local<Value> key, Local<Value> value);
    BUN_EXPORT Maybe<bool> Set(Local<Context> context, uint32_t index, Local<Value> value);

    // Get property by key
    BUN_EXPORT MaybeLocal<Value> Get(Local<Context> context, Local<Value> key);

    // Get property by index (for arrays)
    BUN_EXPORT MaybeLocal<Value> Get(Local<Context> context, uint32_t index);

    BUN_EXPORT Maybe<bool> DefineOwnProperty(Local<Context> context, Local<Name> key, Local<Value> value, PropertyAttribute attributes = None);

    BUN_EXPORT void SetInternalField(int index, Local<Data> data);
    // usually inlined
    BUN_EXPORT Local<Data> GetInternalField(int index);

    BUN_EXPORT void SetAlignedPointerInInternalField(int index, void* value, uint16_t tag);

    // Inline in v8-object.h, but under dllimport MSVC emits a call to it instead
    // of inlining, so addons built with MSVC (debug) reference it as an import.
    BUN_EXPORT void* GetAlignedPointerFromInternalField(int index, uint16_t tag);

    BUN_EXPORT int InternalFieldCount() const;

    BUN_EXPORT int GetIdentityHash();

private:
    BUN_EXPORT Local<Data> SlowGetInternalField(int index);
    BUN_EXPORT void* SlowGetAlignedPointerFromInternalField(int index, uint16_t tag);
};

} // namespace v8
