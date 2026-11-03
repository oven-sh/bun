#include "BunPythonModule.h"

// <zlib.h> finds the one among the headers of Node.js, which are there for native addons. This is that of the library Bun links.
#include "deps/zlib/zlib.h"

#include <wtf/SetForScope.h>

// The module zlib. (Modules/zlibmodule.c in CPython is the reference.)

namespace Bun {
namespace PythonModules {
namespace Zlib {

static constexpr int64_t defaultBufferSize = 16 * 1024;
static constexpr int defaultMemLevel = 8;
// About what deflateInit2() and inflateInit2() allocate with the default options.
static constexpr size_t sizeOfDeflateState = 300 * 1024;
static constexpr size_t sizeOfInflateState = 48 * 1024;

static constexpr TypeDef errorTypeDef { "zlib.error"_s, { TypeFlag::Base, TypeFlag::Mutable, TypeFlag::HasWeakref }, {}, {}, {} };

static PyType* errorType(JSGlobalObject* globalObject)
{
    Runtime& rt = runtime(globalObject);
    return rt.typeFor(errorTypeDef, rt.Exception());
}

static JSValue raiseZlibError(JSGlobalObject* globalObject, const z_stream& stream, int error, ASCIILiteral doing)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const char* detail = nullptr;
    // After a version mismatch, the stream has no message, or anything else.
    if (error == Z_VERSION_ERROR)
        detail = "library version mismatch";
    else if (stream.msg)
        detail = stream.msg;
    else if (error == Z_BUF_ERROR)
        detail = "incomplete or truncated stream";
    else if (error == Z_STREAM_ERROR)
        detail = "inconsistent stream state";
    else if (error == Z_DATA_ERROR)
        detail = "invalid input data";
    if (!detail)
        return raise(globalObject, scope, errorType(globalObject), makeString("Error "_s, error, ' ', doing));
    return raise(globalObject, scope, errorType(globalObject), makeString("Error "_s, error, ' ', doing, ": "_s, String::fromUTF8(detail)));
}

// What a stream writes to. zlib counts in 32 bits, so it is given the room in pieces.
class Output : public OutputMemory {
public:
    explicit Output(int64_t initialSize, int64_t limit = -1)
        : OutputMemory(std::max<int64_t>(initialSize, 1), 1024, limit)
    {
    }

    void attach(z_stream& stream)
    {
        stream.next_out = memory().data() + m_used;
        stream.avail_out = static_cast<uInt>(std::min<size_t>(memory().size() - m_used, std::numeric_limits<uInt>::max()));
        m_attached = stream.avail_out;
    }

    // The stream has filled what it was given. False: there is no memory for more.
    bool grow(z_stream& stream)
    {
        ASSERT(!stream.avail_out);
        m_used += m_attached;
        if (m_used == memory().size() && !growMemory())
            return false;
        attach(stream);
        return true;
    }

    JSValue finish(JSGlobalObject* globalObject, const z_stream& stream) { return bytesOfFirst(globalObject, m_used + m_attached - stream.avail_out); }

private:
    size_t m_used { 0 };
    size_t m_attached { 0 };
};

// Gives the stream as much of the rest of the input as it can count.
static void arrangeInput(z_stream& stream, size_t& remaining)
{
    stream.avail_in = static_cast<uInt>(std::min<size_t>(remaining, std::numeric_limits<uInt>::max()));
    remaining -= stream.avail_in;
}

static JSValue raiseNoMemory(JSGlobalObject* globalObject, ASCIILiteral message)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return raiseMemoryError(globalObject, scope, String(message));
}

// ---- compress(), decompress() ----

static JSValue compress(JSGlobalObject* globalObject, JSValue data, JSValue levelValue, JSValue wbitsValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder input(globalObject);
    if (!input.get(data))
        return {};
    int level, wbits;
    if (failed(scope, intArgument(globalObject, levelValue, Z_DEFAULT_COMPRESSION, level)) || failed(scope, intArgument(globalObject, wbitsValue, MAX_WBITS, wbits)) || !refreshBuffers(globalObject, input))
        return {};

    Output output(defaultBufferSize);
    if (!output.isValid())
        RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, "Out of memory while compressing data"_s));

    z_stream stream {};
    stream.next_in = input.buffer.data;
    size_t remaining = static_cast<size_t>(input.buffer.length);
    int error = deflateInit2(&stream, level, Z_DEFLATED, wbits, defaultMemLevel, Z_DEFAULT_STRATEGY);
    switch (error) {
    case Z_OK:
        break;
    case Z_MEM_ERROR:
        RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, "Out of memory while compressing data"_s));
    case Z_STREAM_ERROR:
        return raise(globalObject, scope, errorType(globalObject), "Bad compression level"_s);
    default:
        deflateEnd(&stream);
        RELEASE_AND_RETURN(scope, raiseZlibError(globalObject, stream, error, "while compressing data"_s));
    }

    output.attach(stream);
    int flush;
    do {
        arrangeInput(stream, remaining);
        flush = remaining ? Z_NO_FLUSH : Z_FINISH;
        do {
            if (!stream.avail_out && !output.grow(stream)) {
                deflateEnd(&stream);
                RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, "Out of memory while compressing data"_s));
            }
            error = deflate(&stream, flush);
            if (error == Z_STREAM_ERROR) {
                deflateEnd(&stream);
                RELEASE_AND_RETURN(scope, raiseZlibError(globalObject, stream, error, "while compressing data"_s));
            }
        } while (!stream.avail_out);
    } while (flush != Z_FINISH);

    error = deflateEnd(&stream);
    if (error != Z_OK)
        RELEASE_AND_RETURN(scope, raiseZlibError(globalObject, stream, error, "while finishing compression"_s));
    RELEASE_AND_RETURN(scope, output.finish(globalObject, stream));
}

