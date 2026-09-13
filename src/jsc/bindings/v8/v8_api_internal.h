#pragma once

#include "v8.h"
#include "v8_internal.h"

namespace v8 {

class Isolate;
template<typename T>
class Local;
class Value;
class Data;

static constexpr int kInternalFieldsInWeakCallback = 2;
static constexpr int kEmbedderFieldsInWeakCallback = 2;

template<typename T>
class WeakCallbackInfo {
public:
    using Callback = void (*)(const WeakCallbackInfo<T>& data);

    WeakCallbackInfo(Isolate* isolate, T* parameter,
        void* embedder_fields[kEmbedderFieldsInWeakCallback],
        Callback* callback)
        : m_isolate(isolate)
        , m_parameter(parameter)
        , m_callback(callback)
    {
        for (int i = 0; i < kEmbedderFieldsInWeakCallback; ++i)
            m_embedderFields[i] = embedder_fields[i];
    }

    Isolate* GetIsolate() const { return m_isolate; }
    T* GetParameter() const { return m_parameter; }
    void* GetInternalField(int index) const { return m_embedderFields[index]; }
    void SetSecondPassCallback(Callback callback) const { *m_callback = callback; }

private:
    Isolate* m_isolate;
    T* m_parameter;
    Callback* m_callback;
    void* m_embedderFields[kEmbedderFieldsInWeakCallback];
};

enum class WeakCallbackType {
    kParameter,
    kInternalFields,
};

namespace api_internal {

BUN_EXPORT void ToLocalEmpty();
BUN_EXPORT void FromJustIsNothing();
BUN_EXPORT uintptr_t* GlobalizeReference(v8::internal::Isolate* isolate, uintptr_t address);
BUN_EXPORT void DisposeGlobal(uintptr_t* location);
BUN_EXPORT void MakeWeak(uintptr_t* location, void* data, WeakCallbackInfo<void>::Callback weak_callback, WeakCallbackType type);
BUN_EXPORT void* ClearWeak(uintptr_t* location);
BUN_EXPORT void MoveGlobalReference(uintptr_t** from, uintptr_t** to);
BUN_EXPORT Local<Value> GetFunctionTemplateData(Isolate* isolate, Local<Data> target);

} // namespace api_internal
} // namespace v8
