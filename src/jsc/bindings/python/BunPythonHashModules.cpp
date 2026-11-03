#include "BunPythonHash.h"

// The modules _md5, _sha1, _sha2, _sha3 and _blake2.

namespace Bun {
namespace PythonModules {
namespace Hashes {

static constexpr int minimumSizeToReleaseTheGIL = 2048;

static Hasher& hasherOf(JSValue self) { return *stateOf<Hasher>(self); }

static JSValue createHashObject(JSGlobalObject* globalObject, PyType* type, std::unique_ptr<Hasher>&& hasher, JSValue data)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (data) {
        BufferHolder input(globalObject);
        if (failed(scope, getDataToHash(globalObject, data, input)))
            return {};
        hasher->update(input.buffer.span());
    }
    RELEASE_AND_RETURN(scope, createRecordWithState(globalObject, type, 0, WTF::move(hasher)));
}

static JSValue update(JSGlobalObject* globalObject, JSValue self, JSValue data)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder input(globalObject);
    if (failed(scope, getDataToHash(globalObject, data, input)))
        return {};
    hasherOf(self).update(input.buffer.span());
    return jsUndefined();
}

static JSValue digest(JSGlobalObject* globalObject, JSValue self)
{
    uint8_t result[maxHashDigestSize];
    Hasher& hasher = hasherOf(self);
    hasher.digest(result);
    return bytesFrom(globalObject, { result, hasher.digestSize() });
}

static JSValue hexdigest(JSGlobalObject* globalObject, JSValue self)
{
    uint8_t result[maxHashDigestSize];
    Hasher& hasher = hasherOf(self);
    hasher.digest(result);
    return hexStringFrom(globalObject, { result, hasher.digestSize() });
}

static JSValue copy(JSGlobalObject* globalObject, JSValue self, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (failed(scope, takesNoArguments(globalObject, "copy"_s, args)))
        return {};
    RELEASE_AND_RETURN(scope, createRecordWithState(globalObject, typeOf(globalObject, self), 0, makeUnique<Hasher>(hasherOf(self))));
}

static JSValue name(JSGlobalObject* globalObject, JSValue self) { return makeStr(getVM(globalObject), String(infoFor(hasherOf(self).kind).name)); }
static JSValue blockSize(JSGlobalObject*, JSValue self) { return jsNumber(infoFor(hasherOf(self).kind).blockSize); }
static JSValue digestSize(JSGlobalObject*, JSValue self) { return jsNumber(hasherOf(self).digestSize()); }

static constexpr NativeDef methods[] = {
    PY_METHOD("copy", copy, "($self, *args, **kwargs)"),
    PY_METHOD("digest", digest, "($self, /)"),
    PY_METHOD("hexdigest", hexdigest, "($self, /)"),
    PY_METHOD("update", update, "($self, obj, /)"),
};

static constexpr NativeGetSet getsets[] = {
    { "block_size"_s, blockSize },
    { "name"_s, name },
    { "digest_size"_s, digestSize },
};

// ---- _md5, _sha1, _sha2: a function makes the objects ----

static constexpr OptionSet<TypeFlag> flagsWithoutNew { TypeFlag::DisallowInstantiation, TypeFlag::Immutable };

static constexpr TypeDef md5TypeDef { "_md5.md5"_s, flagsWithoutNew, methods, getsets, {} };
static constexpr TypeDef sha1TypeDef { "_sha1.sha1"_s, flagsWithoutNew, methods, getsets, {} };
static constexpr TypeDef sha224TypeDef { "_sha2.SHA224Type"_s, flagsWithoutNew, methods, getsets, {} };
static constexpr TypeDef sha256TypeDef { "_sha2.SHA256Type"_s, flagsWithoutNew, methods, getsets, {} };
static constexpr TypeDef sha384TypeDef { "_sha2.SHA384Type"_s, flagsWithoutNew, methods, getsets, {} };
static constexpr TypeDef sha512TypeDef { "_sha2.SHA512Type"_s, flagsWithoutNew, methods, getsets, {} };

template<HashKind kind, const TypeDef& typeDef>
static JSValue construct(JSGlobalObject* globalObject, JSValue data, JSValue usedForSecurity, JSValue string)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (usedForSecurity) {
        isTrue(globalObject, usedForSecurity);
        RETURN_IF_EXCEPTION(scope, {});
    }
    JSValue toHash;
    if (!dataArgument(globalObject, data, string, toHash))
        return {};
    RELEASE_AND_RETURN(scope, createHashObject(globalObject, runtime(globalObject).typeFor(typeDef), makeUnique<Hasher>(kind), toHash));
}

