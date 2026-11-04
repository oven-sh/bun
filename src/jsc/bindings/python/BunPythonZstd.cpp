#include "BunPythonModule.h"

#include <wtf/RefCounted.h>
#include <zdict.h>
#include <zstd.h>

// The module _zstd, under compression.zstd. (Modules/_zstd/ in CPython is the reference.)

namespace Bun {
namespace PythonModules {
namespace Zstd {

static constexpr TypeDef errorTypeDef { "compression.zstd.ZstdError"_s, { TypeFlag::Base, TypeFlag::Mutable, TypeFlag::HasWeakref }, {}, {}, "An error occurred in the zstd library."_s };

static PyType* errorType(JSGlobalObject* globalObject)
{
    Runtime& rt = runtime(globalObject);
    return rt.typeFor(errorTypeDef, rt.Exception());
}

static JSValue raiseZstdError(JSGlobalObject* globalObject, const String& message)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return raise(globalObject, scope, errorType(globalObject), message);
}

static JSValue raiseZstdError(JSGlobalObject* globalObject, ASCIILiteral what, size_t code)
{
    return raiseZstdError(globalObject, makeString(what, ": "_s, String::fromUTF8(ZSTD_getErrorName(code))));
}

// What a context writes to.
class Output : public OutputMemory {
public:
    explicit Output(size_t initialSize, int64_t limit = -1)
        : OutputMemory(initialSize, 32 * 1024, limit)
        , buffer { memory().data(), memory().size(), 0 }
    {
    }

    bool isFull() const { return buffer.pos == buffer.size; }

    bool grow()
    {
        if (!growMemory())
            return false;
        buffer.dst = memory().data();
        buffer.size = memory().size();
        return true;
    }

    JSValue finish(JSGlobalObject* globalObject) { return bytesOfFirst(globalObject, buffer.pos); }

    ZSTD_outBuffer buffer;
};

static JSValue raiseNoMemory(JSGlobalObject* globalObject)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return raiseMemoryError(globalObject, scope, String());
}

// ---- Parameters ----

// set_parameter_types() leaves them with the types that check against them.
static constexpr unsigned parameterTypeField = 0;

struct ParameterName {
    int parameter;
    ASCIILiteral name;
};

static constexpr ParameterName compressionParameters[] = {
    { ZSTD_c_compressionLevel, "compression_level"_s },
    { ZSTD_c_windowLog, "window_log"_s },
    { ZSTD_c_hashLog, "hash_log"_s },
    { ZSTD_c_chainLog, "chain_log"_s },
    { ZSTD_c_searchLog, "search_log"_s },
    { ZSTD_c_minMatch, "min_match"_s },
    { ZSTD_c_targetLength, "target_length"_s },
    { ZSTD_c_strategy, "strategy"_s },
    { ZSTD_c_enableLongDistanceMatching, "enable_long_distance_matching"_s },
    { ZSTD_c_ldmHashLog, "ldm_hash_log"_s },
    { ZSTD_c_ldmMinMatch, "ldm_min_match"_s },
    { ZSTD_c_ldmBucketSizeLog, "ldm_bucket_size_log"_s },
    { ZSTD_c_ldmHashRateLog, "ldm_hash_rate_log"_s },
    { ZSTD_c_contentSizeFlag, "content_size_flag"_s },
    { ZSTD_c_checksumFlag, "checksum_flag"_s },
    { ZSTD_c_dictIDFlag, "dict_id_flag"_s },
    { ZSTD_c_nbWorkers, "nb_workers"_s },
    { ZSTD_c_jobSize, "job_size"_s },
    { ZSTD_c_overlapLog, "overlap_log"_s },
};

static constexpr ParameterName decompressionParameters[] = {
    { ZSTD_d_windowLogMax, "window_log_max"_s },
};

static void raiseParameterError(JSGlobalObject* globalObject, bool isCompression, int key, int value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    std::span<const ParameterName> known = isCompression ? std::span<const ParameterName>(compressionParameters) : std::span<const ParameterName>(decompressionParameters);
    ASCIILiteral type = isCompression ? "compression"_s : "decompression"_s;
    String name;
    for (auto& parameter : known) {
        if (parameter.parameter == key)
            name = parameter.name;
    }
    if (name.isNull())
        name = makeString("unknown parameter (key "_s, key, ')');
    ZSTD_bounds bounds = isCompression ? ZSTD_cParam_getBounds(static_cast<ZSTD_cParameter>(key)) : ZSTD_dParam_getBounds(static_cast<ZSTD_dParameter>(key));
    if (ZSTD_isError(bounds.error)) {
        raiseValueError(globalObject, scope, "invalid "_s, type, " parameter '"_s, name, '\'');
        return;
    }
    raiseValueError(globalObject, scope, type, " parameter '"_s, name, "' received an illegal value "_s, value, "; the valid range is ["_s, bounds.lowerBound, ", "_s, bounds.upperBound, ']');
}

// ---- ZstdDict ----

enum DictionaryUse : int { Digested = 0,
    Undigested = 1,
    Prefix = 2 };

// The contexts that use a dictionary read it until they are freed, and objects that die together are finalized in no
// particular order. So this belongs to all of them.
class Dictionary : public RefCounted<Dictionary> {
    WTF_MAKE_TZONE_ALLOCATED(Dictionary);

public:
    static Ref<Dictionary> create(Vector<uint8_t>&& content) { return adoptRef(*new Dictionary(WTF::move(content))); }

