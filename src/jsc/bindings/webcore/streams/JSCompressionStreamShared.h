// Shared helpers for JSCompressionStream / JSDecompressionStream — the Rust
// CompressionStreamCoder FFI decls plus the format parser both constructors use.
#pragma once

#include "root.h"
#include "StreamsForward.h"

// CompressionStreamCoder.rs. Each transform call runs one bounded step; `more` means the coder
// must be stepped again (with no input, it kept the tail) before the next chunk is fed.
extern "C" void* CompressionStreamCoder__create(uint8_t format, bool decompress, size_t highWaterMark);
// Frees the coder. An in-flight off-thread step owns the codec state itself and gives it back
// through CompressionStreamCoder__restore (or drops it if the coder is gone by then).
extern "C" void CompressionStreamCoder__destroy(void* coder);
extern "C" void CompressionStreamCoder__restore(void* coder, void* codec);
extern "C" JSC::EncodedJSValue CompressionStreamCoder__transform(void* coder, JSC::JSGlobalObject* global, const uint8_t* input, size_t input_len, bool finish, bool* more);
extern "C" JSC::EncodedJSValue CompressionStreamCoder__transformInto(void* coder, JSC::JSGlobalObject* global, const uint8_t* input, size_t input_len, bool finish, uint8_t sinkId, void* sinkPtr, bool* more);
// Off-thread step, completed by Bun__CompressionStream__deliverAsync.
extern "C" void CompressionStreamCoder__transformAsync(void* coder, JSC::JSGlobalObject* global, JSC::EncodedJSValue streamCell, JSC::EncodedJSValue chunk, const uint8_t* input, size_t inputLen, bool finish);

namespace Bun {
namespace WebStreams {

std::optional<CompressionFormat> parseCompressionFormat(JSC::JSGlobalObject*, JSC::JSValue formatValue);
// The optional second constructor argument, read like a queuing strategy: its highWaterMark (bytes,
// default 64 KiB) is the output bound of one codec step, i.e. the largest piece a consumer gets per
// read() and how far the coder runs ahead of a slow consumer. Throws RangeError / TypeError as
// ExtractHighWaterMark does; `size` is ignored.
size_t parseCodecHighWaterMark(JSC::JSGlobalObject*, JSC::JSValue strategy);

} // namespace WebStreams
} // namespace Bun