static JSValue decompress(JSGlobalObject* globalObject, JSValue data, JSValue wbitsValue, JSValue bufsizeValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder input(globalObject);
    if (!input.get(data))
        return {};
    int wbits;
    int64_t bufferSize;
    if (failed(scope, intArgument(globalObject, wbitsValue, MAX_WBITS, wbits)) || failed(scope, nonNegativeSsizeArgument(globalObject, bufsizeValue, "bufsize"_s, defaultBufferSize, bufferSize)) || !refreshBuffers(globalObject, input))
        return {};

    Output output(bufferSize);
    if (!output.isValid())
        RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, "Out of memory while decompressing data"_s));

    z_stream stream {};
    stream.next_in = input.buffer.data;
    size_t remaining = static_cast<size_t>(input.buffer.length);
    int error = inflateInit2(&stream, wbits);
    switch (error) {
    case Z_OK:
        break;
    case Z_MEM_ERROR:
        RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, "Out of memory while decompressing data"_s));
    default:
        inflateEnd(&stream);
        RELEASE_AND_RETURN(scope, raiseZlibError(globalObject, stream, error, "while preparing to decompress data"_s));
    }

    output.attach(stream);
    do {
        arrangeInput(stream, remaining);
        int flush = remaining ? Z_NO_FLUSH : Z_FINISH;
        do {
            if (!stream.avail_out && !output.grow(stream)) {
                inflateEnd(&stream);
                RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, "Out of memory while decompressing data"_s));
            }
            error = inflate(&stream, flush);
            switch (error) {
            case Z_OK:
            case Z_BUF_ERROR:
            case Z_STREAM_END:
                break;
            case Z_MEM_ERROR:
                inflateEnd(&stream);
                RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, "Out of memory while decompressing data"_s));
            default: {
                raiseZlibError(globalObject, stream, error, "while decompressing data"_s);
                inflateEnd(&stream);
                return {};
            }
            }
        } while (!stream.avail_out);
    } while (error != Z_STREAM_END && remaining);

    if (error != Z_STREAM_END) {
        raiseZlibError(globalObject, stream, error, "while decompressing data"_s);
        inflateEnd(&stream);
        return {};
    }
    error = inflateEnd(&stream);
    if (error != Z_OK)
        RELEASE_AND_RETURN(scope, raiseZlibError(globalObject, stream, error, "while finishing decompression"_s));
    RELEASE_AND_RETURN(scope, output.finish(globalObject, stream));
}

// ---- Compress ----

struct Compressor {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(Compressor);
    ~Compressor()
    {
        if (isInitialized)
            deflateEnd(&stream);
    }

    z_stream stream {};
    bool isInitialized { false };
};

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(Compressor);

static PyType* compressType(JSGlobalObject*);

static JSValue compressobj(JSGlobalObject* globalObject, JSValue levelValue, JSValue methodValue, JSValue wbitsValue, JSValue memLevelValue, JSValue strategyValue, JSValue zdict)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int level, method, wbits, memLevel, strategy;
    if (failed(scope, intArgument(globalObject, levelValue, Z_DEFAULT_COMPRESSION, level))
        || failed(scope, intArgument(globalObject, methodValue, Z_DEFLATED, method))
        || failed(scope, intArgument(globalObject, wbitsValue, MAX_WBITS, wbits))
        || failed(scope, intArgument(globalObject, memLevelValue, defaultMemLevel, memLevel))
        || failed(scope, intArgument(globalObject, strategyValue, Z_DEFAULT_STRATEGY, strategy)))
        return {};
    BufferHolder dictionary(globalObject);
    if (zdict) {
        if (!dictionary.get(zdict))
            return {};
        if (static_cast<uint64_t>(dictionary.buffer.length) > std::numeric_limits<uInt>::max())
            return raiseOverflowError(globalObject, scope, "zdict length does not fit in an unsigned int"_s);
    }

    auto state = makeUnique<Compressor>();
    int error = deflateInit2(&state->stream, level, method, wbits, memLevel, strategy);
    switch (error) {
    case Z_OK:
        state->isInitialized = true;
        break;
    case Z_MEM_ERROR:
        RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, "Can't allocate memory for compression object"_s));
    case Z_STREAM_ERROR:
        return raiseValueError(globalObject, scope, "Invalid initialization option"_s);
    default:
        RELEASE_AND_RETURN(scope, raiseZlibError(globalObject, state->stream, error, "while creating compression object"_s));
    }
    if (zdict) {
        error = deflateSetDictionary(&state->stream, dictionary.buffer.data, static_cast<uInt>(dictionary.buffer.length));
        if (error == Z_STREAM_ERROR)
            return raiseValueError(globalObject, scope, "Invalid dictionary"_s);
        if (error != Z_OK)
            return raiseValueError(globalObject, scope, "deflateSetDictionary()"_s);
    }
    RELEASE_AND_RETURN(scope, createRecordWithState(globalObject, compressType(globalObject), 0, WTF::move(state), sizeOfDeflateState));
}

