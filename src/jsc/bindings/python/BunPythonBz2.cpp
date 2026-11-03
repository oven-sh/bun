#include "BunPythonCompression.h"

// As the library is compiled: scripts/build/deps/bzip2.ts.
#define BZ_NO_STDIO
#if OS(WINDOWS)
#define BZ_EXPORT
#endif
#include <bzlib.h>

// The module _bz2. (Modules/_bz2module.c in CPython is the reference.)

// One of the library's checks of itself has failed: its state cannot be relied on, and it goes on if this returns.
extern "C" void bz_internal_error(int errorCode)
{
    WTFLogAlways("libbzip2: internal error number %d", errorCode);
    CRASH();
}

namespace Bun {
namespace PythonModules {
namespace Bz2 {

static void* allocate(void* memory, int count, int size)
{
    if (count < 0 || size < 0)
        return nullptr;
    return static_cast<LibraryMemory*>(memory)->allocate(count, size);
}

static void release(void*, void* address) { LibraryMemory::free(address); }

static void useMemory(bz_stream& stream, LibraryMemory& memory)
{
    stream.bzalloc = allocate;
    stream.bzfree = release;
    stream.opaque = &memory;
}

static bool isError(int status)
{
    switch (status) {
    case BZ_OK:
    case BZ_RUN_OK:
    case BZ_FLUSH_OK:
    case BZ_FINISH_OK:
    case BZ_STREAM_END:
        return false;
    default:
        return true;
    }
}

static JSValue raiseError(JSGlobalObject* globalObject, int status)
{
    Runtime& rt = runtime(globalObject);
    auto scope = DECLARE_THROW_SCOPE(rt.vm());
    switch (status) {
    case BZ_CONFIG_ERROR:
        return raiseSystemError(globalObject, scope, "libbzip2 was not compiled correctly"_s);
    case BZ_PARAM_ERROR:
        return raiseValueError(globalObject, scope, "Internal error - invalid parameters passed to libbzip2"_s);
    case BZ_MEM_ERROR:
        return raiseMemoryError(globalObject, scope, String());
    case BZ_DATA_ERROR:
    case BZ_DATA_ERROR_MAGIC:
        return raise(globalObject, scope, rt.OSError(), "Invalid data stream"_s);
    case BZ_IO_ERROR:
        return raise(globalObject, scope, rt.OSError(), "Unknown I/O error"_s);
    case BZ_UNEXPECTED_EOF:
        return raiseEOFError(globalObject, scope, "Compressed file ended before the logical end-of-stream was detected"_s);
    case BZ_SEQUENCE_ERROR:
        return raiseRuntimeError(globalObject, scope, "Internal error - Invalid sequence of commands sent to libbzip2"_s);
    default:
        return raise(globalObject, scope, rt.OSError(), makeString("Unrecognized error from libbzip2: "_s, status));
    }
}

// The library counts input and output in 32 bits: it is given both in pieces.

static void giveInput(bz_stream& stream, std::span<const uint8_t> input)
{
    stream.next_in = const_cast<char*>(reinterpret_cast<const char*>(input.data()));
    stream.avail_in = static_cast<unsigned>(std::min<size_t>(input.size(), std::numeric_limits<unsigned>::max()));
}

static void giveRoom(bz_stream& stream, const BlockOutput& output)
{
    auto room = output.room();
    stream.next_out = reinterpret_cast<char*>(room.data());
    stream.avail_out = static_cast<unsigned>(room.size());
}

// ---- BZ2Compressor ----

struct Compressor {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(Compressor);
    ~Compressor()
    {
        if (isInitialized)
            BZ2_bzCompressEnd(&stream);
    }

    // The library is not going to be called again.
    void end()
    {
        BZ2_bzCompressEnd(&stream);
        isInitialized = false;
        memory.didFreeAll();
    }

