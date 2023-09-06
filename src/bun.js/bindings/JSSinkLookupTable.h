// Automatically generated from src/bun.js/bindings/JSSink.cpp using ./src/bun.js/scripts/create_hash_table. DO NOT EDIT!

#include "Lookup.h"

namespace JSC {

static const struct CompactHashIndex JSArrayBufferSinkPrototypeTableIndex[19] = {
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { 6, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { 0, 16 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { 5, -1 },
    { 4, -1 },
    { 1, 17 },
    { 2, 18 },
    { 3, -1 },
};

static const struct HashTableValue JSArrayBufferSinkPrototypeTableValues[7] = {
   { "close"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, ArrayBufferSink__doClose, 0 } },
   { "flush"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, ArrayBufferSink__flush, 1 } },
   { "end"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, ArrayBufferSink__end, 0 } },
   { "start"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, ArrayBufferSink__start, 1 } },
   { "write"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, ArrayBufferSink__write, 1 } },
   { "ref"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, ArrayBufferSink__ref, 0 } },
   { "unref"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, ArrayBufferSink__unref, 0 } },
};

static const struct HashTable JSArrayBufferSinkPrototypeTable =
    { 7, 15, false, nullptr, JSArrayBufferSinkPrototypeTableValues, JSArrayBufferSinkPrototypeTableIndex };

} // namespace JSC

#include "Lookup.h"

namespace JSC {

static const struct CompactHashIndex JSReadableArrayBufferSinkControllerPrototypeTableIndex[19] = {
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { 0, 16 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { 4, -1 },
    { 1, 17 },
    { 2, 18 },
    { 3, -1 },
};

static const struct HashTableValue JSReadableArrayBufferSinkControllerPrototypeTableValues[5] = {
   { "close"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, JSReadableArrayBufferSinkController__close, 0 } },
   { "flush"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, ArrayBufferSink__flush, 1 } },
   { "end"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, JSReadableArrayBufferSinkController__end, 0 } },
   { "start"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, ArrayBufferSink__start, 1 } },
   { "write"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, ArrayBufferSink__write, 1 } },
};

static const struct HashTable JSReadableArrayBufferSinkControllerPrototypeTable =
    { 5, 15, false, nullptr, JSReadableArrayBufferSinkControllerPrototypeTableValues, JSReadableArrayBufferSinkControllerPrototypeTableIndex };

} // namespace JSC

#include "Lookup.h"

namespace JSC {

static const struct CompactHashIndex JSFileSinkPrototypeTableIndex[19] = {
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { 6, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { 0, 16 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { 5, -1 },
    { 4, -1 },
    { 1, 17 },
    { 2, 18 },
    { 3, -1 },
};

static const struct HashTableValue JSFileSinkPrototypeTableValues[7] = {
   { "close"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, FileSink__doClose, 0 } },
   { "flush"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, FileSink__flush, 1 } },
   { "end"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, FileSink__end, 0 } },
   { "start"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, FileSink__start, 1 } },
   { "write"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, FileSink__write, 1 } },
   { "ref"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, FileSink__ref, 0 } },
   { "unref"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, FileSink__unref, 0 } },
};

static const struct HashTable JSFileSinkPrototypeTable =
    { 7, 15, false, nullptr, JSFileSinkPrototypeTableValues, JSFileSinkPrototypeTableIndex };

} // namespace JSC

#include "Lookup.h"

namespace JSC {

static const struct CompactHashIndex JSReadableFileSinkControllerPrototypeTableIndex[19] = {
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { 0, 16 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { 4, -1 },
    { 1, 17 },
    { 2, 18 },
    { 3, -1 },
};

static const struct HashTableValue JSReadableFileSinkControllerPrototypeTableValues[5] = {
   { "close"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, JSReadableFileSinkController__close, 0 } },
   { "flush"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, FileSink__flush, 1 } },
   { "end"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, JSReadableFileSinkController__end, 0 } },
   { "start"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, FileSink__start, 1 } },
   { "write"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly|PropertyAttribute::DontDelete|PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, FileSink__write, 1 } },
};

static const struct HashTable JSReadableFileSinkControllerPrototypeTable =
    { 5, 15, false, nullptr, JSReadableFileSinkControllerPrototypeTableValues, JSReadableFileSinkControllerPrototypeTableIndex };

} // namespace JSC

#include "Lookup.h"

namespace JSC {

static const struct CompactHashIndex JSHTTPResponseSinkPrototypeTableIndex[19] = {
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, -1 },
    { -1, 