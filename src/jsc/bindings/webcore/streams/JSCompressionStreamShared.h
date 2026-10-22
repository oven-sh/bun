// Shared helpers for JSCompressionStream / JSDecompressionStream — the Rust
// CompressionStreamCoder FFI decls plus the format parser both constructors use.
#pragma once

#include "root.h"
#include "StreamsForward.h"

// CompressionStreamCoder.rs. Each transform call runs one bounded step; `more` means the coder
// must be stepped again (with no input, it kept the tail) before the next chunk is fed.
extern "C" void* CompressionStreamCoder__create(uint8_t format, bool decompress, size_t highWaterMark, bool hasLevel, int32_t level);
// Releases the cell's reference (in-flight off-thread steps hold their own).
extern "C" void CompressionStreamCoder__destroy(void* coder);
extern "C" JSC::EncodedJSValue CompressionStreamCoder__transform(void* coder, JSC::JSGlobalObject* global, const uint8_t* input, size_t input_len, bool finish, bool* more);
extern "C" JSC::EncodedJSValue CompressionStreamCoder__transformInto(void* coder, JSC::JSGlobalObject* global, const uint8_t* input, size_t input_len, bool finish, uint8_t sinkId, void* sinkPtr, bool* more);
// Off-thread step, completed by Bun__CompressionStream__deliverAsync.
extern "C" void CompressionStreamCoder__transformAsync(void* coder, JSC::JSGlobalObject* global, JSC::EncodedJSValue streamCell, JSC::EncodedJSValue chunk, const uint8_t* input, size_t inputLen, bool finish);

namespace Bun {
namespace WebStreams {

std::optional<CompressionFormat> parseCompressionFormat(JSC::JSGlobalObject*, JSC::JSValue formatValue);

struct CodecOptions {
    size_t highWaterMark;
    std::optional<int32_t> level;
};
// One pass over the optional second constructor argument (read like a queuing strategy; `size` is
// ignored). highWaterMark (bytes, default 64 KiB) bounds one codec step's output. level, read only
// when `levelFormat` is engaged (CompressionStream), selects the compression level: zlib formats
// 0-9, brotli quality 0-11, zstd 1-22. Throws RangeError on an invalid value of either.
CodecOptions parseCodecOptions(JSC::JSGlobalObject*, JSC::JSValue strategy, std::optional<CompressionFormat> levelFormat);

} // namespace WebStreams
} // namespace Bun