static JSValue compressorCompress(JSGlobalObject* globalObject, JSValue self, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue data;
    if (failed(scope, unpackArguments(globalObject, { "compress"_s, 1, 1, 1, {} }, args, &data)))
        return {};
    BufferHolder input(globalObject);
    if (!input.get(data))
        return {};
    z_stream& stream = stateOf<Compressor>(self)->stream;

    Output output(defaultBufferSize);
    if (!output.isValid())
        RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, {}));
    stream.next_in = input.buffer.data;
    size_t remaining = static_cast<size_t>(input.buffer.length);
    output.attach(stream);
    do {
        arrangeInput(stream, remaining);
        do {
            if (!stream.avail_out && !output.grow(stream))
                RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, {}));
            int error = deflate(&stream, Z_NO_FLUSH);
            if (error == Z_STREAM_ERROR)
                RELEASE_AND_RETURN(scope, raiseZlibError(globalObject, stream, error, "while compressing data"_s));
        } while (!stream.avail_out);
    } while (remaining);
    stream.next_in = nullptr;
    RELEASE_AND_RETURN(scope, output.finish(globalObject, stream));
}

static JSValue compressorFlush(JSGlobalObject* globalObject, JSValue self, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue modeValue;
    if (failed(scope, unpackArguments(globalObject, { "flush"_s, 1, 0, 1, {} }, args, &modeValue)))
        return {};
    int mode;
    if (failed(scope, intArgument(globalObject, modeValue, Z_FINISH, mode)))
        return {};
    if (mode == Z_NO_FLUSH)
        RELEASE_AND_RETURN(scope, runtime(globalObject).emptyBytes());
    auto* state = stateOf<Compressor>(self);
    z_stream& stream = state->stream;

    Output output(defaultBufferSize);
    if (!output.isValid())
        RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, {}));
    stream.avail_in = 0;
    output.attach(stream);
    int error;
    do {
        if (!stream.avail_out && !output.grow(stream))
            RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, {}));
        error = deflate(&stream, mode);
        if (error == Z_STREAM_ERROR)
            RELEASE_AND_RETURN(scope, raiseZlibError(globalObject, stream, error, "while flushing"_s));
    } while (!stream.avail_out);

    if (error == Z_STREAM_END && mode == Z_FINISH) {
        error = deflateEnd(&stream);
        if (error != Z_OK)
            RELEASE_AND_RETURN(scope, raiseZlibError(globalObject, stream, error, "while finishing compression"_s));
        state->isInitialized = false;
    } else if (error != Z_OK && error != Z_BUF_ERROR) {
        // Z_BUF_ERROR: the output was full, and then there turned out to be no more.
        RELEASE_AND_RETURN(scope, raiseZlibError(globalObject, stream, error, "while flushing"_s));
    }
    RELEASE_AND_RETURN(scope, output.finish(globalObject, stream));
}

static JSValue copyCompressor(JSGlobalObject* globalObject, JSValue self)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* state = stateOf<Compressor>(self);
    auto copy = makeUnique<Compressor>();
    int error = deflateCopy(&copy->stream, &state->stream);
    switch (error) {
    case Z_OK:
        break;
    case Z_STREAM_ERROR:
        return raiseValueError(globalObject, scope, "Inconsistent stream state"_s);
    case Z_MEM_ERROR:
        RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, "Can't allocate memory for compression object"_s));
    default:
        RELEASE_AND_RETURN(scope, raiseZlibError(globalObject, state->stream, error, "while copying compression object"_s));
    }
    copy->isInitialized = true;
    RELEASE_AND_RETURN(scope, createRecordWithState(globalObject, compressType(globalObject), 0, WTF::move(copy), sizeOfDeflateState));
}

template<JSValue (*copy)(JSGlobalObject*, JSValue)>
static JSValue copyMethod(JSGlobalObject* globalObject, JSValue self, const CallArgs& args)
{
    return takesNoArguments(globalObject, "copy"_s, args) ? copy(globalObject, self) : JSValue();
}

template<JSValue (*copy)(JSGlobalObject*, JSValue)>
static JSValue dunderCopyMethod(JSGlobalObject* globalObject, JSValue self, const CallArgs& args)
{
    return takesNoArguments(globalObject, "__copy__"_s, args) ? copy(globalObject, self) : JSValue();
}

template<JSValue (*copy)(JSGlobalObject*, JSValue)>
static JSValue deepCopyMethod(JSGlobalObject* globalObject, JSValue self, const CallArgs& args)
{
    JSValue memo;
    return unpackArguments(globalObject, { "__deepcopy__"_s, 1, 1, 1, {} }, args, &memo) ? copy(globalObject, self) : JSValue();
}