    ~Dictionary()
    {
        ZSTD_freeDDict(m_forDecompression);
        for (auto& [level, dictionary] : m_forCompression)
            ZSTD_freeCDict(dictionary);
    }

    std::span<const uint8_t> content() const { return m_content.span(); }
    uint32_t id() const { return m_id; }

    // Null: it could not be made.
    ZSTD_DDict* digestedForDecompression()
    {
        if (!m_forDecompression)
            m_forDecompression = ZSTD_createDDict(m_content.span().data(), m_content.size());
        return m_forDecompression;
    }

    ZSTD_CDict* digestedForCompression(int level)
    {
        for (auto& [itsLevel, dictionary] : m_forCompression) {
            if (itsLevel == level)
                return dictionary;
        }
        ZSTD_CDict* dictionary = ZSTD_createCDict(m_content.span().data(), m_content.size(), level);
        if (dictionary)
            m_forCompression.append({ level, dictionary });
        return dictionary;
    }

private:
    explicit Dictionary(Vector<uint8_t>&& content)
        : m_content(WTF::move(content))
        , m_id(ZSTD_getDictID_fromDict(m_content.span().data(), m_content.size()))
    {
    }

    Vector<uint8_t> m_content;
    uint32_t m_id;
    ZSTD_DDict* m_forDecompression { nullptr };
    Vector<std::pair<int, ZSTD_CDict*>> m_forCompression;
};

WTF_MAKE_TZONE_ALLOCATED_IMPL(Dictionary);

struct DictionaryHolder {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(DictionaryHolder);
    Ref<Dictionary> dictionary;
};

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(DictionaryHolder);

static Dictionary& dictionaryOf(JSValue self) { return stateOf<DictionaryHolder>(self)->dictionary.get(); }

static JSValue dictionaryNew(JSGlobalObject* globalObject, JSValue cls, JSValue content, JSValue isRawValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder input(globalObject);
    if (failed(scope, input.get(content)))
        return {};
    bool isRaw = false;
    if (isRawValue) {
        isRaw = isTrue(globalObject, isRawValue);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (failed(scope, refreshBuffers(globalObject, input)))
        return {};
    if (input.buffer.length < 8)
        return raiseValueError(globalObject, scope, "Zstandard dictionary content too short (must have at least eight bytes)"_s);
    Vector<uint8_t> copy;
    if (!copy.tryAppend(input.buffer.span()))
        return raiseMemoryError(globalObject, scope, String());
    size_t size = copy.size();
    Ref<Dictionary> dictionary = Dictionary::create(WTF::move(copy));
    if (!isRaw && !dictionary->id())
        return raiseValueError(globalObject, scope, "invalid Zstandard dictionary"_s);
    RELEASE_AND_RETURN(scope, createRecordWithState(globalObject, PyType::from(cls), 0, std::unique_ptr<DictionaryHolder>(new DictionaryHolder { WTF::move(dictionary) }), size));
}

static JSValue dictionaryRepr(JSGlobalObject* globalObject, JSValue self)
{
    Dictionary& dictionary = dictionaryOf(self);
    return makeStr(getVM(globalObject), makeString("<ZstdDict dict_id="_s, dictionary.id(), " dict_size="_s, dictionary.content().size(), '>'));
}

static JSValue dictionaryLength(JSGlobalObject*, JSValue self) { return jsNumber(dictionaryOf(self).content().size()); }
static JSValue dictionaryID(JSGlobalObject*, JSValue self) { return jsNumber(dictionaryOf(self).id()); }
static JSValue dictionaryContent(JSGlobalObject* globalObject, JSValue self) { return bytesFrom(globalObject, dictionaryOf(self).content()); }
static JSValue asDigested(JSGlobalObject* globalObject, JSValue self) { return PyTuple::create(globalObject, { self, jsNumber(Digested) }); }
static JSValue asUndigested(JSGlobalObject* globalObject, JSValue self) { return PyTuple::create(globalObject, { self, jsNumber(Undigested) }); }
static JSValue asPrefix(JSGlobalObject* globalObject, JSValue self) { return PyTuple::create(globalObject, { self, jsNumber(Prefix) }); }

static constexpr NativeDef dictionaryMethods[] = {
    PY_NEW(dictionaryNew, "($type, dict_content, /, *, is_raw=False)"),
    PY_SLOT("__repr__", dictionaryRepr, "($self, /)"),
    PY_SLOT("__len__", dictionaryLength, "($self, /)"),
};

static constexpr NativeGetSet dictionaryGetSets[] = {
    PY_MEMBER("dict_id", dictionaryID),
    { "dict_content"_s, dictionaryContent },
    { "as_digested_dict"_s, asDigested },
    { "as_undigested_dict"_s, asUndigested },
    { "as_prefix"_s, asPrefix },
};

static constexpr TypeDef dictionaryTypeDef { "compression.zstd.ZstdDict"_s, { TypeFlag::Immutable }, dictionaryMethods, dictionaryGetSets, {} };

// The zstd_dict argument: a ZstdDict, or what one of its as_... attributes gives. Null: a TypeError.
static Dictionary* parseDictionaryArgument(JSGlobalObject* globalObject, JSValue argument, int& use)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    PyType* type = runtime(globalObject).typeFor(dictionaryTypeDef);
    if (PyRecord::tryFrom(argument, type))
        return &dictionaryOf(argument);
    if (auto* tuple = PyTuple::tryFrom(argument); tuple && typeOf(globalObject, argument) == runtime(globalObject).tupleType() && tuple->length() == 2
        && PyRecord::tryFrom(tuple->at(0), type) && isInt(tuple->at(1))) {
        int requested = toCInt(globalObject, tuple->at(1));
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (requested == Digested || requested == Undigested || requested == Prefix) {
            use = requested;
            return &dictionaryOf(tuple->at(0));
        }
    }
    raiseTypeError(globalObject, scope, "zstd_dict argument should be a ZstdDict object."_s);
    return nullptr;
}

// ---- ZstdCompressor ----

struct Compressor {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(Compressor);
    ~Compressor() { ZSTD_freeCCtx(context); }

