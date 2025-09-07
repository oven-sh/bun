#pragma once

#include "V8Data.h"
#include "V8Maybe.h"
#include "V8Local.h"
#include "V8Context.h"

namespace v8 {

class Value : public Data {
public:
    BUN_EXPORT bool IsBoolean() const;
    BUN_EXPORT bool IsObject() const;
    BUN_EXPORT bool IsNumber() const;
    BUN_EXPORT bool IsUint32() const;
    BUN_EXPORT bool IsFunction() const;
    BUN_EXPORT bool IsMap() const;
    BUN_EXPORT bool IsArray() const;
    BUN_EXPORT bool IsInt32() const;
    BUN_EXPORT bool IsBigInt() const;
    BUN_EXPORT Maybe<uint32_t> Uint32Value(Local<Context> context) const;

    // Comparison methods
    BUN_EXPORT bool StrictEquals(Local<Value> that) const;

    // usually inlined:
    BUN_EXPORT bool IsUndefined() const;
    BUN_EXPORT bool IsNull() const;
    BUN_EXPORT bool IsNullOrUndefined() const;
    BUN_EXPORT bool IsTrue() const;
    BUN_EXPORT bool IsFalse() const;
    BUN_EXPORT bool IsString() const;

private:
    // non-inlined versions of these
    BUN_EXPORT bool FullIsTrue() const;
    BUN_EXPORT bool FullIsFalse() const;
};

} // namespace v8
