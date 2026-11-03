#include "BunPythonCompression.h"

// The library is linked statically: scripts/build/deps/xz.ts.
#define LZMA_API_STATIC
#include <lzma.h>

// The module _lzma. (Modules/_lzmamodule.c in CPython is the reference.)

namespace Bun {
namespace PythonModules {
namespace Lzma {

enum Format : int {
    FormatAuto,
    FormatXZ,
    FormatAlone,
    FormatRaw,
};

static constexpr int checkUnknown = LZMA_CHECK_ID_MAX + 1;

static constexpr TypeDef errorTypeDef { "_lzma.LZMAError"_s, { TypeFlag::Base, TypeFlag::Mutable, TypeFlag::HasWeakref }, {}, {}, "Call to liblzma failed."_s };

static PyType* errorType(JSGlobalObject* globalObject)
{
    Runtime& rt = runtime(globalObject);
    return rt.typeFor(errorTypeDef, rt.Exception());
}

static bool isError(lzma_ret status)
{
    switch (status) {
    case LZMA_OK:
    case LZMA_GET_CHECK:
    case LZMA_NO_CHECK:
    case LZMA_STREAM_END:
        return false;
    default:
        return true;
    }
}

static JSValue raiseLzmaError(JSGlobalObject* globalObject, const String& message)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    return raise(globalObject, scope, errorType(globalObject), message);
}

static JSValue raiseError(JSGlobalObject* globalObject, lzma_ret status)
{
    switch (status) {
    case LZMA_UNSUPPORTED_CHECK:
        return raiseLzmaError(globalObject, "Unsupported integrity check"_s);
    case LZMA_MEM_ERROR: {
        auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
        return raiseMemoryError(globalObject, scope, String());
    }
    case LZMA_MEMLIMIT_ERROR:
        return raiseLzmaError(globalObject, "Memory usage limit exceeded"_s);
    case LZMA_FORMAT_ERROR:
        return raiseLzmaError(globalObject, "Input format not supported by decoder"_s);
    case LZMA_OPTIONS_ERROR:
        return raiseLzmaError(globalObject, "Invalid or unsupported options"_s);
    case LZMA_DATA_ERROR:
        return raiseLzmaError(globalObject, "Corrupt input data"_s);
    case LZMA_BUF_ERROR:
        return raiseLzmaError(globalObject, "Insufficient buffer space"_s);
    case LZMA_PROG_ERROR:
        return raiseLzmaError(globalObject, "Internal error"_s);
    default:
        return raiseLzmaError(globalObject, makeString("Unrecognized error from liblzma: "_s, static_cast<int>(status)));
    }
}

// ---- Memory ----

static void* allocate(void* memory, size_t count, size_t size) { return static_cast<LibraryMemory*>(memory)->allocate(count, size); }
static void release(void*, void* address) { LibraryMemory::free(address); }

// A stream that allocates from the memory. It must stay where it is.
struct Stream {
    WTF_MAKE_NONCOPYABLE(Stream);

    explicit Stream(LibraryMemory& memory)
        : allocator { allocate, release, &memory }
    {
        stream.allocator = &allocator;
    }
    ~Stream() { lzma_end(&stream); }

    // The library is not going to be called again.
    void end()
    {
        lzma_end(&stream);
        static_cast<LibraryMemory*>(allocator.opaque)->didFreeAll();
    }