    ZSTD_CCtx* context { nullptr };
    RefPtr<Dictionary> dictionary;
    int lastMode { ZSTD_e_end };
    int level { ZSTD_CLEVEL_DEFAULT };
    bool usesThreads { false };
};

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(Compressor);

static bool setLevel(JSGlobalObject* globalObject, Compressor& compressor, int level)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (level < ZSTD_minCLevel() || level > ZSTD_maxCLevel()) {
        raiseValueError(globalObject, scope, "illegal compression level "_s, level, "; the valid range is ["_s, ZSTD_minCLevel(), ", "_s, ZSTD_maxCLevel(), ']');
        return false;
    }
    compressor.level = level;
    size_t result = ZSTD_CCtx_setParameter(compressor.context, ZSTD_c_compressionLevel, level);
    if (ZSTD_isError(result)) {
        scope.release();
        raiseZstdError(globalObject, "Unable to set zstd compression level"_s, result);
        return false;
    }
    return true;
}

// The `options` of either constructor. `set` returns false when it has raised.
template<typename Functor>
static bool forEachOption(JSGlobalObject* globalObject, ASCIILiteral constructor, JSValue options, PyType* typeWithTheOthersParameters, ASCIILiteral messageForTheOthers, const Functor& set)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!isDict(options)) {
        raiseTypeError(globalObject, scope, constructor, "() argument 'options' must be dict, not "_s, typeNameForMessage(globalObject, typeOf(globalObject, options)));
        return false;
    }
    JSValue wrongKeyType = hiddenField(globalObject, typeWithTheOthersParameters, parameterTypeField);
    auto* dict = PyDict::from(options);
    JSValue key, value;
    for (unsigned position = 0; dict->next(position, key, value);) {
        if (wrongKeyType && JSValue(typeOf(globalObject, key)) == wrongKeyType) {
            raiseTypeError(globalObject, scope, messageForTheOthers);
            return false;
        }
        int parameter = toCInt(globalObject, key);
        RETURN_IF_EXCEPTION(scope, false);
        int setting = toCInt(globalObject, value);
        RETURN_IF_EXCEPTION(scope, false);
        bool isSet = set(parameter, setting);
        RETURN_IF_EXCEPTION(scope, false);
        ASSERT_UNUSED(isSet, isSet);
    }
    return true;
}

static PyType* compressorType(JSGlobalObject*);
static PyType* decompressorType(JSGlobalObject*);

static JSValue compressorNew(JSGlobalObject* globalObject, JSValue cls, JSValue level, JSValue options, JSValue dictionaryArgument)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto isGiven = [](JSValue value) { return value && !value.isUndefined(); };
    auto compressor = makeUnique<Compressor>();
    compressor->context = ZSTD_createCCtx();
    if (!compressor->context)
        RELEASE_AND_RETURN(scope, raiseZstdError(globalObject, "Unable to create ZSTD_CCtx instance."_s));
    if (isGiven(level) && isGiven(options))
        return raiseTypeError(globalObject, scope, "Only one of level or options should be used."_s);

    if (isGiven(level)) {
        if (!isInt(level))
            return raiseTypeError(globalObject, scope, "invalid type for level, expected int"_s);
        auto wide = tryInt64(intValue(level));
        if (!wide || *wide < std::numeric_limits<int>::min() || *wide > std::numeric_limits<int>::max())
            return raiseValueError(globalObject, scope, "illegal compression level; the valid range is ["_s, ZSTD_minCLevel(), ", "_s, ZSTD_maxCLevel(), ']');
        if (failed(scope, setLevel(globalObject, *compressor, static_cast<int>(*wide))))
            return {};
    }
    if (isGiven(options)) {
        bool isDone = forEachOption(globalObject, "ZstdCompressor"_s, options, decompressorType(globalObject), "compression options dictionary key must not be a DecompressionParameter attribute"_s, [&](int parameter, int setting) {
            if (parameter == ZSTD_c_compressionLevel)
                return setLevel(globalObject, *compressor, setting);
            if (parameter == ZSTD_c_nbWorkers && setting)
                compressor->usesThreads = true;
            if (ZSTD_isError(ZSTD_CCtx_setParameter(compressor->context, static_cast<ZSTD_cParameter>(parameter), setting))) {
                raiseParameterError(globalObject, true, parameter, setting);
                return false;
            }
            return true;
        });
        if (failed(scope, isDone))
            return {};
    }
    if (isGiven(dictionaryArgument)) {
        int use = Undigested;
        Dictionary* dictionary = parseDictionaryArgument(globalObject, dictionaryArgument, use);
        RETURN_IF_EXCEPTION(scope, {});
        if (!dictionary)
            return {};
        compressor->dictionary = dictionary;
        auto content = dictionary->content();
        size_t result;
        if (use == Digested) {
            ZSTD_CDict* digested = dictionary->digestedForCompression(compressor->level);
            if (!digested)
                RELEASE_AND_RETURN(scope, raiseZstdError(globalObject, "Failed to create a ZSTD_CDict instance from Zstandard dictionary content."_s));
            result = ZSTD_CCtx_refCDict(compressor->context, digested);
        } else if (use == Undigested)
            result = ZSTD_CCtx_loadDictionary(compressor->context, content.data(), content.size());
        else
            result = ZSTD_CCtx_refPrefix(compressor->context, content.data(), content.size());
        if (ZSTD_isError(result))
            RELEASE_AND_RETURN(scope, raiseZstdError(globalObject, "Unable to load Zstandard dictionary or prefix for compression"_s, result));
    }
    size_t size = ZSTD_sizeof_CCtx(compressor->context);
    RELEASE_AND_RETURN(scope, createRecordWithState(globalObject, PyType::from(cls), 0, WTF::move(compressor), size));
}

