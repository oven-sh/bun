#pragma once

#include "v8.h"
#include "V8Primitive.h"
#include "V8MaybeLocal.h"
#include "V8Isolate.h"

namespace v8 {

enum class NewStringType {
    kNormal,
    kInternalized,
};

class String : Primitive {
public:
    enum WriteOptions {
        NO_OPTIONS = 0,
        HINT_MANY_WRITES_EXPECTED = 1,
        NO_NULL_TERMINATION = 2,
        PRESERVE_ONE_BYTE_NULL = 4,
        REPLACE_INVALID_UTF8 = 8,
    };

    BUN_EXPORT static MaybeLocal<String> NewFromUtf8(Isolate* isolate, char const* data, NewStringType type, int length = -1);

    // length:     number of bytes in buffer (if negative, assume it is large enough)
    // nchars_ref: store number of code units written here
    // return:     number of bytes copied including null terminator
    //
    // if string ends in a surrogate pair, but buffer is one byte too small to store it, instead
    // endcode the unpaired lead surrogate with WTF-8
    BUN_EXPORT int WriteUtf8(Isolate* isolate, char* buffer, int length = -1, int* nchars_ref = nullptr, int options = NO_OPTIONS) const;
    BUN_EXPORT int Length() const;

    JSC::JSString* localToJSString()
    {
        return localToObjectPointer<JSC::JSString>();
    }
};

}