    lzma_allocator allocator;
    lzma_stream stream = LZMA_STREAM_INIT;
};

// ---- Numbers ----

// As _PyLong_UInt32_Converter(), _PyLong_UInt64_Converter() and the like: `cType` is what the message calls the type.
template<typename T>
static bool unsignedValue(JSGlobalObject* globalObject, JSValue value, ASCIILiteral cType, T& result)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    uint64_t wide;
    if (!unsignedArgument(globalObject, value, cType, 0, wide))
        return false;
    if (wide > std::numeric_limits<T>::max()) {
        raiseOverflowError(globalObject, scope, "Python int too large for C "_s, cType);
        return false;
    }
    result = static_cast<T>(wide);
    return true;
}

static bool uint32Value(JSGlobalObject* globalObject, JSValue value, uint32_t& result) { return unsignedValue(globalObject, value, "uint32_t"_s, result); }

// The format unit "i" of PyArg_ParseTupleAndKeywords().
static bool parsedInt(JSGlobalObject* globalObject, JSValue value, int& result)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue index = toIndex(globalObject, value);
    RETURN_IF_EXCEPTION(scope, false);
    auto wide = tryInt64(index);
    if (!wide) {
        raiseOverflowError(globalObject, scope, "Python int too large to convert to C long"_s);
        return false;
    }
    if (*wide > std::numeric_limits<int>::max()) {
        raiseOverflowError(globalObject, scope, "signed integer is greater than maximum"_s);
        return false;
    }
    if (*wide < std::numeric_limits<int>::min()) {
        raiseOverflowError(globalObject, scope, "signed integer is less than minimum"_s);
        return false;
    }
    result = static_cast<int>(*wide);
    return true;
}

// ---- Filter specifiers: dicts, from which the library's structures are made ----

struct Filter {
    lzma_filter filter { LZMA_VLI_UNKNOWN, nullptr };
    union {
        lzma_options_lzma lzma;
        lzma_options_delta delta;
        lzma_options_bcj bcj;
    } options;
};

// mapping[name], or the empty value if that is a KeyError. `isMissing` tells that from an exception.
static JSValue optionalItem(JSGlobalObject* globalObject, JSValue mapping, ASCIILiteral name, bool& isMissing)
{
    Runtime& rt = runtime(globalObject);
    isMissing = false;
    JSValue item = getItem(globalObject, mapping, internString(rt.vm(), name));
    if (!item)
        isMissing = clearPendingExceptionIfMatches(globalObject, rt.KeyError());
    return item;
}

// CPython has PyArg_ParseTupleAndKeywords() take the specifier for the keyword arguments of a call, and puts one message in the
// place of whatever that has to complain of. `convert(i, value)` is called for the options that are there, in the order of the
// names; false is an exception. False: a ValueError.
template<size_t count, typename Convert>
static bool parseOptions(JSGlobalObject* globalObject, JSValue specifier, const ASCIILiteral (&names)[count], ASCIILiteral complaint, const Convert& convert)
{
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto isFine = [&] {
        auto* dict = PyDict::tryFrom(specifier);
        if (!dict || !dict->type()->isSubtypeOf(rt.dictType()))
            return false;
        // Counted before anything runs that may change it. When as many have been found, it looks no further.
        size_t unknown = dict->size();
        if (unknown > count)
            return false;
        for (size_t i = 0; i < count && unknown; ++i) {
            JSValue value = dict->get(internString(vm, names[i]));
            if (!value)
                continue;
            --unknown;
            if (!convert(i, value))
                return false;
        }
        return !unknown;
    };
    if (isFine())
        return true;
    takePendingException(globalObject);
    raiseValueError(globalObject, scope, String(complaint));
    return false;
}

static bool parseLzmaOptions(JSGlobalObject* globalObject, JSValue specifier, lzma_options_lzma& options)
{
    // A preset gives all the options a value. Then come those that the caller gives.
    uint32_t preset = LZMA_PRESET_DEFAULT;
    bool isMissing;
    JSValue presetValue = optionalItem(globalObject, specifier, "preset"_s, isMissing);
    if (!presetValue && !isMissing)
        return false;
    if (presetValue && !uint32Value(globalObject, presetValue, preset))
        return false;
    memset(&options, 0, sizeof(options));
    if (lzma_lzma_preset(&options, preset)) {
        raiseLzmaError(globalObject, makeString("Invalid compression preset: "_s, preset));
        return false;
    }

    static constexpr ASCIILiteral names[] = { "id"_s, "preset"_s, "dict_size"_s, "lc"_s, "lp"_s, "pb"_s, "mode"_s, "nice_len"_s, "mf"_s, "depth"_s };
    return parseOptions(globalObject, specifier, names, "Invalid filter specifier for LZMA filter"_s, [&](size_t i, JSValue value) {
        uint32_t number;
        switch (i) {
        case 0:
        case 1:
            return true;
        case 2:
            return uint32Value(globalObject, value, options.dict_size);
        case 3:
            return uint32Value(globalObject, value, options.lc);
        case 4:
            return uint32Value(globalObject, value, options.lp);
        case 5:
            return uint32Value(globalObject, value, options.pb);
        case 6:
            if (!uint32Value(globalObject, value, number))
                return false;
            options.mode = static_cast<lzma_mode>(number);
            return true;
        case 7:
            return uint32Value(globalObject, value, options.nice_len);
        case 8:
            if (!uint32Value(globalObject, value, number))
                return false;
            options.mf = static_cast<lzma_match_finder>(number);
            return true;
        default:
            return uint32Value(globalObject, value, options.depth);
        }
    });
}