static JSValue compressWith(JSGlobalObject* globalObject, Compressor& compressor, std::span<const uint8_t> data, ZSTD_EndDirective mode)
{
    ZSTD_inBuffer input { data.data(), data.size(), 0 };
    // With threads, ZSTD_e_continue only hands the input over, and the output comes when it comes.
    bool onlyHandsOver = compressor.usesThreads && mode == ZSTD_e_continue;
    Output output(onlyHandsOver ? 32 * 1024 : ZSTD_compressBound(data.size()));
    if (!output.isValid())
        return raiseNoMemory(globalObject);
    while (true) {
        size_t result = ZSTD_compressStream2(compressor.context, &output.buffer, &input, mode);
        if (ZSTD_isError(result))
            return raiseZstdError(globalObject, "Unable to compress Zstandard data"_s, result);
        if (onlyHandsOver ? !output.isFull() && input.pos == input.size : !result)
            break;
        if (output.isFull() && !output.grow())
            return raiseNoMemory(globalObject);
    }
    return output.finish(globalObject);
}

static JSValue compressAndRemember(JSGlobalObject* globalObject, Compressor& compressor, std::span<const uint8_t> data, int mode)
{
    JSValue result = compressWith(globalObject, compressor, data, static_cast<ZSTD_EndDirective>(mode));
    if (result)
        compressor.lastMode = mode;
    else {
        compressor.lastMode = ZSTD_e_end;
        ZSTD_CCtx_reset(compressor.context, ZSTD_reset_session_only);
    }
    return result;
}

static JSValue compressorCompress(JSGlobalObject* globalObject, JSValue self, JSValue data, JSValue modeValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder input(globalObject);
    int mode;
    if (failed(scope, input.get(data)) || failed(scope, intArgument(globalObject, modeValue, ZSTD_e_continue, mode)) || failed(scope, refreshBuffers(globalObject, input)))
        return {};
    if (mode != ZSTD_e_continue && mode != ZSTD_e_flush && mode != ZSTD_e_end)
        return raiseValueError(globalObject, scope, "mode argument wrong value, it should be one of ZstdCompressor.CONTINUE, ZstdCompressor.FLUSH_BLOCK, ZstdCompressor.FLUSH_FRAME."_s);
    RELEASE_AND_RETURN(scope, compressAndRemember(globalObject, *stateOf<Compressor>(self), input.buffer.span(), mode));
}

static JSValue compressorFlush(JSGlobalObject* globalObject, JSValue self, JSValue modeValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int mode;
    if (failed(scope, intArgument(globalObject, modeValue, ZSTD_e_end, mode)))
        return {};
    if (mode != ZSTD_e_end && mode != ZSTD_e_flush)
        return raiseValueError(globalObject, scope, "mode argument wrong value, it should be ZstdCompressor.FLUSH_FRAME or ZstdCompressor.FLUSH_BLOCK."_s);
    RELEASE_AND_RETURN(scope, compressAndRemember(globalObject, *stateOf<Compressor>(self), {}, mode));
}

static JSValue compressorSetPledgedInputSize(JSGlobalObject* globalObject, JSValue self, JSValue sizeValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    unsigned long long size = ZSTD_CONTENTSIZE_UNKNOWN;
    if (!sizeValue.isUndefined()) {
        if (!isInt(sizeValue))
            return raiseTypeError(globalObject, scope, "an integer is required"_s);
        auto converted = tryUInt64(intValue(sizeValue));
        if (!converted || *converted >= ZSTD_CONTENTSIZE_ERROR)
            return raiseValueError(globalObject, scope, "size argument should be a positive int less than "_s, static_cast<uint64_t>(ZSTD_CONTENTSIZE_ERROR));
        size = *converted;
    }
    auto& compressor = *stateOf<Compressor>(self);
    if (compressor.lastMode != ZSTD_e_end)
        return raiseValueError(globalObject, scope, "set_pledged_input_size() method must be called when last_mode == FLUSH_FRAME"_s);
    size_t result = ZSTD_CCtx_setPledgedSrcSize(compressor.context, size);
    if (ZSTD_isError(result))
        RELEASE_AND_RETURN(scope, raiseZstdError(globalObject, "Unable to set pledged uncompressed content size"_s, result));
    return jsUndefined();
}

static JSValue compressorLastMode(JSGlobalObject*, JSValue self) { return jsNumber(stateOf<Compressor>(self)->lastMode); }

