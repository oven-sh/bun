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
    BUN_EXPORT static MaybeLocal<String> NewFromOneByte(Isolate* isolate, const uint8_t* data, NewStringType type, int length);

    // length:     number of bytes in buffer (if negative, assume it is large enough)
    // nchars_ref: store number of code units written here
    // return:     number of bytes copied including null terminator
    //
    // if string ends in a surrogate pair, but buffer is one byte too small to store it, instead
    // endcode the unpaired lead surrogate with WTF-8
    BUN_EXPORT int WriteUtf8(Isolate* isolate, char* buffer, int length = -1, int* nchars_ref = nullptr, int options = NO_OPTIONS) const;
    BUN_EXPORT int Length() const;

    /**
     * Returns the number of bytes in the UTF-8 encoded
     * representation of this string.
     */
    BUN_EXPORT int Utf8Length(Isolate* isolate) const;

    /**
     * Returns whether this string is known to contain only one byte data,
     * i.e. ISO-8859-1 code points.
     * Does not read the string.
     * False negatives are possible.
     */
    BUN_EXPORT bool IsOneByte() const;

    /**
     * Returns whether this string contain only one byte data,
     * i.e. ISO-8859-1 code points.
     * Will read the entire string in some cases.
     */
    BUN_EXPORT bool ContainsOnlyOneByte() const;

    /**
     * Returns true if the string is external.
     */
    BUN_EXPORT bool IsExternal() const;

    /**
     * Returns true if the string is both external and two-byte.
     */
    BUN_EXPORT bool IsExternalTwoByte() const;

    /**
     * Returns true if the string is both external and one-byte.
     */
    BUN_EXPORT bool IsExternalOneByte() const;

    JSC::JSString* localToJSString()
    {
        return localToObjectPointer<JSC::JSString>();
    }
};

}