static constexpr NativeDef compressMethods[] = {
    PY_METHOD("compress", compressorCompress, "($self, *args, **kwargs)"),
    PY_METHOD("flush", compressorFlush, "($self, *args, **kwargs)"),
    PY_METHOD("copy", copyMethod<copyCompressor>, "($self, *args, **kwargs)"),
    PY_METHOD("__copy__", dunderCopyMethod<copyCompressor>, "($self, *args, **kwargs)"),
    PY_METHOD("__deepcopy__", deepCopyMethod<copyCompressor>, "($self, *args, **kwargs)"),
};

static constexpr TypeDef compressTypeDef { "zlib.Compress"_s, { TypeFlag::DisallowInstantiation }, compressMethods, {}, {} };

static PyType* compressType(JSGlobalObject* globalObject) { return runtime(globalObject).typeFor(compressTypeDef); }

// ---- Decompress ----

struct Decompressor {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(Decompressor);
    ~Decompressor()
    {
        if (isInitialized)
            inflateEnd(&stream);
    }

    z_stream stream {};
    bool isInitialized { false };
    bool isAtEnd { false };
    bool isInUse { false }; // See checkIsNotInUse().

    // For _ZlibDecompressor: input it was given and has not got to.
    Vector<uint8_t> pendingInput;
    bool needsInput { true };
};

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(Decompressor);

enum DecompressorField : unsigned { UnusedData, UnconsumedTail, Dictionary, DecompressorFieldCount };

static PyType* decompressType(JSGlobalObject*);

// decompress() takes the buffer of the dictionary when the stream asks for it, in the middle of its work. That may run code of
// the program (__buffer__), which must not get at the stream then. (CPython holds a lock, for which it would wait for ever.)
// False: a RuntimeError.
static bool checkIsNotInUse(JSGlobalObject* globalObject, PyRecord* self)
{
    if (!stateOf<Decompressor>(self)->isInUse)
        return true;
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    raiseRuntimeError(globalObject, scope, makeString("reentrant call inside "_s, reprForMessage(globalObject, self)));
    return false;
}

static bool setInflateDictionary(JSGlobalObject* globalObject, PyRecord* self)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    SetForScope inUse(stateOf<Decompressor>(self)->isInUse, true);
    BufferHolder dictionary(globalObject);
    if (!dictionary.get(self->get(Dictionary)))
        return false;
    if (static_cast<uint64_t>(dictionary.buffer.length) > std::numeric_limits<uInt>::max()) {
        raiseOverflowError(globalObject, scope, "zdict length does not fit in an unsigned int"_s);
        return false;
    }
    z_stream& stream = stateOf<Decompressor>(self)->stream;
    int error = inflateSetDictionary(&stream, dictionary.buffer.data, static_cast<uInt>(dictionary.buffer.length));
    if (error != Z_OK) {
        scope.release();
        raiseZlibError(globalObject, stream, error, "while setting zdict"_s);
        return false;
    }
    return true;
}

static JSValue createDecompressor(JSGlobalObject* globalObject, PyType* type, JSValue wbitsValue, JSValue zdict, bool checksDictionary)
{
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    int wbits;
    if (failed(scope, intArgument(globalObject, wbitsValue, MAX_WBITS, wbits)))
        return {};
    if (checksDictionary && zdict && !hasBuffer(zdict))
        return raiseTypeError(globalObject, scope, "zdict argument must support the buffer protocol"_s);

    auto state = makeUnique<Decompressor>();
    int error = inflateInit2(&state->stream, wbits);
    switch (error) {
    case Z_OK:
        state->isInitialized = true;
        break;
    case Z_STREAM_ERROR:
        return raiseValueError(globalObject, scope, "Invalid initialization option"_s);
    case Z_MEM_ERROR:
        RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, "Can't allocate memory for decompression object"_s));
    default:
        RELEASE_AND_RETURN(scope, raiseZlibError(globalObject, state->stream, error, "while creating decompression object"_s));
    }
    PyRecord* self = createRecordWithState(globalObject, type, DecompressorFieldCount, WTF::move(state), sizeOfInflateState);
    self->set(vm, UnusedData, rt.emptyBytes());
    self->set(vm, UnconsumedTail, rt.emptyBytes());
    self->set(vm, Dictionary, zdict);
    // A raw stream does not say that it needs a dictionary.
    if (zdict && wbits < 0 && failed(scope, setInflateDictionary(globalObject, self)))
        return {};
    return self;
}

static JSValue decompressobj(JSGlobalObject* globalObject, JSValue wbits, JSValue zdict)
{
    return createDecompressor(globalObject, decompressType(globalObject), wbits, zdict, true);
}

// Keeps the input that inflate() did not take: in unused_data what follows the end of the stream, in unconsumed_tail what there
// was no room for the output of.
static bool saveUnconsumedInput(JSGlobalObject* globalObject, PyRecord* self, std::span<const uint8_t> input, int error)
{
    VM& vm = getVM(globalObject);
    z_stream& stream = stateOf<Decompressor>(self)->stream;
    const uint8_t* end = input.data() + input.size();
    if (error == Z_STREAM_END && stream.avail_in > 0) {
        auto old = PyBytes::from(self->get(UnusedData))->span();
        size_t left = end - stream.next_in;
        PyBytes* joined = newBytes(globalObject, old.size() + left);
        if (!joined)
            return false;
        memcpy(joined->mutableData(), old.data(), old.size());
        memcpy(joined->mutableData() + old.size(), stream.next_in, left);
        self->set(vm, UnusedData, joined);
        stream.next_in += left;
        stream.avail_in = 0;
    }
    if (stream.avail_in > 0 || PyBytes::from(self->get(UnconsumedTail))->length()) {
        JSValue tail = bytesFrom(globalObject, { stream.next_in, static_cast<size_t>(end - stream.next_in) });
        if (!tail)
            return false;
        self->set(vm, UnconsumedTail, tail);
    }
    return true;
}

