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
extern "C" JSC::EncodedJSValue CompressionStreamCoder__transformInto(void* coder, JSC::JSGlobalObject* global, const uint8_t* input, size_t input_len, bool finish, void* sinkController, bool* more);
// Off-thread step: it settles the promise of Bun__CompressionStream__stepPromise and parks its output for the reaction.
extern "C" void CompressionStreamCoder__transformAsync(void* coder, JSC::JSGlobalObject* global, JSC::EncodedJSValue streamCell, JSC::EncodedJSValue chunk, const uint8_t* input, size_t inputLen, bool finish);
extern "C" const uint8_t* CompressionStreamCoder__stepOutput(void* coder, size_t* len);
extern "C" void CompressionStreamCoder__releaseStepOutput(void* coder);

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