#define CONSTRUCTOR_SIGNATURE "(data=b'', *, usedforsecurity=True, string=None)"

static constexpr NativeDef md5Functions[] = {
    PY_FUNCTION("md5", (construct<HashKind::MD5, md5TypeDef>), CONSTRUCTOR_SIGNATURE),
};

static constexpr NativeDef sha1Functions[] = {
    PY_FUNCTION("sha1", (construct<HashKind::SHA1, sha1TypeDef>), CONSTRUCTOR_SIGNATURE),
};

static constexpr NativeDef sha2Functions[] = {
    PY_FUNCTION("sha224", (construct<HashKind::SHA224, sha224TypeDef>), CONSTRUCTOR_SIGNATURE),
    PY_FUNCTION("sha256", (construct<HashKind::SHA256, sha256TypeDef>), CONSTRUCTOR_SIGNATURE),
    PY_FUNCTION("sha384", (construct<HashKind::SHA384, sha384TypeDef>), CONSTRUCTOR_SIGNATURE),
    PY_FUNCTION("sha512", (construct<HashKind::SHA512, sha512TypeDef>), CONSTRUCTOR_SIGNATURE),
};

// ---- _sha3: the types are called ----

template<HashKind kind>
static JSValue sha3New(JSGlobalObject* globalObject, JSValue cls, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // In CPython one function serves all six, which is why it gives this name whichever it is.
    static constexpr ASCIILiteral names[] = { "data"_s, "usedforsecurity"_s, "string"_s };
    JSValue values[3];
    if (failed(scope, unpackArguments(globalObject, { "sha3_224"_s, 0, 0, 1, names }, args, values)))
        return {};
    if (values[1]) {
        isTrue(globalObject, values[1]);
        RETURN_IF_EXCEPTION(scope, {});
    }
    JSValue toHash;
    if (!dataArgument(globalObject, values[0], values[2], toHash))
        return {};
    RELEASE_AND_RETURN(scope, createHashObject(globalObject, PyType::from(cls), makeUnique<Hasher>(kind), toHash));
}

static JSValue capacityBits(JSGlobalObject*, JSValue self) { return jsNumber(1600 - 8 * infoFor(hasherOf(self).kind).blockSize); }
static JSValue rateBits(JSGlobalObject*, JSValue self) { return jsNumber(8 * infoFor(hasherOf(self).kind).blockSize); }
static JSValue suffix(JSGlobalObject* globalObject, JSValue self) { return bytesFrom(globalObject, { &hasherOf(self).keccak.suffix, 1 }); }

static bool shakeLength(JSGlobalObject* globalObject, ASCIILiteral function, const CallArgs& args, int64_t& length)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    static constexpr ASCIILiteral names[] = { "length"_s };
    JSValue value;
    if (failed(scope, unpackArguments(globalObject, { function, 0, 1, 1, names }, args, &value)))
        return false;
    if (failed(scope, nonNegativeSsizeArgument(globalObject, value, "length"_s, 0, length)))
        return false;
    if (length >= (1 << 29)) {
        raiseOverflowError(globalObject, scope, "digest length is too large"_s);
        return false;
    }
    return true;
}

static JSValue shakeDigest(JSGlobalObject* globalObject, JSValue self, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int64_t length;
    if (failed(scope, shakeLength(globalObject, "digest"_s, args, length)))
        return {};
    PyBytes* result = newBytes(globalObject, length);
    if (!result)
        return {};
    if (length)
        hasherOf(self).digest(std::span { result->mutableData(), static_cast<size_t>(length) });
    return result;
}

static JSValue shakeHexdigest(JSGlobalObject* globalObject, JSValue self, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int64_t length;
    if (failed(scope, shakeLength(globalObject, "hexdigest"_s, args, length)))
        return {};
    Vector<uint8_t> result;
    if (!result.tryGrow(length))
        return raiseMemoryError(globalObject, scope, String());
    hasherOf(self).digest(result.mutableSpan());
    RELEASE_AND_RETURN(scope, hexStringFrom(globalObject, result.span()));
}

static constexpr NativeGetSet sha3GetSets[] = {
    { "block_size"_s, blockSize },
    { "name"_s, name },
    { "digest_size"_s, digestSize },
    { "_capacity_bits"_s, capacityBits },
    { "_rate_bits"_s, rateBits },
    { "_suffix"_s, suffix },
};

template<HashKind kind>
static constexpr NativeDef sha3Methods[] = {
    PY_NEW(sha3New<kind>, "($type, *args, **kwargs)"),
    PY_METHOD("copy", copy, "($self, *args, **kwargs)"),
    PY_METHOD("digest", digest, "($self, /)"),
    PY_METHOD("hexdigest", hexdigest, "($self, /)"),
    PY_METHOD("update", update, "($self, data, /)"),
};