static JSValue decompressorDecompress(JSGlobalObject* globalObject, JSValue selfValue, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    static constexpr ASCIILiteral names[] = { "max_length"_s };
    JSValue values[2];
    if (failed(scope, unpackArguments(globalObject, { "decompress"_s, 1, 1, 2, names }, args, values)))
        return {};
    JSValue data = values[0];
    JSValue maxLengthValue = values[1];
    BufferHolder input(globalObject);
    if (!input.get(data))
        return {};
    int64_t maxLength;
    if (failed(scope, nonNegativeSsizeArgument(globalObject, maxLengthValue, "max_length"_s, 0, maxLength)) || !refreshBuffers(globalObject, input))
        return {};
    if (!maxLength)
        maxLength = -1;
    auto* self = uncheckedDowncast<PyRecord>(selfValue.asCell());
    if (failed(scope, checkIsNotInUse(globalObject, self)))
        return {};
    auto* state = stateOf<Decompressor>(self);
    z_stream& stream = state->stream;

    Output output(defaultBufferSize, maxLength);
    if (!output.isValid())
        RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, {}));
    stream.next_in = input.buffer.data;
    size_t remaining = static_cast<size_t>(input.buffer.length);
    output.attach(stream);
    int error = Z_OK;
    bool isDone = false;
    do {
        arrangeInput(stream, remaining);
        do {
            if (!stream.avail_out) {
                if (output.isAtLimit()) {
                    isDone = true;
                    break;
                }
                if (!output.grow(stream))
                    RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, {}));
            }
            error = inflate(&stream, Z_SYNC_FLUSH);
            if (error == Z_NEED_DICT && self->get(Dictionary)) {
                size_t consumed = stream.next_in - input.buffer.data;
                if (failed(scope, setInflateDictionary(globalObject, self)) || !refreshBuffers(globalObject, input))
                    return {};
                stream.next_in = input.buffer.data + consumed;
            } else if (error != Z_OK && error != Z_BUF_ERROR && error != Z_STREAM_END) {
                isDone = true;
                break;
            }
        } while (!stream.avail_out || error == Z_NEED_DICT);
    } while (!isDone && error != Z_STREAM_END && remaining);

    // What arrangeInput() has not handed over yet counts as not consumed: the span goes to the end of the input.
    if (!saveUnconsumedInput(globalObject, self, input.buffer.span(), error))
        return {};
    stream.next_in = nullptr;
    stream.avail_in = 0;

    if (error == Z_STREAM_END)
        state->isAtEnd = true;
    else if (error != Z_OK && error != Z_BUF_ERROR)
        RELEASE_AND_RETURN(scope, raiseZlibError(globalObject, stream, error, "while decompressing data"_s));
    RELEASE_AND_RETURN(scope, output.finish(globalObject, stream));
}

static JSValue decompressorFlush(JSGlobalObject* globalObject, JSValue selfValue, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue lengthValue;
    if (failed(scope, unpackArguments(globalObject, { "flush"_s, 1, 0, 1, {} }, args, &lengthValue)))
        return {};
    int64_t length = defaultBufferSize;
    if (lengthValue && failed(scope, ssizeArgument(globalObject, lengthValue, length)))
        return {};
    if (length <= 0)
        return raiseValueError(globalObject, scope, "length must be greater than zero"_s);
    auto* self = uncheckedDowncast<PyRecord>(selfValue.asCell());
    if (failed(scope, checkIsNotInUse(globalObject, self)))
        return {};
    auto* state = stateOf<Decompressor>(self);
    if (!state->isInitialized)
        RELEASE_AND_RETURN(scope, runtime(globalObject).emptyBytes());
    z_stream& stream = state->stream;

    // Kept alive by this variable while the field is replaced.
    PyBytes* tail = PyBytes::from(self->get(UnconsumedTail));
    Output output(length);
    if (!output.isValid())
        RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, {}));
    stream.next_in = const_cast<uint8_t*>(tail->data());
    size_t remaining = tail->length();
    output.attach(stream);
    int error;
    bool isDone = false;
    do {
        arrangeInput(stream, remaining);
        int flush = remaining ? Z_NO_FLUSH : Z_FINISH;
        do {
            if (!stream.avail_out && !output.grow(stream))
                RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, {}));
            error = inflate(&stream, flush);
            if (error != Z_OK && error != Z_BUF_ERROR && error != Z_STREAM_END) {
                isDone = true;
                break;
            }
        } while (!stream.avail_out);
    } while (!isDone && error != Z_STREAM_END && remaining);

    if (!saveUnconsumedInput(globalObject, self, tail->span(), error))
        return {};
    ensureStillAliveHere(tail);
    stream.next_in = nullptr;
    stream.avail_in = 0;

    if (error == Z_STREAM_END) {
        state->isAtEnd = true;
        state->isInitialized = false;
        error = inflateEnd(&stream);
        if (error != Z_OK)
            RELEASE_AND_RETURN(scope, raiseZlibError(globalObject, stream, error, "while finishing decompression"_s));
    } else if (error != Z_OK && error != Z_BUF_ERROR)
        RELEASE_AND_RETURN(scope, raiseZlibError(globalObject, stream, error, "while decompressing data"_s));
    RELEASE_AND_RETURN(scope, output.finish(globalObject, stream));
}