static constexpr NativeDef compressorMethods[] = {
    PY_NEW(compressorNew, "($type, /, level=None, options=None, zstd_dict=None)"),
    PY_METHOD("compress", compressorCompress, "($self, /, data, mode=ZstdCompressor.CONTINUE)"),
    PY_METHOD("flush", compressorFlush, "($self, /, mode=ZstdCompressor.FLUSH_FRAME)"),
    PY_METHOD("set_pledged_input_size", compressorSetPledgedInputSize, "($self, size, /)"),
};

static constexpr NativeGetSet compressorGetSets[] = {
    PY_MEMBER("last_mode", compressorLastMode),
};

static constexpr TypeDef compressorTypeDef { "compression.zstd.ZstdCompressor"_s, { TypeFlag::Immutable }, compressorMethods, compressorGetSets, {} };

static PyType* compressorType(JSGlobalObject* globalObject) { return runtime(globalObject).typeFor(compressorTypeDef); }

// ---- ZstdDecompressor ----

struct Decompressor {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(Decompressor);
    ~Decompressor() { ZSTD_freeDCtx(context); }

    std::span<const uint8_t> pending() const { return pendingInput.span().subspan(pendingStart); }
    void clearPending()
    {
        pendingInput.shrink(0);
        pendingStart = 0;
    }

    ZSTD_DCtx* context { nullptr };
    RefPtr<Dictionary> dictionary;
    // Input it was given and has not got to: at the end of the frame, what follows it.
    Vector<uint8_t> pendingInput;
    size_t pendingStart { 0 };
    bool needsInput { true };
    bool isAtEnd { false };
};

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(Decompressor);

enum DecompressorField : unsigned { UnusedData,
    DecompressorFieldCount };

static JSValue decompressorNew(JSGlobalObject* globalObject, JSValue cls, JSValue dictionaryArgument, JSValue options)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto isGiven = [](JSValue value) { return value && !value.isUndefined(); };
    auto decompressor = makeUnique<Decompressor>();
    decompressor->context = ZSTD_createDCtx();
    if (!decompressor->context)
        RELEASE_AND_RETURN(scope, raiseZstdError(globalObject, "Unable to create ZSTD_DCtx instance."_s));

    if (isGiven(dictionaryArgument)) {
        int use = Digested;
        Dictionary* dictionary = parseDictionaryArgument(globalObject, dictionaryArgument, use);
        RETURN_IF_EXCEPTION(scope, {});
        if (!dictionary)
            return {};
        decompressor->dictionary = dictionary;
        auto content = dictionary->content();
        size_t result;
        if (use == Digested) {
            ZSTD_DDict* digested = dictionary->digestedForDecompression();
            if (!digested)
                RELEASE_AND_RETURN(scope, raiseZstdError(globalObject, "Failed to create a ZSTD_DDict instance from Zstandard dictionary content."_s));
            result = ZSTD_DCtx_refDDict(decompressor->context, digested);
        } else if (use == Undigested)
            result = ZSTD_DCtx_loadDictionary(decompressor->context, content.data(), content.size());
        else
            result = ZSTD_DCtx_refPrefix(decompressor->context, content.data(), content.size());
        if (ZSTD_isError(result))
            RELEASE_AND_RETURN(scope, raiseZstdError(globalObject, "Unable to load Zstandard dictionary or prefix for decompression"_s, result));
    }
    if (isGiven(options)) {
        bool isDone = forEachOption(globalObject, "ZstdDecompressor"_s, options, compressorType(globalObject), "decompression options dictionary key must not be a CompressionParameter attribute"_s, [&](int parameter, int setting) {
            if (ZSTD_isError(ZSTD_DCtx_setParameter(decompressor->context, static_cast<ZSTD_dParameter>(parameter), setting))) {
                raiseParameterError(globalObject, false, parameter, setting);
                return false;
            }
            return true;
        });
        if (failed(scope, isDone))
            return {};
    }
    size_t size = ZSTD_sizeof_DCtx(decompressor->context);
    RELEASE_AND_RETURN(scope, createRecordWithState(globalObject, PyType::from(cls), DecompressorFieldCount, WTF::move(decompressor), size));
}

static JSValue decompressFrom(JSGlobalObject* globalObject, Decompressor& decompressor, ZSTD_inBuffer& input, int64_t maxLength)
{
    Output output(32 * 1024, maxLength);
    if (!output.isValid())
        return raiseNoMemory(globalObject);
    while (true) {
        size_t result = ZSTD_decompressStream(decompressor.context, &output.buffer, &input);
        if (ZSTD_isError(result))
            return raiseZstdError(globalObject, "Unable to decompress Zstandard data"_s, result);
        if (!result) {
            decompressor.isAtEnd = true;
            break;
        }
        // The context may hold more than there was room for, whether or not it has taken all the input.
        if (output.isFull()) {
            if (output.isAtLimit())
                break;
            if (!output.grow())
                return raiseNoMemory(globalObject);
        } else if (input.pos == input.size)
            break;
    }
    return output.finish(globalObject);
}