template<HashKind kind>
static constexpr NativeDef shakeMethods[] = {
    PY_NEW(sha3New<kind>, "($type, *args, **kwargs)"),
    PY_METHOD("copy", copy, "($self, *args, **kwargs)"),
    PY_METHOD("digest", shakeDigest, "($self, *args, **kwargs)"),
    PY_METHOD("hexdigest", shakeHexdigest, "($self, *args, **kwargs)"),
    PY_METHOD("update", update, "($self, data, /)"),
};

static constexpr TypeDef sha3_224TypeDef { "_sha3.sha3_224"_s, { TypeFlag::Immutable }, sha3Methods<HashKind::SHA3_224>, sha3GetSets, "sha3_224([data], *, usedforsecurity=True) -> SHA3 object\n\nReturn a new SHA3 hash object with a hashbit length of 28 bytes."_s };
static constexpr TypeDef sha3_256TypeDef { "_sha3.sha3_256"_s, { TypeFlag::Immutable }, sha3Methods<HashKind::SHA3_256>, sha3GetSets, "sha3_256([data], *, usedforsecurity=True) -> SHA3 object\n\nReturn a new SHA3 hash object with a hashbit length of 32 bytes."_s };
static constexpr TypeDef sha3_384TypeDef { "_sha3.sha3_384"_s, { TypeFlag::Immutable }, sha3Methods<HashKind::SHA3_384>, sha3GetSets, "sha3_384([data], *, usedforsecurity=True) -> SHA3 object\n\nReturn a new SHA3 hash object with a hashbit length of 48 bytes."_s };
static constexpr TypeDef sha3_512TypeDef { "_sha3.sha3_512"_s, { TypeFlag::Immutable }, sha3Methods<HashKind::SHA3_512>, sha3GetSets, "sha3_512([data], *, usedforsecurity=True) -> SHA3 object\n\nReturn a new SHA3 hash object with a hashbit length of 64 bytes."_s };
static constexpr TypeDef shake128TypeDef { "_sha3.shake_128"_s, { TypeFlag::Immutable }, shakeMethods<HashKind::SHAKE128>, sha3GetSets, "shake_128([data], *, usedforsecurity=True) -> SHAKE object\n\nReturn a new SHAKE hash object."_s };
static constexpr TypeDef shake256TypeDef { "_sha3.shake_256"_s, { TypeFlag::Immutable }, shakeMethods<HashKind::SHAKE256>, sha3GetSets, "shake_256([data], *, usedforsecurity=True) -> SHAKE object\n\nReturn a new SHAKE hash object."_s };

// ---- _blake2 ----