static bool parseFilter(JSGlobalObject* globalObject, JSValue specifier, Filter& result)
{
    Runtime& rt = runtime(globalObject);
    auto scope = DECLARE_THROW_SCOPE(rt.vm());
    if (!rt.typeOf(specifier)->lookup(Special::GetItem)) {
        raiseTypeError(globalObject, scope, "Filter specifier must be a dict or dict-like object"_s);
        return false;
    }
    bool isMissing;
    JSValue idValue = optionalItem(globalObject, specifier, "id"_s, isMissing);
    if (!idValue) {
        if (isMissing)
            raiseValueError(globalObject, scope, "Filter specifier must have an \"id\" entry"_s);
        return false;
    }
    lzma_vli id;
    if (!unsignedValue(globalObject, idValue, "lzma_vli"_s, id))
        return false;

    switch (id) {
    case LZMA_FILTER_LZMA1:
    case LZMA_FILTER_LZMA2:
        if (!parseLzmaOptions(globalObject, specifier, result.options.lzma))
            return false;
        result.filter.options = &result.options.lzma;
        break;
    case LZMA_FILTER_DELTA: {
        static constexpr ASCIILiteral names[] = { "id"_s, "dist"_s };
        uint32_t distance = 1;
        if (!parseOptions(globalObject, specifier, names, "Invalid filter specifier for delta filter"_s, [&](size_t i, JSValue value) { return !i || uint32Value(globalObject, value, distance); }))
            return false;
        memset(&result.options.delta, 0, sizeof(result.options.delta));
        result.options.delta.type = LZMA_DELTA_TYPE_BYTE;
        result.options.delta.dist = distance;
        result.filter.options = &result.options.delta;
        break;
    }
    case LZMA_FILTER_X86:
    case LZMA_FILTER_POWERPC:
    case LZMA_FILTER_IA64:
    case LZMA_FILTER_ARM:
    case LZMA_FILTER_ARMTHUMB:
    case LZMA_FILTER_SPARC: {
        static constexpr ASCIILiteral names[] = { "id"_s, "start_offset"_s };
        uint32_t startOffset = 0;
        if (!parseOptions(globalObject, specifier, names, "Invalid filter specifier for BCJ filter"_s, [&](size_t i, JSValue value) { return !i || uint32Value(globalObject, value, startOffset); }))
            return false;
        memset(&result.options.bcj, 0, sizeof(result.options.bcj));
        result.options.bcj.start_offset = startOffset;
        result.filter.options = &result.options.bcj;
        break;
    }
    default:
        raiseValueError(globalObject, scope, "Invalid filter ID: "_s, static_cast<uint64_t>(id));
        return false;
    }
    result.filter.id = id;
    return true;
}

struct FilterChain {
    // As the library takes them. The options are in `parsed`, so this must stay where it is in memory.
    lzma_filter filters[LZMA_FILTERS_MAX + 1];
    Filter parsed[LZMA_FILTERS_MAX];
};

// To PySequence_Size() the built-in mappings have no length: theirs is that of a mapping. (A class derived from one has both kinds.)
static bool isBuiltinMapping(Runtime& rt, PyType* type)
{
    if (type->isHeapType())
        return false;
    JSValue method = type->lookup(Special::Len);
    for (PyType* mapping : { rt.dictType(), rt.frozendictType(), rt.mappingProxyType() }) {
        if (method == mapping->lookup(Special::Len))
            return true;
    }
    return false;
}

