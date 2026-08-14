// Shared helpers for JSCompressionStream / JSDecompressionStream — the Rust
// CompressionStreamCoder FFI decls plus the format parser both constructors use.
#pragma once

#include "root.h"
#include "StreamsForward.h"

// CompressionStreamCoder.rs. A chunk (or the flush) is transformed in steps of bounded
// output: each call below runs one step and reports through `more` whether the coder
// stopped at its cap, in which case it must be stepped again (with no input; it keeps the
// chunk's unconsumed tail) before the next chunk is fed.
extern "C" void* CompressionStreamCoder__create(uint8_t format, bool decompress);
// Releases the cell's reference (in-flight off-thread steps hold their own).
extern "C" void CompressionStreamCoder__destroy(void* coder);
extern "C" JSC::EncodedJSValue CompressionStreamCoder__transform(void* coder, JSC::JSGlobalObject* global, const uint8_t* input, size_t input_len, bool finish, bool* more);
extern "C" JSC::EncodedJSValue CompressionStreamCoder__transformInto(void* coder, JSC::JSGlobalObject* global, const uint8_t* input, size_t input_len, bool finish, uint8_t sinkId, void* sinkPtr, bool* more);
// Off-thread step; completes through Bun__CompressionStream__deliverAsync. A continuation
// step passes an undefined chunk and no input.
extern "C" void CompressionStreamCoder__transformAsync(void* coder, JSC::JSGlobalObject* global, JSC::EncodedJSValue streamCell, JSC::EncodedJSValue chunk, const uint8_t* input, size_t inputLen, bool finish);

namespace Bun {
namespace WebStreams {

std::optional<CompressionFormat> parseCompressionFormat(JSC::JSGlobalObject*, JSC::JSValue formatValue);

} // namespace WebStreams
} // namespace Bun