static JSValue copyDecompressor(JSGlobalObject* globalObject, JSValue selfValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* self = uncheckedDowncast<PyRecord>(selfValue.asCell());
    if (failed(scope, checkIsNotInUse(globalObject, self)))
        return {};
    auto* state = stateOf<Decompressor>(self);
    auto copy = makeUnique<Decompressor>();
    int error = inflateCopy(&copy->stream, &state->stream);
    switch (error) {
    case Z_OK:
        break;
    case Z_STREAM_ERROR:
        return raiseValueError(globalObject, scope, "Inconsistent stream state"_s);
    case Z_MEM_ERROR:
        RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, "Can't allocate memory for decompression object"_s));
    default:
        RELEASE_AND_RETURN(scope, raiseZlibError(globalObject, state->stream, error, "while copying decompression object"_s));
    }
    copy->isInitialized = true;
    copy->isAtEnd = state->isAtEnd;
    PyRecord* result = createRecordWithState(globalObject, decompressType(globalObject), DecompressorFieldCount, WTF::move(copy), sizeOfInflateState);
    for (unsigned i = 0; i < DecompressorFieldCount; ++i)
        result->set(vm, i, self->get(i));
    return result;
}

static JSValue decompressorUnusedData(JSGlobalObject*, JSValue self) { return uncheckedDowncast<PyRecord>(self.asCell())->get(UnusedData); }
static JSValue decompressorUnconsumedTail(JSGlobalObject*, JSValue self) { return uncheckedDowncast<PyRecord>(self.asCell())->get(UnconsumedTail); }
static JSValue decompressorEOF(JSGlobalObject*, JSValue self) { return jsBoolean(stateOf<Decompressor>(self)->isAtEnd); }
static JSValue decompressorNeedsInput(JSGlobalObject*, JSValue self) { return jsBoolean(stateOf<Decompressor>(self)->needsInput); }

static constexpr NativeDef decompressMethods[] = {
    PY_METHOD("decompress", decompressorDecompress, "($self, *args, **kwargs)"),
    PY_METHOD("flush", decompressorFlush, "($self, *args, **kwargs)"),
    PY_METHOD("copy", copyMethod<copyDecompressor>, "($self, *args, **kwargs)"),
    PY_METHOD("__copy__", dunderCopyMethod<copyDecompressor>, "($self, *args, **kwargs)"),
    PY_METHOD("__deepcopy__", deepCopyMethod<copyDecompressor>, "($self, *args, **kwargs)"),
};

static constexpr NativeGetSet decompressMembers[] = {
    { "unused_data"_s, decompressorUnusedData },
    { "unconsumed_tail"_s, decompressorUnconsumedTail },
    PY_MEMBER("eof", decompressorEOF),
};

static constexpr TypeDef decompressTypeDef { "zlib.Decompress"_s, { TypeFlag::DisallowInstantiation }, decompressMethods, decompressMembers, {} };

static PyType* decompressType(JSGlobalObject* globalObject) { return runtime(globalObject).typeFor(decompressTypeDef); }

// ---- _ZlibDecompressor ---- (the interface of bz2.BZ2Decompressor, for gzip)

static JSValue zlibDecompressorNew(JSGlobalObject* globalObject, JSValue cls, JSValue wbits, JSValue zdict)
{
    return createDecompressor(globalObject, PyType::from(cls), wbits, zdict, false);
}

