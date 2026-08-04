#pragma once

#include "v8.h"
#include "V8Local.h"
#include "V8MaybeLocal.h"

namespace v8 {

class Isolate;
class Value;
class Context;
class Message;

class TryCatch {
public:
    BUN_EXPORT explicit TryCatch(Isolate* isolate);
    BUN_EXPORT ~TryCatch();

    BUN_EXPORT bool HasCaught() const;
    BUN_EXPORT bool CanContinue() const;
    BUN_EXPORT bool HasTerminated() const;
    BUN_EXPORT Local<Value> ReThrow();
    BUN_EXPORT Local<Value> Exception() const;
    BUN_EXPORT MaybeLocal<Value> StackTrace(Local<Context> context) const;
    BUN_EXPORT Local<Message> Message() const;
    BUN_EXPORT void Reset();
    BUN_EXPORT void SetVerbose(bool value);
    BUN_EXPORT bool IsVerbose() const;
    BUN_EXPORT void SetCaptureMessage(bool value);

    TryCatch(const TryCatch&) = delete;
    void operator=(const TryCatch&) = delete;

    // Match the real V8 TryCatch field layout so that addon stack frames
    // reserve the same amount of space.
    void* m_isolate = nullptr;
    void* m_next = nullptr;
    void* m_exception = nullptr;
    void* m_message = nullptr;
    void* m_jsStackComparableAddress = nullptr;
    uintptr_t m_flags = 0;
};

} // namespace v8