static bool parseFilterChain(JSGlobalObject* globalObject, JSValue specifiers, FilterChain& chain)
{
    Runtime& rt = runtime(globalObject);
    auto scope = DECLARE_THROW_SCOPE(rt.vm());
    PyType* type = rt.typeOf(specifiers);
    if (isBuiltinMapping(rt, type)) {
        raiseTypeError(globalObject, scope, type->nameInMessages(), " is not a sequence"_s);
        return false;
    }
    int64_t count = length(globalObject, specifiers);
    RETURN_IF_EXCEPTION(scope, false);
    if (count > LZMA_FILTERS_MAX) {
        raiseValueError(globalObject, scope, "Too many filters - liblzma supports a maximum of "_s, LZMA_FILTERS_MAX);
        return false;
    }
    for (int64_t i = 0; i < count; ++i) {
        if (!type->lookup(Special::GetItem)) {
            raiseTypeError(globalObject, scope, '\'', type->nameInMessages(), "' object does not support indexing"_s);
            return false;
        }
        JSValue specifier = getItem(globalObject, specifiers, jsNumber(static_cast<int32_t>(i)));
        RETURN_IF_EXCEPTION(scope, false);
        if (!parseFilter(globalObject, specifier, chain.parsed[i]))
            return false;
        chain.filters[i] = chain.parsed[i].filter;
    }
    chain.filters[count] = { LZMA_VLI_UNKNOWN, nullptr };
    return true;
}

// The other way round.
static JSValue buildFilterSpecifier(JSGlobalObject* globalObject, const lzma_filter& filter)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    PyDict* specifier = PyDict::create(globalObject);
    auto add = [&](ASCIILiteral name, uint64_t value) {
        specifier->set(vm, internString(vm, name), makeInt(globalObject, value));
    };
    add("id"_s, filter.id);
    switch (filter.id) {
    // Of the options of LZMA1 and LZMA2, these are all that the encoded properties hold.
    case LZMA_FILTER_LZMA1: {
        auto* options = static_cast<const lzma_options_lzma*>(filter.options);
        add("lc"_s, options->lc);
        add("lp"_s, options->lp);
        add("pb"_s, options->pb);
        add("dict_size"_s, options->dict_size);
        break;
    }
    case LZMA_FILTER_LZMA2:
        add("dict_size"_s, static_cast<const lzma_options_lzma*>(filter.options)->dict_size);
        break;
    case LZMA_FILTER_DELTA:
        add("dist"_s, static_cast<const lzma_options_delta*>(filter.options)->dist);
        break;
    case LZMA_FILTER_X86:
    case LZMA_FILTER_POWERPC:
    case LZMA_FILTER_IA64:
    case LZMA_FILTER_ARM:
    case LZMA_FILTER_ARMTHUMB:
    case LZMA_FILTER_SPARC:
        if (auto* options = static_cast<const lzma_options_bcj*>(filter.options))
            add("start_offset"_s, options->start_offset);
        break;
    default:
        return raiseValueError(globalObject, scope, "Invalid filter ID: "_s, static_cast<uint64_t>(filter.id));
    }
    return specifier;
}

// ---- LZMACompressor ----

struct Compressor {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(Compressor);

    ThreadLock lock;
    LibraryMemory memory;
    Stream stream { memory };
    bool isFlushed { false };
};

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(Compressor);