static JSValue decompressorDecompress(JSGlobalObject* globalObject, JSValue selfValue, JSValue data, JSValue maxLengthValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder holder(globalObject);
    if (failed(scope, holder.get(data)))
        return {};
    int64_t maxLength = -1;
    if ((maxLengthValue && failed(scope, ssizeArgument(globalObject, maxLengthValue, maxLength))) || failed(scope, refreshBuffers(globalObject, holder)))
        return {};
    if (maxLength < 0)
        maxLength = -1;
    auto* self = uncheckedDowncast<PyRecord>(selfValue.asCell());
    auto& decompressor = *stateOf<Decompressor>(self);
    if (decompressor.isAtEnd)
        return raiseEOFError(globalObject, scope, "Already at the end of a Zstandard frame."_s);

    auto reset = [&] {
        decompressor.clearPending();
        decompressor.needsInput = true;
        decompressor.isAtEnd = false;
        self->set(vm, UnusedData, JSValue());
        ZSTD_DCtx_reset(decompressor.context, ZSTD_reset_session_only);
    };

    // What is left from last time goes first.
    std::span<const uint8_t> given = holder.buffer.span();
    bool readsPending = !decompressor.pending().empty();
    if (readsPending && !given.empty()) {
        if (decompressor.pendingStart) {
            decompressor.pendingInput.removeAt(0, decompressor.pendingStart);
            decompressor.pendingStart = 0;
        }
        if (!decompressor.pendingInput.tryAppend(given)) {
            reset();
            return raiseMemoryError(globalObject, scope, String());
        }
    }
    std::span<const uint8_t> source = readsPending ? decompressor.pending() : given;
    ZSTD_inBuffer input { source.data(), source.size(), 0 };
    JSValue result = decompressFrom(globalObject, decompressor, input, maxLength);
    if (failed(scope, result)) {
        reset();
        return {};
    }

    if (input.pos == input.size) {
        decompressor.needsInput = !(static_cast<int64_t>(PyBytes::from(result)->length()) == maxLength || decompressor.isAtEnd);
        decompressor.clearPending();
    } else {
        decompressor.needsInput = false;
        if (readsPending)
            decompressor.pendingStart += input.pos;
        else {
            decompressor.clearPending();
            if (!decompressor.pendingInput.tryAppend(source.subspan(input.pos))) {
                reset();
                return raiseMemoryError(globalObject, scope, String());
            }
        }
    }
    return result;
}

static JSValue decompressorUnusedData(JSGlobalObject* globalObject, JSValue selfValue)
{
    auto* self = uncheckedDowncast<PyRecord>(selfValue.asCell());
    auto& decompressor = *stateOf<Decompressor>(self);
    if (!decompressor.isAtEnd)
        return runtime(globalObject).emptyBytes();
    if (JSValue made = self->get(UnusedData))
        return made;
    JSValue unused = bytesFrom(globalObject, decompressor.pending());
    if (unused)
        self->set(getVM(globalObject), UnusedData, unused);
    return unused;
}

static JSValue decompressorEOF(JSGlobalObject*, JSValue self) { return jsBoolean(stateOf<Decompressor>(self)->isAtEnd); }
static JSValue decompressorNeedsInput(JSGlobalObject*, JSValue self) { return jsBoolean(stateOf<Decompressor>(self)->needsInput); }

static constexpr NativeDef decompressorMethods[] = {
    PY_NEW(decompressorNew, "($type, /, zstd_dict=None, options=None)"),
    PY_METHOD("decompress", decompressorDecompress, "($self, /, data, max_length=-1)"),
};

static constexpr NativeGetSet decompressorGetSets[] = {
    PY_MEMBER("eof", decompressorEOF),
    PY_MEMBER("needs_input", decompressorNeedsInput),
    { "unused_data"_s, decompressorUnusedData },
};

static constexpr TypeDef decompressorTypeDef { "compression.zstd.ZstdDecompressor"_s, { TypeFlag::Immutable }, decompressorMethods, decompressorGetSets, {} };

static PyType* decompressorType(JSGlobalObject* globalObject) { return runtime(globalObject).typeFor(decompressorTypeDef); }

// ---- Functions ----

static bool checkArgumentType(JSGlobalObject* globalObject, ASCIILiteral function, unsigned position, ASCIILiteral expected, bool isRight, JSValue value)
{
    if (isRight)
        return true;
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    raiseTypeError(globalObject, scope, function, "() argument "_s, position, " must be "_s, expected, ", not "_s, typeNameOfArgument(globalObject, value));
    return false;
}

// The sizes of the samples, which are one after the other in `samples`.
static bool sampleSizes(JSGlobalObject* globalObject, PyBytes* samples, PyTuple* sizes, Vector<size_t>& result)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto mismatch = [&] {
        raiseValueError(globalObject, scope, "The samples size tuple doesn't match the concatenation's size."_s);
        return false;
    };
    if (!result.tryReserveCapacity(sizes->length())) {
        raiseMemoryError(globalObject, scope, String());
        return false;
    }
    size_t left = samples->length();
    for (unsigned i = 0; i < sizes->length(); ++i) {
        JSValue item = sizes->at(i);
        if (!isInt(item)) {
            raiseTypeError(globalObject, scope, "an integer is required"_s);
            return false;
        }
        auto size = tryUInt64(intValue(item));
        if (!size || *size > left)
            return mismatch();
        left -= *size;
        result.append(*size);
    }
    if (left)
        return mismatch();
    return true;
}