    ThreadLock lock;
    LibraryMemory memory;
    bz_stream stream {};
    bool isInitialized { false };
    bool isFlushed { false };
};

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(Compressor);

static JSValue compressorNew(JSGlobalObject* globalObject, JSValue cls, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (args.keywordCount())
        return raiseTypeError(globalObject, scope, "BZ2Compressor() takes no keyword arguments"_s);
    if (args.size() > 1)
        return raiseTypeError(globalObject, scope, "BZ2Compressor expected at most 1 argument, got "_s, args.size());
    int level;
    if (failed(scope, intArgument(globalObject, args.size() ? args[0] : JSValue(), 9, level)))
        return {};
    if (level < 1 || level > 9)
        return raiseValueError(globalObject, scope, "compresslevel must be between 1 and 9"_s);

    auto state = makeUnique<Compressor>();
    useMemory(state->stream, state->memory);
    int status = BZ2_bzCompressInit(&state->stream, level, 0, 0);
    if (isError(status))
        RELEASE_AND_RETURN(scope, raiseError(globalObject, status));
    state->isInitialized = true;
    PyRecord* self = createRecordWithState(globalObject, PyType::from(cls), 0, WTF::move(state));
    stateOf<Compressor>(self)->memory.report(vm);
    return self;
}

static JSValue runCompressor(JSGlobalObject* globalObject, Compressor& state, std::span<const uint8_t> input, int action)
{
    bz_stream& stream = state.stream;
    BlockOutput output(-1);
    int status = BZ_OK;
    bool hasMemory = true;
    {
        AllowThreads allowThreads(globalObject);
        stream.avail_in = 0;
        stream.avail_out = 0;
        while (true) {
            if (!stream.avail_in && !input.empty()) {
                giveInput(stream, input);
                input = input.subspan(stream.avail_in);
            }
            if (action == BZ_RUN && !stream.avail_in)
                break;
            if (!stream.avail_out) {
                if (!(hasMemory = output.grow()))
                    break;
                giveRoom(stream, output);
            }
            unsigned room = stream.avail_out;
            status = BZ2_bzCompress(&stream, action);
            output.didWrite(room - stream.avail_out);
            if (isError(status) || (action == BZ_FINISH && status == BZ_STREAM_END))
                break;
        }
        stream.next_in = nullptr;
        stream.avail_in = 0;
        stream.next_out = nullptr;
        stream.avail_out = 0;
    }
    if (action == BZ_FINISH)
        state.end();
    state.memory.report(getVM(globalObject));
    if (!hasMemory)
        return raiseNoMemoryForOutput(globalObject);
    if (isError(status))
        return raiseError(globalObject, status);
    return output.finish(globalObject);
}

static JSValue compressorCompress(JSGlobalObject* globalObject, JSValue self, JSValue data)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder input(globalObject);
    if (!input.get(data))
        return {};
    auto& state = *stateOf<Compressor>(self);
    ObjectLocker locker(globalObject, state.lock);
    if (!locker || !refreshBuffers(globalObject, input))
        return {};
    if (state.isFlushed)
        return raiseValueError(globalObject, scope, "Compressor has been flushed"_s);
    RELEASE_AND_RETURN(scope, runCompressor(globalObject, state, input.buffer.span(), BZ_RUN));
}

static JSValue compressorFlush(JSGlobalObject* globalObject, JSValue self)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& state = *stateOf<Compressor>(self);
    ObjectLocker locker(globalObject, state.lock);
    if (!locker)
        return {};
    if (state.isFlushed)
        return raiseValueError(globalObject, scope, "Repeated call to flush()"_s);
    state.isFlushed = true;
    RELEASE_AND_RETURN(scope, runCompressor(globalObject, state, {}, BZ_FINISH));
}

static constexpr NativeDef compressorMethods[] = {
    PY_NEW(compressorNew, "!($type, compresslevel=9, /)"),
    PY_METHOD("compress", compressorCompress, "($self, data, /)"),
    PY_METHOD("flush", compressorFlush, "($self, /)"),
};

static constexpr TypeDef compressorTypeDef { "_bz2.BZ2Compressor"_s, { TypeFlag::Immutable }, compressorMethods, {}, {} };

// ---- BZ2Decompressor ----

struct Decompressor : DecompressorState {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(Decompressor);
    ~Decompressor()
    {
        if (isInitialized)
            BZ2_bzDecompressEnd(&stream);
    }

    // The library is not going to be called again.
    void end()
    {
        BZ2_bzDecompressEnd(&stream);
        isInitialized = false;
        memory.didFreeAll();
    }