template<typename State>
static JSValue blake2New(JSGlobalObject* globalObject, JSValue cls, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    constexpr bool isBlake2b = std::is_same_v<State, Blake2bState>;
    constexpr ASCIILiteral function = isBlake2b ? "blake2b"_s : "blake2s"_s;
    enum { Data, DigestSize, Key, Salt, Person, Fanout, Depth, LeafSize, NodeOffset, NodeDepth, InnerSize, LastNode, UsedForSecurity, StringData, Count };
    static constexpr ASCIILiteral names[] = { "data"_s, "digest_size"_s, "key"_s, "salt"_s, "person"_s, "fanout"_s, "depth"_s, "leaf_size"_s, "node_offset"_s, "node_depth"_s, "inner_size"_s, "last_node"_s, "usedforsecurity"_s, "string"_s };
    JSValue values[Count];
    if (failed(scope, unpackArguments(globalObject, { function, 0, 0, 1, names }, args, values)))
        return {};

    int digestSize, fanout, depth, nodeDepth, innerSize;
    uint64_t leafSize, nodeOffset;
    BufferHolder key(globalObject);
    BufferHolder salt(globalObject);
    BufferHolder person(globalObject);
    if (failed(scope, intArgument(globalObject, values[DigestSize], State::maxDigestSize, digestSize))
        || (values[Key] && !key.get(values[Key]))
        || (values[Salt] && !salt.get(values[Salt]))
        || (values[Person] && !person.get(values[Person]))
        || failed(scope, intArgument(globalObject, values[Fanout], 1, fanout))
        || failed(scope, intArgument(globalObject, values[Depth], 1, depth))
        || failed(scope, unsignedArgument(globalObject, values[LeafSize], "unsigned long"_s, 0, leafSize))
        || failed(scope, unsignedArgument(globalObject, values[NodeOffset], "unsigned long long"_s, 0, nodeOffset))
        || failed(scope, intArgument(globalObject, values[NodeDepth], 0, nodeDepth))
        || failed(scope, intArgument(globalObject, values[InnerSize], 0, innerSize)))
        return {};
    bool isLastNode = false;
    if (values[LastNode]) {
        isLastNode = isTrue(globalObject, values[LastNode]);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (values[UsedForSecurity]) {
        isTrue(globalObject, values[UsedForSecurity]);
        RETURN_IF_EXCEPTION(scope, {});
    }
    JSValue toHash;
    if (!dataArgument(globalObject, values[Data], values[StringData], toHash) || !refreshBuffers(globalObject, key, salt, person))
        return {};

    if (digestSize <= 0 || static_cast<unsigned>(digestSize) > State::maxDigestSize)
        return raiseValueError(globalObject, scope, "digest_size for "_s, function, " must be between 1 and "_s, State::maxDigestSize, " bytes, got "_s, digestSize);
    auto spanOf = [](BufferHolder& holder, JSValue value) { return value ? holder.buffer.span() : std::span<const uint8_t>(); };
    std::span<const uint8_t> keySpan = spanOf(key, values[Key]);
    std::span<const uint8_t> saltSpan = spanOf(salt, values[Salt]);
    std::span<const uint8_t> personSpan = spanOf(person, values[Person]);
    if (keySpan.size() > State::maxKeySize)
        return raiseValueError(globalObject, scope, "maximum key length is "_s, State::maxKeySize, " bytes, got "_s, keySpan.size());
    if (saltSpan.size() > State::saltSize)
        return raiseValueError(globalObject, scope, "maximum salt length is "_s, State::saltSize, " bytes, got "_s, saltSpan.size());
    if (personSpan.size() > State::personSize)
        return raiseValueError(globalObject, scope, "maximum person length is "_s, State::personSize, " bytes, got "_s, personSpan.size());
    if (fanout < 0 || fanout > 255)
        return raiseValueError(globalObject, scope, "'fanout' must be between 0 and 255"_s);
    if (depth < 1 || depth > 255)
        return raiseValueError(globalObject, scope, "'depth' must be between 1 and 255"_s);
    if (nodeDepth < 0 || nodeDepth > 255)
        return raiseValueError(globalObject, scope, "'node_depth' must be between 0 and 255"_s);
    if (innerSize < 0 || static_cast<unsigned>(innerSize) > State::maxDigestSize)
        return raiseValueError(globalObject, scope, "'inner_size' must be between 0 and "_s, State::maxDigestSize);
    if (leafSize > 0xffffffffu)
        return raiseOverflowError(globalObject, scope, "'leaf_size' is too large"_s);
    if (!isBlake2b && nodeOffset > 0xffffffffffffULL)
        return raiseOverflowError(globalObject, scope, "'node_offset' is too large"_s);

    auto hasher = makeUnique<Hasher>();
    hasher->initializeBlake2(isBlake2b ? HashKind::Blake2b : HashKind::Blake2s, {
        .digestSize = static_cast<unsigned>(digestSize),
        .key = keySpan,
        .salt = saltSpan,
        .person = personSpan,
        .fanout = static_cast<unsigned>(fanout),
        .depth = static_cast<unsigned>(depth),
        .leafSize = static_cast<uint32_t>(leafSize),
        .nodeOffset = nodeOffset,
        .nodeDepth = static_cast<unsigned>(nodeDepth),
        .innerSize = static_cast<unsigned>(innerSize),
        .isLastNode = isLastNode,
    });
    RELEASE_AND_RETURN(scope, createHashObject(globalObject, PyType::from(cls), WTF::move(hasher), toHash));
}

static constexpr NativeGetSet blake2GetSets[] = {
    { "name"_s, name },
    { "block_size"_s, blockSize },
    { "digest_size"_s, digestSize },
};

template<typename State>
static constexpr NativeDef blake2Methods[] = {
    PY_NEW(blake2New<State>, "($type, *args, **kwargs)"),
    PY_METHOD("copy", copy, "($self, *args, **kwargs)"),
    PY_METHOD("digest", digest, "($self, /)"),
    PY_METHOD("hexdigest", hexdigest, "($self, /)"),
    PY_METHOD("update", update, "($self, data, /)"),
};

static constexpr TypeDef blake2bTypeDef { "_blake2.blake2b"_s, { TypeFlag::Immutable }, blake2Methods<Blake2bState>, blake2GetSets, "Return a new BLAKE2b hash object."_s };
static constexpr TypeDef blake2sTypeDef { "_blake2.blake2s"_s, { TypeFlag::Immutable }, blake2Methods<Blake2sState>, blake2GetSets, "Return a new BLAKE2s hash object."_s };

template<typename State>
static void addBlake2(JSGlobalObject* globalObject, PyModule* module, const TypeDef& typeDef, ASCIILiteral name, std::array<ASCIILiteral, 4> moduleConstants)
{
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    PyType* type = rt.typeFor(typeDef);
    static constexpr ASCIILiteral names[] = { "SALT_SIZE"_s, "PERSON_SIZE"_s, "MAX_KEY_SIZE"_s, "MAX_DIGEST_SIZE"_s };
    static constexpr unsigned values[] = { State::saltSize, State::personSize, State::maxKeySize, State::maxDigestSize };
    for (unsigned i = 0; i < 4; ++i) {
        type->dict()->set(vm, internString(vm, names[i]), jsNumber(values[i]));
        module->add(globalObject, moduleConstants[i], jsNumber(values[i]));
    }
    module->add(globalObject, name, type);
}

} // namespace Hashes

