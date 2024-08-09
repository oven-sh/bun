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
    BUN_EXPORT Maybe<uint32_t> Uint32Value(Local<Context> context) const;

private:
    // non-inlined versions of these
    BUN_EXPORT bool FullIsTrue() const;
    BUN_EXPORT bool FullIsFalse() const;
};

}
