#include "V8TryCatch.h"
#include "V8Value.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::TryCatch)

namespace v8 {

TryCatch::TryCatch(Isolate*)
{
    V8_UNIMPLEMENTED();
}

TryCatch::~TryCatch() {}

bool TryCatch::HasCaught() const
{
    V8_UNIMPLEMENTED();
    return false;
}

bool TryCatch::CanContinue() const
{
    V8_UNIMPLEMENTED();
    return false;
}

bool TryCatch::HasTerminated() const
{
    V8_UNIMPLEMENTED();
    return false;
}

Local<Value> TryCatch::ReThrow()
{
    V8_UNIMPLEMENTED();
    return Local<Value>();
}

Local<Value> TryCatch::Exception() const
{
    V8_UNIMPLEMENTED();
    return Local<Value>();
}

MaybeLocal<Value> TryCatch::StackTrace(Local<Context>) const
{
    V8_UNIMPLEMENTED();
    return MaybeLocal<Value>();
}

Local<v8::Message> TryCatch::Message() const
{
    V8_UNIMPLEMENTED();
    return Local<v8::Message>();
}

void TryCatch::Reset()
{
    V8_UNIMPLEMENTED();
}

void TryCatch::SetVerbose(bool)
{
    V8_UNIMPLEMENTED();
}

bool TryCatch::IsVerbose() const
{
    V8_UNIMPLEMENTED();
    return false;
}

void TryCatch::SetCaptureMessage(bool)
{
    V8_UNIMPLEMENTED();
}

} // namespace v8