static JSValue trainDict(JSGlobalObject* globalObject, JSValue samples, JSValue sizes, JSValue dictSizeValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (failed(scope, checkArgumentType(globalObject, "train_dict"_s, 1, "bytes"_s, PyBytes::is(samples), samples)) || failed(scope, checkArgumentType(globalObject, "train_dict"_s, 2, "tuple"_s, !!PyTuple::tryFrom(sizes), sizes)))
        return {};
    int64_t dictSize;
    if (failed(scope, ssizeArgument(globalObject, dictSizeValue, dictSize)))
        return {};
    if (dictSize <= 0)
        return raiseValueError(globalObject, scope, "dict_size argument should be positive number."_s);
    Vector<size_t> chunkSizes;
    if (failed(scope, sampleSizes(globalObject, PyBytes::from(samples), PyTuple::from(sizes), chunkSizes)))
        return {};
    Vector<uint8_t> dictionary;
    if (!dictionary.tryGrow(dictSize))
        return raiseMemoryError(globalObject, scope, String());
    size_t result = ZDICT_trainFromBuffer(dictionary.mutableSpan().data(), dictionary.size(), PyBytes::from(samples)->data(), chunkSizes.span().data(), static_cast<unsigned>(chunkSizes.size()));
    if (ZDICT_isError(result))
        RELEASE_AND_RETURN(scope, raiseZstdError(globalObject, "Unable to train the Zstandard dictionary"_s, result));
    RELEASE_AND_RETURN(scope, bytesFrom(globalObject, dictionary.span().first(result)));
}

static JSValue finalizeDict(JSGlobalObject* globalObject, JSValue custom, JSValue samples, JSValue sizes, JSValue dictSizeValue, JSValue levelValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (failed(scope, checkArgumentType(globalObject, "finalize_dict"_s, 1, "bytes"_s, PyBytes::is(custom), custom))
        || failed(scope, checkArgumentType(globalObject, "finalize_dict"_s, 2, "bytes"_s, PyBytes::is(samples), samples))
        || failed(scope, checkArgumentType(globalObject, "finalize_dict"_s, 3, "tuple"_s, !!PyTuple::tryFrom(sizes), sizes)))
        return {};
    int64_t dictSize;
    int level;
    if (failed(scope, ssizeArgument(globalObject, dictSizeValue, dictSize)) || failed(scope, intArgument(globalObject, levelValue, 0, level)))
        return {};
    if (dictSize <= 0)
        return raiseValueError(globalObject, scope, "dict_size argument should be positive number."_s);
    Vector<size_t> chunkSizes;
    if (failed(scope, sampleSizes(globalObject, PyBytes::from(samples), PyTuple::from(sizes), chunkSizes)))
        return {};
    Vector<uint8_t> dictionary;
    if (!dictionary.tryGrow(dictSize))
        return raiseMemoryError(globalObject, scope, String());
    ZDICT_params_t parameters { .compressionLevel = level, .notificationLevel = 0, .dictID = 0 };
    size_t result = ZDICT_finalizeDictionary(dictionary.mutableSpan().data(), dictionary.size(), PyBytes::from(custom)->data(), PyBytes::from(custom)->length(), PyBytes::from(samples)->data(), chunkSizes.span().data(), static_cast<unsigned>(chunkSizes.size()), parameters);
    if (ZDICT_isError(result))
        RELEASE_AND_RETURN(scope, raiseZstdError(globalObject, "Unable to finalize the Zstandard dictionary"_s, result));
    RELEASE_AND_RETURN(scope, bytesFrom(globalObject, dictionary.span().first(result)));
}

static JSValue getParamBounds(JSGlobalObject* globalObject, JSValue parameterValue, JSValue isCompressValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int parameter;
    if (failed(scope, intArgument(globalObject, parameterValue, 0, parameter)))
        return {};
    bool isCompression = isTrue(globalObject, isCompressValue);
    RETURN_IF_EXCEPTION(scope, {});
    ZSTD_bounds bounds = isCompression ? ZSTD_cParam_getBounds(static_cast<ZSTD_cParameter>(parameter)) : ZSTD_dParam_getBounds(static_cast<ZSTD_dParameter>(parameter));
    if (ZSTD_isError(bounds.error))
        RELEASE_AND_RETURN(scope, raiseZstdError(globalObject, isCompression ? "Unable to get zstd compression parameter bounds"_s : "Unable to get zstd decompression parameter bounds"_s, bounds.error));
    RELEASE_AND_RETURN(scope, PyTuple::create(globalObject, { jsNumber(bounds.lowerBound), jsNumber(bounds.upperBound) }));
}

static JSValue getFrameSize(JSGlobalObject* globalObject, JSValue frame)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder input(globalObject);
    if (failed(scope, input.get(frame)))
        return {};
    size_t size = ZSTD_findFrameCompressedSize(input.buffer.data, input.buffer.length);
    if (ZSTD_isError(size))
        RELEASE_AND_RETURN(scope, raiseZstdError(globalObject, makeString("Error when finding the compressed size of a Zstandard frame. Ensure the frame_buffer argument starts from the beginning of a frame, and its length is not less than this complete frame. Zstd error message: "_s, String::fromUTF8(ZSTD_getErrorName(size)), '.')));
    RELEASE_AND_RETURN(scope, makeInt(globalObject, static_cast<uint64_t>(size)));
}

static JSValue getFrameInfo(JSGlobalObject* globalObject, JSValue frame)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder input(globalObject);
    if (failed(scope, input.get(frame)))
        return {};
    unsigned long long size = ZSTD_getFrameContentSize(input.buffer.data, input.buffer.length);
    if (size == ZSTD_CONTENTSIZE_ERROR)
        RELEASE_AND_RETURN(scope, raiseZstdError(globalObject, "Error when getting information from the header of a Zstandard frame. Ensure the frame_buffer argument starts from the beginning of a frame, and its length is not less than the frame header (6~18 bytes)."_s));
    unsigned id = ZSTD_getDictID_fromFrame(input.buffer.data, input.buffer.length);
    RELEASE_AND_RETURN(scope, PyTuple::create(globalObject, { size == ZSTD_CONTENTSIZE_UNKNOWN ? jsUndefined() : makeInt(globalObject, static_cast<uint64_t>(size)), jsNumber(id) }));
}

