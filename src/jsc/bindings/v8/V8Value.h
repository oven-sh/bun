#pragma once

#include "V8Data.h"
#include "V8Maybe.h"
#include "V8Local.h"
#include "V8MaybeLocal.h"
#include "V8Context.h"

namespace v8 {

class Boolean;
class Number;
class Integer;
class Int32;
class Uint32;
class String;
class Object;
class Isolate;

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
    BUN_EXPORT Maybe<int32_t> Int32Value(Local<Context> context) const;
    BUN_EXPORT Maybe<int64_t> IntegerValue(Local<Context> context) const;
    BUN_EXPORT Maybe<double> NumberValue(Local<Context> context) const;
    BUN_EXPORT bool BooleanValue(Isolate* isolate) const;

    BUN_EXPORT MaybeLocal<String> ToString(Local<Context> context) const;
    BUN_EXPORT MaybeLocal<String> ToDetailString(Local<Context> context) const;
    BUN_EXPORT MaybeLocal<Number> ToNumber(Local<Context> context) const;
    BUN_EXPORT MaybeLocal<Object> ToObject(Local<Context> context) const;
    BUN_EXPORT MaybeLocal<Integer> ToInteger(Local<Context> context) const;
    BUN_EXPORT MaybeLocal<Int32> ToInt32(Local<Context> context) const;
    BUN_EXPORT MaybeLocal<Uint32> ToUint32(Local<Context> context) const;
    BUN_EXPORT Local<Boolean> ToBoolean(Isolate* isolate) const;

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
    // V8_INLINE in the headers but with out-of-class bodies, which MSVC debug
    // builds import instead of emitting locally; private to match V8's
    // declarations (affects the MSVC mangling).
    BUN_EXPORT bool QuickIsUndefined() const;
    BUN_EXPORT bool QuickIsNull() const;
    BUN_EXPORT bool QuickIsNullOrUndefined() const;
    BUN_EXPORT bool QuickIsString() const;
};

} // namespace v8
