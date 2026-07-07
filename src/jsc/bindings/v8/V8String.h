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
    // V8 14 removed WriteOptions and the legacy Write/WriteOneByte/WriteUtf8 APIs
    // (crbug.com/373485796). Kept for addons compiled against older Node headers.
    enum WriteOptions {
        NO_OPTIONS = 0,
        HINT_MANY_WRITES_EXPECTED = 1,
        NO_NULL_TERMINATION = 2,
        PRESERVE_ONE_BYTE_NULL = 4,
        REPLACE_INVALID_UTF8 = 8,
    };

    struct WriteFlags {
        enum {
            kNone = 0,
            kNullTerminate = 1,
            kReplaceInvalidUtf8 = 2,
        };
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

    /**
     * Write the contents of the string to an external buffer.
     *
     * Copies length characters into the output buffer starting at offset. The
     * output buffer must have sufficient space for all characters and the null
     * terminator if null termination is requested through the flags.
     */
    BUN_EXPORT void WriteV2(Isolate* isolate, uint32_t offset, uint32_t length, uint16_t* buffer, int flags = WriteFlags::kNone) const;
    BUN_EXPORT void WriteOneByteV2(Isolate* isolate, uint32_t offset, uint32_t length, uint8_t* buffer, int flags = WriteFlags::kNone) const;

    /**
     * Encode the contents of the string as Utf8 into an external buffer.
     *
     * Encodes the characters of this string as Utf8 and writes them into the
     * output buffer until either all characters were encoded or the buffer is
     * full. Will not write partial UTF-8 sequences, preferring to stop before
     * the end of the buffer. If null termination is requested, the output
     * buffer will always be null terminated even if not all characters fit. In
     * that case, the capacity must be at least one. Returns the number of
     * bytes copied to the buffer including the null terminator (if written).
     */
    BUN_EXPORT size_t WriteUtf8V2(Isolate* isolate, char* buffer, size_t capacity, int flags = WriteFlags::kNone, size_t* processed_characters_return = nullptr) const;

    BUN_EXPORT int Length() const;

    /**
     * Returns the number of bytes in the UTF-8 encoded
     * representation of this string.
     */
    BUN_EXPORT int Utf8Length(Isolate* isolate) const;

    /**
     * Returns the number of bytes needed for the Utf8 encoding of this string.
     * Unpaired surrogates are counted as the 3-byte U+FFFD replacement
     * character, matching the Write*V2 replacement behavior.
     */
    BUN_EXPORT size_t Utf8LengthV2(Isolate* isolate) const;

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

} // namespace v8