    bz_stream stream {};
    bool isInitialized { false };
    int error { BZ_OK };
};

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(Decompressor);

static JSValue decompressorNew(JSGlobalObject* globalObject, JSValue cls, const CallArgs& args)
{
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (args.size())
        return raiseTypeError(globalObject, scope, "BZ2Decompressor() takes no positional arguments"_s);
    if (args.keywordCount())
        return raiseTypeError(globalObject, scope, "BZ2Decompressor() takes no keyword arguments"_s);

    auto state = makeUnique<Decompressor>();
    useMemory(state->stream, state->memory);
    int status = BZ2_bzDecompressInit(&state->stream, 0, 0);
    if (isError(status))
        RELEASE_AND_RETURN(scope, raiseError(globalObject, status));
    state->isInitialized = true;
    PyRecord* self = createRecordWithState(globalObject, PyType::from(cls), DecompressorFieldCount, WTF::move(state));
    self->set(vm, UnusedData, rt.emptyBytes());
    stateOf<Decompressor>(self)->memory.report(vm);
    return self;
}

static JSValue decompressorDecompress(JSGlobalObject* globalObject, JSValue selfValue, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    static constexpr ASCIILiteral names[] = { "data"_s, "max_length"_s };
    JSValue values[2];
    if (failed(scope, unpackArguments(globalObject, { "decompress"_s, 0, 1, 2, names }, args, values)))
        return {};
    BufferHolder input(globalObject);
    if (!input.get(values[0]))
        return {};
    int64_t maxLength = -1;
    if (values[1] && failed(scope, ssizeArgument(globalObject, values[1], maxLength)))
        return {};
    auto* self = uncheckedDowncast<PyRecord>(selfValue.asCell());
    auto& state = *stateOf<Decompressor>(self);
    ObjectLocker locker(globalObject, state.lock);
    if (!locker || !refreshBuffers(globalObject, input))
        return {};
    if (state.isAtEnd)
        return raiseEOFError(globalObject, scope, "End of stream already reached"_s);
    // The library may write out of bounds if it is called again after an error.
    if (state.error != BZ_OK)
        return raiseValueError(globalObject, scope, "Decompressor is unusable after a previous error"_s);

    bz_stream& stream = state.stream;
    int status = BZ_OK;
    auto run = [&](std::span<const uint8_t>& rest, BlockOutput& output, DecompressionOutcome& outcome) {
        if (!(outcome.hasMemoryForOutput = output.grow()))
            return;
        giveRoom(stream, output);
        while (true) {
            giveInput(stream, rest);
            unsigned given = stream.avail_in;
            unsigned room = stream.avail_out;
            status = BZ2_bzDecompress(&stream);
            rest = rest.subspan(given - stream.avail_in);
            output.didWrite(room - stream.avail_out);
            if (isError(status)) {
                outcome.isContent = false;
                break;
            }
            if (status == BZ_STREAM_END) {
                outcome.isAtEnd = true;
                break;
            }
            if (rest.empty())
                break;
            if (!stream.avail_out) {
                if (output.isAtLimit())
                    break;
                if (!(outcome.hasMemoryForOutput = output.grow()))
                    break;
                giveRoom(stream, output);
            }
        }
        stream.next_in = nullptr;
        stream.avail_in = 0;
        stream.next_out = nullptr;
        stream.avail_out = 0;
    };
    auto didRun = [&] {
        if (isError(status)) {
            state.error = status;
            state.needsInput = false;
        }
        if (isError(status) || state.isAtEnd)
            state.end();
    };
    RELEASE_AND_RETURN(scope, decompressWith<false>(globalObject, self, state, input.buffer.span(), maxLength, run, didRun, [&] { return raiseError(globalObject, status); }));
}

static constexpr NativeDef decompressorMethods[] = {
    PY_NEW(decompressorNew, "!($type, /)"),
    PY_METHOD("decompress", decompressorDecompress, "!($self, /, data, max_length=-1)"),
};

static constexpr NativeGetSet decompressorGetSets[] = {
    PY_MEMBER("eof", decompressorEOF<Decompressor>),
    PY_MEMBER("needs_input", decompressorNeedsInput<Decompressor>),
    { "unused_data"_s, decompressorUnusedData },
};

static constexpr TypeDef decompressorTypeDef { "_bz2.BZ2Decompressor"_s, { TypeFlag::Immutable }, decompressorMethods, decompressorGetSets, {} };

} // namespace Bz2

void initializeBz2Module(JSGlobalObject* globalObject, PyModule* module)
{
    Runtime& rt = runtime(globalObject);
    module->add(globalObject, "BZ2Compressor"_s, rt.typeFor(Bz2::compressorTypeDef));
    module->add(globalObject, "BZ2Decompressor"_s, rt.typeFor(Bz2::decompressorTypeDef));
}

} // namespace PythonModules
} // namespace Bun