void initializeMD5Module(JSGlobalObject* globalObject, PyModule* module)
{
    using namespace Hashes;
    module->addFunctions(globalObject, md5Functions);
    module->add(globalObject, "MD5Type"_s, runtime(globalObject).typeFor(md5TypeDef));
    module->add(globalObject, "_GIL_MINSIZE"_s, jsNumber(minimumSizeToReleaseTheGIL));
}

void initializeSHA1Module(JSGlobalObject* globalObject, PyModule* module)
{
    using namespace Hashes;
    module->addFunctions(globalObject, sha1Functions);
    module->add(globalObject, "SHA1Type"_s, runtime(globalObject).typeFor(sha1TypeDef));
    module->add(globalObject, "_GIL_MINSIZE"_s, jsNumber(minimumSizeToReleaseTheGIL));
}

void initializeSHA2Module(JSGlobalObject* globalObject, PyModule* module)
{
    using namespace Hashes;
    Runtime& rt = runtime(globalObject);
    module->addFunctions(globalObject, sha2Functions);
    module->add(globalObject, "SHA224Type"_s, rt.typeFor(sha224TypeDef));
    module->add(globalObject, "SHA256Type"_s, rt.typeFor(sha256TypeDef));
    module->add(globalObject, "SHA384Type"_s, rt.typeFor(sha384TypeDef));
    module->add(globalObject, "SHA512Type"_s, rt.typeFor(sha512TypeDef));
    module->add(globalObject, "_GIL_MINSIZE"_s, jsNumber(minimumSizeToReleaseTheGIL));
}

void initializeSHA3Module(JSGlobalObject* globalObject, PyModule* module)
{
    using namespace Hashes;
    Runtime& rt = runtime(globalObject);
    module->add(globalObject, "sha3_224"_s, rt.typeFor(sha3_224TypeDef));
    module->add(globalObject, "sha3_256"_s, rt.typeFor(sha3_256TypeDef));
    module->add(globalObject, "sha3_384"_s, rt.typeFor(sha3_384TypeDef));
    module->add(globalObject, "sha3_512"_s, rt.typeFor(sha3_512TypeDef));
    module->add(globalObject, "shake_128"_s, rt.typeFor(shake128TypeDef));
    module->add(globalObject, "shake_256"_s, rt.typeFor(shake256TypeDef));
    module->add(globalObject, "implementation"_s, makeStr(rt.vm(), "Bun"_s));
    module->add(globalObject, "_GIL_MINSIZE"_s, jsNumber(minimumSizeToReleaseTheGIL));
}

void initializeBlake2Module(JSGlobalObject* globalObject, PyModule* module)
{
    using namespace Hashes;
    addBlake2<Blake2bState>(globalObject, module, blake2bTypeDef, "blake2b"_s, { "BLAKE2B_SALT_SIZE"_s, "BLAKE2B_PERSON_SIZE"_s, "BLAKE2B_MAX_KEY_SIZE"_s, "BLAKE2B_MAX_DIGEST_SIZE"_s });
    addBlake2<Blake2sState>(globalObject, module, blake2sTypeDef, "blake2s"_s, { "BLAKE2S_SALT_SIZE"_s, "BLAKE2S_PERSON_SIZE"_s, "BLAKE2S_MAX_KEY_SIZE"_s, "BLAKE2S_MAX_DIGEST_SIZE"_s });
    module->add(globalObject, "_GIL_MINSIZE"_s, jsNumber(minimumSizeToReleaseTheGIL));
}

} // namespace PythonModules
} // namespace Bun
