#pragma once

#include "v8.h"
#include "V8ArrayBuffer.h"
#include "V8Local.h"

namespace v8 {

class TypedArray : public ArrayBufferView {
private:
    TypedArray();
};

class Uint8Array : public TypedArray {
public:
    BUN_EXPORT static Local<Uint8Array> New(Local<ArrayBuffer> array_buffer,
        size_t byte_offset, size_t length);

private:
    Uint8Array();
};

class Uint32Array : public TypedArray {
public:
    BUN_EXPORT static Local<Uint32Array> New(Local<ArrayBuffer> array_buffer,
        size_t byte_offset, size_t length);

private:
    Uint32Array();
};

} // namespace v8