// False: an exception.
static bool initializeEncoder(JSGlobalObject* globalObject, lzma_stream& stream, int format, int check, uint32_t preset, JSValue filters)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    bool hasFilters = !isNone(filters);
    FilterChain chain;
    lzma_ret status;
    switch (format) {
    case FormatXZ:
        if (check == -1)
            check = LZMA_CHECK_CRC64;
        if (!hasFilters)
            status = lzma_easy_encoder(&stream, preset, static_cast<lzma_check>(check));
        else {
            if (!parseFilterChain(globalObject, filters, chain))
                return false;
            status = lzma_stream_encoder(&stream, chain.filters, static_cast<lzma_check>(check));
        }
        break;
    case FormatAlone:
        if (!hasFilters) {
            lzma_options_lzma options;
            if (lzma_lzma_preset(&options, preset)) {
                raiseLzmaError(globalObject, makeString("Invalid compression preset: "_s, preset));
                return false;
            }
            status = lzma_alone_encoder(&stream, &options);
        } else {
            if (!parseFilterChain(globalObject, filters, chain))
                return false;
            if (chain.filters[0].id != LZMA_FILTER_LZMA1 || chain.filters[1].id != LZMA_VLI_UNKNOWN) {
                raiseValueError(globalObject, scope, "Invalid filter chain for FORMAT_ALONE - must be a single LZMA1 filter"_s);
                return false;
            }
            status = lzma_alone_encoder(&stream, static_cast<const lzma_options_lzma*>(chain.filters[0].options));
        }
        break;
    case FormatRaw:
        if (!hasFilters) {
            raiseValueError(globalObject, scope, "Must specify filters for FORMAT_RAW"_s);
            return false;
        }
        if (!parseFilterChain(globalObject, filters, chain))
            return false;
        status = lzma_raw_encoder(&stream, chain.filters);
        break;
    default:
        raiseValueError(globalObject, scope, "Invalid container format: "_s, format);
        return false;
    }
    if (!isError(status))
        return true;
    scope.release();
    raiseError(globalObject, status);
    return false;
}

static JSValue compressorNew(JSGlobalObject* globalObject, JSValue cls, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    static constexpr ASCIILiteral names[] = { "format"_s, "check"_s, "preset"_s, "filters"_s };
    JSValue values[4];
    if (!unpackArguments(globalObject, { "LZMACompressor"_s, 0, 0, 4, names }, args, values))
        return {};
    int format = FormatXZ;
    int check = -1;
    if ((values[0] && !parsedInt(globalObject, values[0], format)) || (values[1] && !parsedInt(globalObject, values[1], check)))
        return {};
    JSValue presetValue = values[2] ? values[2] : jsUndefined();
    JSValue filters = values[3] ? values[3] : jsUndefined();

    if (format != FormatXZ && check != -1 && check != LZMA_CHECK_NONE)
        return raiseValueError(globalObject, scope, "Integrity checks are only supported by FORMAT_XZ"_s);
    if (!isNone(presetValue) && !isNone(filters))
        return raiseValueError(globalObject, scope, "Cannot specify both preset and filter chain"_s);
    uint32_t preset = LZMA_PRESET_DEFAULT;
    if (!isNone(presetValue) && !uint32Value(globalObject, presetValue, preset))
        return {};

    auto state = makeUnique<Compressor>();
    if (!initializeEncoder(globalObject, state->stream.stream, format, check, preset, filters))
        return {};
    PyRecord* self = createRecordWithState(globalObject, PyType::from(cls), 0, WTF::move(state));
    stateOf<Compressor>(self)->memory.report(vm);
    return self;
}

static JSValue runCompressor(JSGlobalObject* globalObject, Compressor& state, std::span<const uint8_t> input, lzma_action action)
{
    lzma_stream& stream = state.stream.stream;
    BlockOutput output(-1);
    lzma_ret status = LZMA_OK;
    bool hasMemory;
    {
        AllowThreads allowThreads(globalObject);
        stream.next_in = input.data();
        stream.avail_in = input.size();
        hasMemory = output.grow();
        while (hasMemory) {
            auto room = output.room();
            stream.next_out = room.data();
            stream.avail_out = room.size();
            status = lzma_code(&stream, action);
            output.didWrite(room.size() - stream.avail_out);
            // It had nothing to do, which is no error.
            if (status == LZMA_BUF_ERROR && input.empty() && stream.avail_out > 0)
                status = LZMA_OK;
            if (isError(status))
                break;
            if ((action == LZMA_RUN && !stream.avail_in) || (action == LZMA_FINISH && status == LZMA_STREAM_END))
                break;
            if (!stream.avail_out)
                hasMemory = output.grow();
        }
        stream.next_in = nullptr;
        stream.avail_in = 0;
        stream.next_out = nullptr;
        stream.avail_out = 0;
    }
    if (action == LZMA_FINISH)
        state.stream.end();
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
    RELEASE_AND_RETURN(scope, runCompressor(globalObject, state, input.buffer.span(), LZMA_RUN));
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
    RELEASE_AND_RETURN(scope, runCompressor(globalObject, state, {}, LZMA_FINISH));
}

