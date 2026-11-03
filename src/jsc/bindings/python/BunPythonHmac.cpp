#include "BunPythonHash.h"

// The module _hmac: HMAC with the hashes that are built in. (Modules/hmacmodule.c in CPython is the reference.)

namespace Bun {
namespace PythonModules {
namespace Hmac {

static constexpr TypeDef unknownHashErrorTypeDef { "_hmac.UnknownHashError"_s, { TypeFlag::Base }, {}, {}, {} };

static PyType* unknownHashError(JSGlobalObject* globalObject)
{
    Runtime& rt = runtime(globalObject);
    return rt.typeFor(unknownHashErrorTypeDef, rt.ValueError());
}

struct KnownHash {
    HashKind kind;
    ASCIILiteral ownName; // Besides the one hashlib has.
};

static constexpr KnownHash knownHashes[] = {
    { HashKind::MD5, "md5"_s },
    { HashKind::SHA1, "sha1"_s },
    { HashKind::SHA224, "sha2_224"_s },
    { HashKind::SHA256, "sha2_256"_s },
    { HashKind::SHA384, "sha2_384"_s },
    { HashKind::SHA512, "sha2_512"_s },
    { HashKind::SHA3_224, "sha3_224"_s },
    { HashKind::SHA3_256, "sha3_256"_s },
    { HashKind::SHA3_384, "sha3_384"_s },
    { HashKind::SHA3_512, "sha3_512"_s },
    { HashKind::Blake2s, "blake2s_32"_s },
    { HashKind::Blake2b, "blake2b_32"_s },
};

static std::optional<HashKind> kindFor(JSGlobalObject* globalObject, JSValue digestmod)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    String shown;
    if (isStr(digestmod)) {
        shown = strValue(digestmod)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        for (auto& known : knownHashes) {
            if (equalIgnoringASCIICase(shown, infoFor(known.kind).name) || equalIgnoringASCIICase(shown, known.ownName))
                return known.kind;
        }
    } else
        shown = reprForMessage(globalObject, digestmod);
    raise(globalObject, scope, unknownHashError(globalObject), makeString("unsupported hash algorithm "_s, shown));
    return std::nullopt;
}

static JSValue copy(JSGlobalObject* globalObject, JSValue self, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (failed(scope, takesNoArguments(globalObject, "copy"_s, args)))
        return {};
    RELEASE_AND_RETURN(scope, hmacCopy(globalObject, self));
}

static constexpr NativeDef methods[] = {
    PY_SLOT("__repr__", hmacRepr, "($self, /)"),
    PY_METHOD("copy", copy, "($self, *args, **kwargs)"),
    PY_METHOD("update", hmacUpdate, "($self, /, msg)"),
    PY_METHOD("digest", hmacDigest, "($self, /)"),
    PY_METHOD("hexdigest", hmacHexdigest, "($self, /)"),
};

static constexpr NativeGetSet getsets[] = {
    { "name"_s, hmacName },
    { "block_size"_s, hmacBlockSize },
    { "digest_size"_s, hmacDigestSize },
};

static constexpr TypeDef hmacTypeDef { "_hmac.HMAC"_s, { TypeFlag::Immutable, TypeFlag::DisallowInstantiation }, methods, getsets, {} };

static JSValue newHMAC(JSGlobalObject* globalObject, JSValue keyValue, JSValue message, JSValue digestmod)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!digestmod)
        return raiseTypeError(globalObject, scope, "new() missing 1 required argument 'digestmod'"_s);
    auto kind = kindFor(globalObject, digestmod);
    if (!kind)
        return {};
    BufferHolder key(globalObject);
    if (failed(scope, getDataToHash(globalObject, keyValue, key)))
        return {};
    auto state = makeUnique<HMACState>();
    state->initialize(*kind, key.buffer.span());
    if (message && !isNone(message)) {
        BufferHolder input(globalObject);
        if (failed(scope, getDataToHash(globalObject, message, input)))
            return {};
        state->update(input.buffer.span());
    }
    RELEASE_AND_RETURN(scope, createRecordWithState(globalObject, runtime(globalObject).typeFor(hmacTypeDef), 0, WTF::move(state)));
}

static JSValue compute(JSGlobalObject* globalObject, HashKind kind, JSValue keyValue, JSValue messageValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder key(globalObject);
    BufferHolder message(globalObject);
    if (failed(scope, getDataToHash(globalObject, keyValue, key)) || failed(scope, getDataToHash(globalObject, messageValue, message)))
        return {};
    RELEASE_AND_RETURN(scope, hmacOf(globalObject, kind, key, message));
}

static JSValue computeDigest(JSGlobalObject* globalObject, JSValue key, JSValue message, JSValue digestmod)
{
    auto kind = kindFor(globalObject, digestmod);
    if (!kind)
        return {};
    return compute(globalObject, *kind, key, message);
}

template<HashKind kind>
static JSValue computeWith(JSGlobalObject* globalObject, JSValue key, JSValue message) { return compute(globalObject, kind, key, message); }

static constexpr NativeDef functions[] = {
    PY_FUNCTION("new", newHMAC, "(key, msg=None, digestmod=None)"),
    PY_FUNCTION("compute_digest", computeDigest, "(key, msg, digest)"),
    PY_FUNCTION("compute_md5", computeWith<HashKind::MD5>, "(key, msg, /)"),
    PY_FUNCTION("compute_sha1", computeWith<HashKind::SHA1>, "(key, msg, /)"),
    PY_FUNCTION("compute_sha224", computeWith<HashKind::SHA224>, "(key, msg, /)"),
    PY_FUNCTION("compute_sha256", computeWith<HashKind::SHA256>, "(key, msg, /)"),
    PY_FUNCTION("compute_sha384", computeWith<HashKind::SHA384>, "(key, msg, /)"),
    PY_FUNCTION("compute_sha512", computeWith<HashKind::SHA512>, "(key, msg, /)"),
    PY_FUNCTION("compute_sha3_224", computeWith<HashKind::SHA3_224>, "(key, msg, /)"),
    PY_FUNCTION("compute_sha3_256", computeWith<HashKind::SHA3_256>, "(key, msg, /)"),
    PY_FUNCTION("compute_sha3_384", computeWith<HashKind::SHA3_384>, "(key, msg, /)"),
    PY_FUNCTION("compute_sha3_512", computeWith<HashKind::SHA3_512>, "(key, msg, /)"),
    PY_FUNCTION("compute_blake2s_32", computeWith<HashKind::Blake2s>, "(key, msg, /)"),
    PY_FUNCTION("compute_blake2b_32", computeWith<HashKind::Blake2b>, "(key, msg, /)"),
};

} // namespace Hmac

void initializeHmacModule(JSGlobalObject* globalObject, PyModule* module)
{
    using namespace Hmac;
    module->addFunctions(globalObject, functions);
    module->add(globalObject, "HMAC"_s, runtime(globalObject).typeFor(hmacTypeDef));
    module->add(globalObject, "UnknownHashError"_s, unknownHashError(globalObject));
    module->add(globalObject, "_GIL_MINSIZE"_s, jsNumber(2048));
}

} // namespace PythonModules
} // namespace Bun