static JSValue zlibDecompressorDecompress(JSGlobalObject* globalObject, JSValue selfValue, JSValue data, JSValue maxLengthValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder input(globalObject);
    if (!input.get(data))
        return {};
    int64_t maxLength = -1;
    if ((maxLengthValue && failed(scope, ssizeArgument(globalObject, maxLengthValue, maxLength))) || !refreshBuffers(globalObject, input))
        return {};
    auto* self = uncheckedDowncast<PyRecord>(selfValue.asCell());
    auto* state = stateOf<Decompressor>(self);
    if (state->isAtEnd)
        return raiseEOFError(globalObject, scope, "End of stream already reached"_s);
    z_stream& stream = state->stream;

    // What is left from last time goes first.
    std::span<const uint8_t> source = input.buffer.span();
    Vector<uint8_t> joined;
    if (!state->pendingInput.isEmpty()) {
        joined = std::exchange(state->pendingInput, {});
        if (!joined.tryAppend(source))
            RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, {}));
        source = joined.span();
    }

    if (maxLength < 0 || maxLength == std::numeric_limits<int64_t>::max())
        maxLength = -1;
    Output output(maxLength < 0 ? defaultBufferSize : std::min<int64_t>(maxLength, 16 * 1024 * 1024), maxLength);
    if (!output.isValid())
        RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, "Insufficient memory for buffer allocation"_s));
    stream.next_in = const_cast<uint8_t*>(source.data());
    size_t remaining = source.size();
    output.attach(stream);
    int error = Z_OK;
    bool isFull = false;
    do {
        arrangeInput(stream, remaining);
        do {
            if (!stream.avail_out) {
                if (output.isAtLimit()) {
                    isFull = true;
                    break;
                }
                if (!output.grow(stream))
                    RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, "Insufficient memory for buffer allocation"_s));
            }
            error = inflate(&stream, Z_SYNC_FLUSH);
            if (error == Z_NEED_DICT) {
                // As in CPython, which leaves it at that: the caller sees an error without a message.
                stream.next_in = nullptr;
                stream.avail_in = 0;
                return raise(globalObject, scope, runtime(globalObject).SystemError(), "<method 'decompress' of 'zlib._ZlibDecompressor' objects> returned NULL without setting an exception"_s);
            }
        } while (!stream.avail_out);
    } while (!isFull && error != Z_STREAM_END && remaining);

    if (error == Z_STREAM_END) {
        state->isAtEnd = true;
        state->isInitialized = false;
        const uint8_t* next = stream.next_in;
        int endError = inflateEnd(&stream);
        if (endError != Z_OK)
            RELEASE_AND_RETURN(scope, raiseZlibError(globalObject, stream, endError, "while finishing decompression"_s));
        stream.next_in = const_cast<uint8_t*>(next);
    } else if (error != Z_OK && error != Z_BUF_ERROR) {
        raiseZlibError(globalObject, stream, error, "while decompressing data"_s);
        stream.next_in = nullptr;
        stream.avail_in = 0;
        return {};
    }

    std::span<const uint8_t> left { stream.next_in, static_cast<size_t>(source.data() + source.size() - stream.next_in) };
    if (state->isAtEnd) {
        state->needsInput = false;
        if (!left.empty()) {
            JSValue unused = bytesFrom(globalObject, left);
            RETURN_IF_EXCEPTION(scope, {});
            self->set(vm, UnusedData, unused);
        }
    } else if (left.empty())
        state->needsInput = true;
    else {
        state->needsInput = false;
        Vector<uint8_t> pending;
        if (!pending.tryAppend(left))
            RELEASE_AND_RETURN(scope, raiseNoMemory(globalObject, {}));
        state->pendingInput = WTF::move(pending);
    }
    stream.next_in = nullptr;
    stream.avail_in = 0;
    RELEASE_AND_RETURN(scope, output.finish(globalObject, stream));
}

static constexpr NativeDef zlibDecompressorMethods[] = {
    PY_NEW(zlibDecompressorNew, "($type, /, wbits=MAX_WBITS, zdict=b'')"),
    PY_METHOD("decompress", zlibDecompressorDecompress, "($self, /, data, max_length=-1)"),
};

static constexpr NativeGetSet zlibDecompressorMembers[] = {
    PY_MEMBER("eof", decompressorEOF),
    { "unused_data"_s, decompressorUnusedData },
    PY_MEMBER("needs_input", decompressorNeedsInput),
};

static constexpr TypeDef zlibDecompressorTypeDef { "zlib._ZlibDecompressor"_s, {}, zlibDecompressorMethods, zlibDecompressorMembers, {} };

// ---- Checksums ----

template<uLong (*update)(uLong, const Bytef*, uInt)>
static JSValue checksum(JSGlobalObject* globalObject, JSValue data, JSValue valueArgument, uint32_t start)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder input(globalObject);
    if (!input.get(data))
        return {};
    uint32_t value;
    if (failed(scope, bitwiseUnsignedArgument(globalObject, valueArgument, start, value)) || !refreshBuffers(globalObject, input))
        return {};
    uLong sum = value;
    auto span = input.buffer.span();
    while (span.size() > std::numeric_limits<uInt>::max()) {
        sum = update(sum, span.data(), std::numeric_limits<uInt>::max());
        span = span.subspan(std::numeric_limits<uInt>::max());
    }
    sum = update(sum, span.data(), static_cast<uInt>(span.size()));
    return jsNumber(static_cast<uint32_t>(sum));
}

static JSValue adler32Function(JSGlobalObject* globalObject, JSValue data, JSValue value) { return checksum<adler32>(globalObject, data, value, 1); }
static JSValue crc32Function(JSGlobalObject* globalObject, JSValue data, JSValue value) { return checksum<crc32>(globalObject, data, value, 0); }

template<uLong (*combine)(uLong, uLong, z_off_t)>
static JSValue combineChecksums(JSGlobalObject* globalObject, ASCIILiteral name, JSValue first, JSValue second, JSValue length)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    uint32_t sum1, sum2;
    if (failed(scope, bitwiseUnsignedArgument(globalObject, first, 0, sum1)) || failed(scope, bitwiseUnsignedArgument(globalObject, second, 0, sum2)))
        return {};
    if (!isInt(length))
        return raiseTypeError(globalObject, scope, name, "() argument 3 must be int, not "_s, typeNameOfArgument(globalObject, length));
    int64_t count;
    if (failed(scope, ssizeArgument(globalObject, length, count)))
        return {};
    if (count < 0)
        return raiseValueError(globalObject, scope, "len2 must be non-negative"_s);
    return jsNumber(static_cast<uint32_t>(combine(sum1, sum2, static_cast<z_off_t>(count))));
}