static constexpr NativeDef compressorMethods[] = {
    PY_NEW(compressorNew, "($type, *args, **kwargs)"),
    PY_METHOD("compress", compressorCompress, "($self, data, /)"),
    PY_METHOD("flush", compressorFlush, "($self, /)"),
};

static constexpr TypeDef compressorTypeDef { "_lzma.LZMACompressor"_s, { TypeFlag::Immutable }, compressorMethods, {}, {} };

// ---- LZMADecompressor ----

struct Decompressor : DecompressorState {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(Decompressor);

    Stream stream { memory };
    int check { checkUnknown };
};

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(Decompressor);

static JSValue decompressorNew(JSGlobalObject* globalObject, JSValue cls, const CallArgs& args)
{
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    static constexpr ASCIILiteral names[] = { "format"_s, "memlimit"_s, "filters"_s };
    JSValue values[3];
    if (!unpackArguments(globalObject, { "LZMADecompressor"_s, 0, 0, 3, names }, args, values))
        return {};
    int format;
    if (!intArgument(globalObject, values[0], FormatAuto, format))
        return {};
    JSValue memoryLimitValue = values[1] ? values[1] : jsUndefined();
    JSValue filters = values[2] ? values[2] : jsUndefined();

    uint64_t memoryLimit = std::numeric_limits<uint64_t>::max();
    if (!isNone(memoryLimitValue)) {
        if (format == FormatRaw)
            return raiseValueError(globalObject, scope, "Cannot specify memory limit with FORMAT_RAW"_s);
        if (!unsignedValue(globalObject, memoryLimitValue, "uint64_t"_s, memoryLimit))
            return {};
    }
    if (format == FormatRaw && isNone(filters))
        return raiseValueError(globalObject, scope, "Must specify filters for FORMAT_RAW"_s);
    if (format != FormatRaw && !isNone(filters))
        return raiseValueError(globalObject, scope, "Cannot specify filters except with FORMAT_RAW"_s);

    constexpr uint32_t flags = LZMA_TELL_ANY_CHECK | LZMA_TELL_NO_CHECK;
    auto state = makeUnique<Decompressor>();
    lzma_stream& stream = state->stream.stream;
    lzma_ret status;
    switch (format) {
    case FormatAuto:
        status = lzma_auto_decoder(&stream, memoryLimit, flags);
        break;
    case FormatXZ:
        status = lzma_stream_decoder(&stream, memoryLimit, flags);
        break;
    case FormatAlone:
        state->check = LZMA_CHECK_NONE;
        status = lzma_alone_decoder(&stream, memoryLimit);
        break;
    case FormatRaw: {
        state->check = LZMA_CHECK_NONE;
        FilterChain chain;
        if (!parseFilterChain(globalObject, filters, chain))
            return {};
        status = lzma_raw_decoder(&stream, chain.filters);
        break;
    }
    default:
        return raiseValueError(globalObject, scope, "Invalid container format: "_s, format);
    }
    if (isError(status))
        RELEASE_AND_RETURN(scope, raiseError(globalObject, status));
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
    if (!unpackArguments(globalObject, { "decompress"_s, 0, 1, 2, names }, args, values))
        return {};
    BufferHolder input(globalObject);
    if (!input.get(values[0]))
        return {};
    int64_t maxLength = -1;
    if (values[1] && !ssizeArgument(globalObject, values[1], maxLength))
        return {};
    auto* self = uncheckedDowncast<PyRecord>(selfValue.asCell());
    auto& state = *stateOf<Decompressor>(self);
    ObjectLocker locker(globalObject, state.lock);
    if (!locker || !refreshBuffers(globalObject, input))
        return {};
    if (state.isAtEnd)
        return raiseEOFError(globalObject, scope, "Already at end of stream"_s);

    lzma_stream& stream = state.stream.stream;
    lzma_ret status = LZMA_OK;
    int check = state.check;
    auto run = [&](std::span<const uint8_t>& rest, BlockOutput& output, DecompressionOutcome& outcome) {
        outcome.hasMemoryForOutput = output.grow();
        while (outcome.hasMemoryForOutput) {
            auto room = output.room();
            stream.next_in = rest.data();
            stream.avail_in = rest.size();
            stream.next_out = room.data();
            stream.avail_out = room.size();
            status = lzma_code(&stream, LZMA_RUN);
            rest = rest.last(stream.avail_in);
            output.didWrite(room.size() - stream.avail_out);
            // It had nothing to do, which is no error.
            if (status == LZMA_BUF_ERROR && rest.empty() && stream.avail_out > 0)
                status = LZMA_OK;
            if (isError(status)) {
                outcome.isContent = false;
                break;
            }
            if (status == LZMA_GET_CHECK || status == LZMA_NO_CHECK)
                check = lzma_get_check(&stream);
            if (status == LZMA_STREAM_END) {
                outcome.isAtEnd = true;
                break;
            }
            // In this order: with all the input taken, it may still hold output that there was no room for.
            if (!stream.avail_out) {
                if (output.isAtLimit())
                    break;
                outcome.hasMemoryForOutput = output.grow();
            } else if (rest.empty())
                break;
        }
        stream.next_in = nullptr;
        stream.avail_in = 0;
        stream.next_out = nullptr;
        stream.avail_out = 0;
    };
    auto didRun = [&] {
        state.check = check;
        if (state.isAtEnd)
            state.stream.end();
    };
    RELEASE_AND_RETURN(scope, decompressWith<true>(globalObject, self, state, input.buffer.span(), maxLength, run, didRun, [&] { return raiseError(globalObject, status); }));
}