static JSValue setParameterTypes(JSGlobalObject* globalObject, JSValue compression, JSValue decompression)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!PyType::is(compression))
        return raiseTypeError(globalObject, scope, "set_parameter_types() argument 'c_parameter_type' must be type, not "_s, typeNameOfArgument(globalObject, compression));
    if (!PyType::is(decompression))
        return raiseTypeError(globalObject, scope, "set_parameter_types() argument 'd_parameter_type' must be type, not "_s, typeNameOfArgument(globalObject, decompression));
    setHiddenField(globalObject, compressorType(globalObject), parameterTypeField, compression);
    setHiddenField(globalObject, decompressorType(globalObject), parameterTypeField, decompression);
    return jsUndefined();
}

static constexpr NativeDef functions[] = {
    PY_FUNCTION("train_dict", trainDict, "(samples_bytes, samples_sizes, dict_size, /)"),
    PY_FUNCTION("finalize_dict", finalizeDict, "(custom_dict_bytes, samples_bytes, samples_sizes, dict_size, compression_level, /)"),
    PY_FUNCTION("get_param_bounds", getParamBounds, "(parameter, is_compress)"),
    PY_FUNCTION("get_frame_size", getFrameSize, "(frame_buffer)"),
    PY_FUNCTION("get_frame_info", getFrameInfo, "(frame_buffer)"),
    PY_FUNCTION("set_parameter_types", setParameterTypes, "(c_parameter_type, d_parameter_type)"),
};

} // namespace Zstd

void initializeZstdModule(JSGlobalObject* globalObject, PyModule* module)
{
    using namespace Zstd;
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    module->addFunctions(globalObject, functions);
    module->add(globalObject, "ZstdDict"_s, rt.typeFor(dictionaryTypeDef));
    module->add(globalObject, "ZstdCompressor"_s, compressorType(globalObject));
    module->add(globalObject, "ZstdDecompressor"_s, decompressorType(globalObject));
    module->add(globalObject, "ZstdError"_s, errorType(globalObject));

    PyDict* compressorDict = compressorType(globalObject)->dict();
    compressorDict->set(vm, internString(vm, "CONTINUE"_s), jsNumber(ZSTD_e_continue));
    compressorDict->set(vm, internString(vm, "FLUSH_BLOCK"_s), jsNumber(ZSTD_e_flush));
    compressorDict->set(vm, internString(vm, "FLUSH_FRAME"_s), jsNumber(ZSTD_e_end));

    module->add(globalObject, "zstd_version"_s, makeStr(vm, String::fromUTF8(ZSTD_versionString())));
    module->add(globalObject, "zstd_version_number"_s, jsNumber(ZSTD_versionNumber()));
    module->add(globalObject, "ZSTD_CLEVEL_DEFAULT"_s, jsNumber(ZSTD_defaultCLevel()));
    module->add(globalObject, "ZSTD_DStreamOutSize"_s, jsNumber(ZSTD_DStreamOutSize()));

#define ADD_CONSTANT(name) module->add(globalObject, #name ""_s, jsNumber(name));
    ADD_CONSTANT(ZSTD_c_compressionLevel)
    ADD_CONSTANT(ZSTD_c_windowLog)
    ADD_CONSTANT(ZSTD_c_hashLog)
    ADD_CONSTANT(ZSTD_c_chainLog)
    ADD_CONSTANT(ZSTD_c_searchLog)
    ADD_CONSTANT(ZSTD_c_minMatch)
    ADD_CONSTANT(ZSTD_c_targetLength)
    ADD_CONSTANT(ZSTD_c_strategy)
    ADD_CONSTANT(ZSTD_c_enableLongDistanceMatching)
    ADD_CONSTANT(ZSTD_c_ldmHashLog)
    ADD_CONSTANT(ZSTD_c_ldmMinMatch)
    ADD_CONSTANT(ZSTD_c_ldmBucketSizeLog)
    ADD_CONSTANT(ZSTD_c_ldmHashRateLog)
    ADD_CONSTANT(ZSTD_c_contentSizeFlag)
    ADD_CONSTANT(ZSTD_c_checksumFlag)
    ADD_CONSTANT(ZSTD_c_dictIDFlag)
    ADD_CONSTANT(ZSTD_c_nbWorkers)
    ADD_CONSTANT(ZSTD_c_jobSize)
    ADD_CONSTANT(ZSTD_c_overlapLog)
    ADD_CONSTANT(ZSTD_d_windowLogMax)
    ADD_CONSTANT(ZSTD_fast)
    ADD_CONSTANT(ZSTD_dfast)
    ADD_CONSTANT(ZSTD_greedy)
    ADD_CONSTANT(ZSTD_lazy)
    ADD_CONSTANT(ZSTD_lazy2)
    ADD_CONSTANT(ZSTD_btlazy2)
    ADD_CONSTANT(ZSTD_btopt)
    ADD_CONSTANT(ZSTD_btultra)
    ADD_CONSTANT(ZSTD_btultra2)
#undef ADD_CONSTANT
}

} // namespace PythonModules
} // namespace Bun