static JSValue adler32Combine(JSGlobalObject* globalObject, JSValue a, JSValue b, JSValue length) { return combineChecksums<adler32_combine>(globalObject, "adler32_combine"_s, a, b, length); }
static JSValue crc32Combine(JSGlobalObject* globalObject, JSValue a, JSValue b, JSValue length) { return combineChecksums<crc32_combine>(globalObject, "crc32_combine"_s, a, b, length); }

static JSValue moduleGetAttr(JSGlobalObject* globalObject, JSValue name)
{
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (isStr(name)) {
        String text = strValue(name)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (text == "__version__"_s) {
            if (!warn(globalObject, rt.DeprecationWarning(), "'__version__' is deprecated and slated for removal in Python 3.20"_s))
                return {};
            return makeStr(vm, "1.0"_s);
        }
    }
    return raise(globalObject, scope, rt.AttributeError(), makeString("module 'zlib' has no attribute "_s, reprForMessage(globalObject, name)));
}

static constexpr NativeDef functions[] = {
    PY_FUNCTION("adler32", adler32Function, "(data, value=1, /)"),
    PY_FUNCTION("adler32_combine", adler32Combine, "(adler1, adler2, len2, /)"),
    PY_FUNCTION("compress", compress, "(data, /, level=Z_DEFAULT_COMPRESSION, wbits=MAX_WBITS)"),
    PY_FUNCTION("compressobj", compressobj, "(level=Z_DEFAULT_COMPRESSION, method=DEFLATED, wbits=MAX_WBITS, memLevel=DEF_MEM_LEVEL, strategy=Z_DEFAULT_STRATEGY, zdict=<unrepresentable>)"),
    PY_FUNCTION("crc32", crc32Function, "(data, value=0, /)"),
    PY_FUNCTION("crc32_combine", crc32Combine, "(crc1, crc2, len2, /)"),
    PY_FUNCTION("decompress", decompress, "(data, /, wbits=MAX_WBITS, bufsize=DEF_BUF_SIZE)"),
    PY_FUNCTION("decompressobj", decompressobj, "(wbits=MAX_WBITS, zdict=b'')"),
    PY_FUNCTION("__getattr__", moduleGetAttr, "(name, /)"),
};

} // namespace Zlib

void initializeZlibModule(JSGlobalObject* globalObject, PyModule* module)
{
    using namespace Zlib;
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    module->addFunctions(globalObject, functions);
    module->add(globalObject, "error"_s, errorType(globalObject));
    module->add(globalObject, "_ZlibDecompressor"_s, rt.typeFor(zlibDecompressorTypeDef));

    static constexpr std::pair<ASCIILiteral, int> constants[] = {
        { "MAX_WBITS"_s, MAX_WBITS },
        { "DEFLATED"_s, Z_DEFLATED },
        { "DEF_MEM_LEVEL"_s, defaultMemLevel },
        { "DEF_BUF_SIZE"_s, defaultBufferSize },
        { "Z_NO_COMPRESSION"_s, Z_NO_COMPRESSION },
        { "Z_BEST_SPEED"_s, Z_BEST_SPEED },
        { "Z_BEST_COMPRESSION"_s, Z_BEST_COMPRESSION },
        { "Z_DEFAULT_COMPRESSION"_s, Z_DEFAULT_COMPRESSION },
        { "Z_FILTERED"_s, Z_FILTERED },
        { "Z_HUFFMAN_ONLY"_s, Z_HUFFMAN_ONLY },
        { "Z_RLE"_s, Z_RLE },
        { "Z_FIXED"_s, Z_FIXED },
        { "Z_DEFAULT_STRATEGY"_s, Z_DEFAULT_STRATEGY },
        { "Z_NO_FLUSH"_s, Z_NO_FLUSH },
        { "Z_PARTIAL_FLUSH"_s, Z_PARTIAL_FLUSH },
        { "Z_SYNC_FLUSH"_s, Z_SYNC_FLUSH },
        { "Z_FULL_FLUSH"_s, Z_FULL_FLUSH },
        { "Z_FINISH"_s, Z_FINISH },
        { "Z_BLOCK"_s, Z_BLOCK },
        { "Z_TREES"_s, Z_TREES },
    };
    for (auto& [name, value] : constants)
        module->add(globalObject, name, jsNumber(value));
    module->add(globalObject, "ZLIB_VERSION"_s, makeStr(vm, String::fromUTF8(ZLIB_VERSION)));
    module->add(globalObject, "ZLIB_RUNTIME_VERSION"_s, makeStr(vm, String::fromUTF8(zlibVersion())));
#ifdef ZLIBNG_VERSION
    module->add(globalObject, "ZLIBNG_VERSION"_s, makeStr(vm, String::fromUTF8(ZLIBNG_VERSION)));
#endif
}

} // namespace PythonModules
} // namespace Bun