static JSValue decompressorCheck(JSGlobalObject*, JSValue self) { return jsNumber(stateOf<Decompressor>(self)->check); }

static constexpr NativeDef decompressorMethods[] = {
    PY_NEW(decompressorNew, "!($type, /, format=FORMAT_AUTO, memlimit=None, filters=None)"),
    PY_METHOD("decompress", decompressorDecompress, "!($self, /, data, max_length=-1)"),
};

static constexpr NativeGetSet decompressorGetSets[] = {
    PY_MEMBER("check", decompressorCheck),
    PY_MEMBER("eof", decompressorEOF<Decompressor>),
    PY_MEMBER("needs_input", decompressorNeedsInput<Decompressor>),
    { "unused_data"_s, decompressorUnusedData },
};

static constexpr TypeDef decompressorTypeDef { "_lzma.LZMADecompressor"_s, { TypeFlag::Immutable }, decompressorMethods, decompressorGetSets, {} };

// ---- Functions ----

static JSValue isCheckSupported(JSGlobalObject* globalObject, JSValue checkValue)
{
    int check;
    if (!intArgument(globalObject, checkValue, 0, check))
        return {};
    return jsBoolean(lzma_check_is_supported(static_cast<lzma_check>(check)));
}

static JSValue encodeFilterProperties(JSGlobalObject* globalObject, JSValue specifier)
{
    Filter filter;
    if (!parseFilter(globalObject, specifier, filter))
        return {};
    uint32_t size;
    lzma_ret status = lzma_properties_size(&size, &filter.filter);
    if (isError(status))
        return raiseError(globalObject, status);
    PyBytes* result = newBytes(globalObject, size);
    if (!result)
        return {};
    // An empty bytes is everybody's.
    uint8_t nothing;
    status = lzma_properties_encode(&filter.filter, size ? result->mutableData() : &nothing);
    if (isError(status))
        return raiseError(globalObject, status);
    return result;
}

static JSValue decodeFilterProperties(JSGlobalObject* globalObject, JSValue idValue, JSValue properties)
{
    lzma_filter filter { LZMA_VLI_UNKNOWN, nullptr };
    if (!unsignedValue(globalObject, idValue, "lzma_vli"_s, filter.id))
        return {};
    BufferHolder input(globalObject);
    if (!input.get(properties))
        return {};
    LibraryMemory memory;
    lzma_allocator allocator { allocate, release, &memory };
    lzma_ret status = lzma_properties_decode(&filter, &allocator, input.buffer.data, static_cast<size_t>(input.buffer.length));
    if (isError(status))
        return raiseError(globalObject, status);
    JSValue result = buildFilterSpecifier(globalObject, filter);
    LibraryMemory::free(filter.options);
    return result;
}

static constexpr NativeDef functions[] = {
    PY_FUNCTION("is_check_supported", isCheckSupported, "(check_id, /)"),
    PY_FUNCTION("_encode_filter_properties", encodeFilterProperties, "(filter, /)"),
    PY_FUNCTION("_decode_filter_properties", decodeFilterProperties, "(filter_id, encoded_props, /)"),
};

} // namespace Lzma

void initializeLzmaModule(JSGlobalObject* globalObject, PyModule* module)
{
    using namespace Lzma;
    Runtime& rt = runtime(globalObject);

    // The library picks its CRC functions, by what the processor can do, at the first call of each, without a lock. This is that
    // call, made while no other thread can make it. (They are declared pure: a call whose result goes nowhere may be left out.)
    uint8_t byte = 0;
    [[maybe_unused]] volatile uint64_t sums = lzma_crc32(&byte, 1, 0) ^ lzma_crc64(&byte, 1, 0);

    module->addFunctions(globalObject, functions);

    static constexpr std::pair<ASCIILiteral, int64_t> constants[] = {
        { "FORMAT_AUTO"_s, FormatAuto },
        { "FORMAT_XZ"_s, FormatXZ },
        { "FORMAT_ALONE"_s, FormatAlone },
        { "FORMAT_RAW"_s, FormatRaw },
        { "CHECK_NONE"_s, LZMA_CHECK_NONE },
        { "CHECK_CRC32"_s, LZMA_CHECK_CRC32 },
        { "CHECK_CRC64"_s, LZMA_CHECK_CRC64 },
        { "CHECK_SHA256"_s, LZMA_CHECK_SHA256 },
        { "CHECK_ID_MAX"_s, LZMA_CHECK_ID_MAX },
        { "CHECK_UNKNOWN"_s, checkUnknown },
        { "FILTER_LZMA1"_s, static_cast<int64_t>(LZMA_FILTER_LZMA1) },
        { "FILTER_LZMA2"_s, LZMA_FILTER_LZMA2 },
        { "FILTER_DELTA"_s, LZMA_FILTER_DELTA },
        { "FILTER_X86"_s, LZMA_FILTER_X86 },
        { "FILTER_IA64"_s, LZMA_FILTER_IA64 },
        { "FILTER_ARM"_s, LZMA_FILTER_ARM },
        { "FILTER_ARMTHUMB"_s, LZMA_FILTER_ARMTHUMB },
        { "FILTER_SPARC"_s, LZMA_FILTER_SPARC },
        { "FILTER_POWERPC"_s, LZMA_FILTER_POWERPC },
        { "MF_HC3"_s, LZMA_MF_HC3 },
        { "MF_HC4"_s, LZMA_MF_HC4 },
        { "MF_BT2"_s, LZMA_MF_BT2 },
        { "MF_BT3"_s, LZMA_MF_BT3 },
        { "MF_BT4"_s, LZMA_MF_BT4 },
        { "MODE_FAST"_s, LZMA_MODE_FAST },
        { "MODE_NORMAL"_s, LZMA_MODE_NORMAL },
        { "PRESET_DEFAULT"_s, LZMA_PRESET_DEFAULT },
        { "PRESET_EXTREME"_s, static_cast<int64_t>(LZMA_PRESET_EXTREME) },
    };
    for (auto& [name, value] : constants)
        module->add(globalObject, name, makeInt(globalObject, value));

    module->add(globalObject, "LZMAError"_s, errorType(globalObject));
    module->add(globalObject, "LZMACompressor"_s, rt.typeFor(compressorTypeDef));
    module->add(globalObject, "LZMADecompressor"_s, rt.typeFor(decompressorTypeDef));
}

} // namespace PythonModules
} // namespace Bun
