#include "BunPythonHash.h"

#include <JavaScriptCore/PySet.h>
#include <openssl/err.h>
#include <openssl/evp.h>

// The module _hashlib, which in CPython is hashlib's way to OpenSSL. (Modules/_hashopenssl.c is the reference.) hashlib works
// without it, but has pbkdf2_hmac(), scrypt() and the hashes that are only reached through new() from nowhere else.

namespace Bun {
namespace PythonModules {
namespace Hashlib {

static constexpr TypeDef unsupportedDigestmodErrorTypeDef { "_hashlib.UnsupportedDigestmodError"_s, { TypeFlag::Base, TypeFlag::Mutable, TypeFlag::HasWeakref }, {}, {}, {} };

static PyType* unsupportedDigestmodError(JSGlobalObject* globalObject)
{
    Runtime& rt = runtime(globalObject);
    return rt.typeFor(unsupportedDigestmodErrorTypeDef, rt.ValueError());
}

static void raiseUnsupported(JSGlobalObject* globalObject, const String& name)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // What OpenSSL 3 makes CPython say.
    raise(globalObject, scope, unsupportedDigestmodError(globalObject), makeString("[digital envelope routines] unsupported hash algorithm "_s, name));
}

static std::optional<HashKind> kindNamed(JSGlobalObject* globalObject, const String& name)
{
    auto kind = hashKindNamed(name);
    if (!kind)
        raiseUnsupported(globalObject, name);
    return kind;
}

// A parameter declared `str` to Argument Clinic.
static bool stringArgument(JSGlobalObject* globalObject, ASCIILiteral function, ASCIILiteral parameter, JSValue value, String& result)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!isStr(value)) {
        raiseTypeError(globalObject, scope, function, "() argument '"_s, parameter, "' must be str, not "_s, typeNameOfArgument(globalObject, value));
        return false;
    }
    result = strValue(value)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    if (result.contains(static_cast<char16_t>(0))) {
        raiseValueError(globalObject, scope, "embedded null character"_s);
        return false;
    }
    return true;
}

// ---- HASH, HASHXOF ----

static Hasher& hasherOf(JSValue self) { return *stateOf<Hasher>(self); }

static PyType* hashType(JSGlobalObject*);
static PyType* extendableHashType(JSGlobalObject*);

static JSValue createHash(JSGlobalObject* globalObject, HashKind kind, JSValue data, JSValue usedForSecurity, JSValue string)
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
    auto hasher = makeUnique<Hasher>(kind);
    if (toHash) {
        BufferHolder input(globalObject);
        if (failed(scope, getDataToHash(globalObject, toHash, input)))
            return {};
        hasher->update(input.buffer.span());
    }
    RELEASE_AND_RETURN(scope, createRecordWithState(globalObject, isExtendable(kind) ? extendableHashType(globalObject) : hashType(globalObject), 0, WTF::move(hasher)));
}

static JSValue hashUpdate(JSGlobalObject* globalObject, JSValue self, JSValue data)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder input(globalObject);
    if (failed(scope, getDataToHash(globalObject, data, input)))
        return {};
    hasherOf(self).update(input.buffer.span());
    return jsUndefined();
}

// A HASHXOF is a HASH, so what HASH defines can be asked of it: _hashlib.HASH.digest(shake). Then the length is the one OpenSSL
// has for SHAKE where none is given.
static unsigned digestSizeAsHash(const Hasher& hasher)
{
    if (isExtendable(hasher.kind))
        return hasher.kind == HashKind::SHAKE128 ? 16 : 32;
    return hasher.digestSize();
}

static std::span<const uint8_t> digestAsHash(const Hasher& hasher, std::span<uint8_t, maxHashDigestSize> buffer)
{
    auto result = buffer.first(digestSizeAsHash(hasher));
    if (isExtendable(hasher.kind))
        hasher.digest(result);
    else
        hasher.digest(result.data());
    return result;
}

static JSValue hashDigest(JSGlobalObject* globalObject, JSValue self)
{
    uint8_t buffer[maxHashDigestSize];
    return bytesFrom(globalObject, digestAsHash(hasherOf(self), buffer));
}

static JSValue hashHexdigest(JSGlobalObject* globalObject, JSValue self)
{
    uint8_t buffer[maxHashDigestSize];
    return hexStringFrom(globalObject, digestAsHash(hasherOf(self), buffer));
}

static JSValue hashCopy(JSGlobalObject* globalObject, JSValue self)
{
    return createRecordWithState(globalObject, typeOf(globalObject, self), 0, makeUnique<Hasher>(hasherOf(self)));
}

static JSValue hashRepr(JSGlobalObject* globalObject, JSValue self)
{
    return makeStr(getVM(globalObject), makeString('<', infoFor(hasherOf(self).kind).name, ' ', qualifiedTypeName(globalObject, typeOf(globalObject, self)), " object @ "_s, addressForRepr(globalObject, self), '>'));
}

static JSValue hashName(JSGlobalObject* globalObject, JSValue self) { return makeStr(getVM(globalObject), String(infoFor(hasherOf(self).kind).name)); }
static JSValue hashBlockSize(JSGlobalObject*, JSValue self) { return jsNumber(infoFor(hasherOf(self).kind).blockSize); }
static JSValue hashDigestSize(JSGlobalObject*, JSValue self) { return jsNumber(digestSizeAsHash(hasherOf(self))); }

static constexpr NativeDef hashMethods[] = {
    PY_SLOT("__repr__", hashRepr, "($self, /)"),
    PY_METHOD("copy", hashCopy, "($self, /)"),
    PY_METHOD("digest", hashDigest, "($self, /)"),
    PY_METHOD("hexdigest", hashHexdigest, "($self, /)"),
    PY_METHOD("update", hashUpdate, "($self, obj, /)"),
};

static constexpr NativeGetSet hashGetSets[] = {
    { "digest_size"_s, hashDigestSize },
    { "block_size"_s, hashBlockSize },
    { "name"_s, hashName },
};

static constexpr TypeDef hashTypeDef { "_hashlib.HASH"_s, { TypeFlag::Base, TypeFlag::OwnLayout, TypeFlag::Immutable, TypeFlag::DisallowInstantiation }, hashMethods, hashGetSets, {} };

static PyType* hashType(JSGlobalObject* globalObject) { return runtime(globalObject).typeFor(hashTypeDef); }

static JSValue extendableDigest(JSGlobalObject* globalObject, JSValue self, JSValue lengthValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int64_t length;
    if (failed(scope, nonNegativeSsizeArgument(globalObject, lengthValue, "length"_s, 0, length)))
        return {};
    PyBytes* result = newBytes(globalObject, length);
    if (!result)
        return {};
    if (length)
        hasherOf(self).digest(std::span { result->mutableData(), static_cast<size_t>(length) });
    return result;
}

static JSValue extendableHexdigest(JSGlobalObject* globalObject, JSValue self, JSValue lengthValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int64_t length;
    if (failed(scope, nonNegativeSsizeArgument(globalObject, lengthValue, "length"_s, 0, length)))
        return {};
    Vector<uint8_t> result;
    if (!result.tryGrow(length))
        return raiseMemoryError(globalObject, scope, String());
    hasherOf(self).digest(result.mutableSpan());
    RELEASE_AND_RETURN(scope, hexStringFrom(globalObject, result.span()));
}

static constexpr NativeDef extendableHashMethods[] = {
    PY_METHOD("digest", extendableDigest, "($self, /, length)"),
    PY_METHOD("hexdigest", extendableHexdigest, "($self, /, length)"),
};

static JSValue extendableDigestSize(JSGlobalObject*, JSValue) { return jsNumber(0); }

static constexpr NativeGetSet extendableHashGetSets[] = {
    { "digest_size"_s, extendableDigestSize },
};

static constexpr TypeDef extendableHashTypeDef { "_hashlib.HASHXOF"_s, { TypeFlag::Base, TypeFlag::Immutable, TypeFlag::DisallowInstantiation }, extendableHashMethods, extendableHashGetSets, {} };

static PyType* extendableHashType(JSGlobalObject* globalObject) { return runtime(globalObject).typeFor(extendableHashTypeDef, hashType(globalObject)); }

static JSValue newHash(JSGlobalObject* globalObject, JSValue nameValue, JSValue data, JSValue usedForSecurity, JSValue string)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    String name;
    if (failed(scope, stringArgument(globalObject, "new"_s, "name"_s, nameValue, name)))
        return {};
    // CPython looks at the data first.
    JSValue toHash;
    if (data && string)
        RELEASE_AND_RETURN(scope, (dataArgument(globalObject, data, string, toHash), JSValue()));
    auto kind = kindNamed(globalObject, name);
    if (!kind)
        return {};
    RELEASE_AND_RETURN(scope, createHash(globalObject, *kind, data, usedForSecurity, string));
}

template<HashKind kind>
static JSValue construct(JSGlobalObject* globalObject, JSValue data, JSValue usedForSecurity, JSValue string)
{
    return createHash(globalObject, kind, data, usedForSecurity, string);
}

#define CONSTRUCTOR_SIGNATURE "(data=b'', *, usedforsecurity=True, string=None)"

static constexpr unsigned lengthOfConstructorPrefix = 8;
static constexpr NativeDef constructors[] = {
    PY_FUNCTION("openssl_md5", construct<HashKind::MD5>, CONSTRUCTOR_SIGNATURE),
    PY_FUNCTION("openssl_sha1", construct<HashKind::SHA1>, CONSTRUCTOR_SIGNATURE),
    PY_FUNCTION("openssl_sha224", construct<HashKind::SHA224>, CONSTRUCTOR_SIGNATURE),
    PY_FUNCTION("openssl_sha256", construct<HashKind::SHA256>, CONSTRUCTOR_SIGNATURE),
    PY_FUNCTION("openssl_sha384", construct<HashKind::SHA384>, CONSTRUCTOR_SIGNATURE),
    PY_FUNCTION("openssl_sha512", construct<HashKind::SHA512>, CONSTRUCTOR_SIGNATURE),
    PY_FUNCTION("openssl_sha3_224", construct<HashKind::SHA3_224>, CONSTRUCTOR_SIGNATURE),
    PY_FUNCTION("openssl_sha3_256", construct<HashKind::SHA3_256>, CONSTRUCTOR_SIGNATURE),
    PY_FUNCTION("openssl_sha3_384", construct<HashKind::SHA3_384>, CONSTRUCTOR_SIGNATURE),
    PY_FUNCTION("openssl_sha3_512", construct<HashKind::SHA3_512>, CONSTRUCTOR_SIGNATURE),
    PY_FUNCTION("openssl_shake_128", construct<HashKind::SHAKE128>, CONSTRUCTOR_SIGNATURE),
    PY_FUNCTION("openssl_shake_256", construct<HashKind::SHAKE256>, CONSTRUCTOR_SIGNATURE),
};

// ---- HMAC ----

// `digestmod` is a name, or one of the functions of this module.
static std::optional<HashKind> kindForHMAC(JSGlobalObject* globalObject, JSValue digestmod)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    String name;
    if (isStr(digestmod)) {
        name = strValue(digestmod)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
    } else {
        auto* function = PyNativeFunction::tryFrom(digestmod);
        if (!function || &function->def() < std::begin(constructors) || &function->def() >= std::end(constructors)) {
            String text = reprForMessage(globalObject, digestmod);
            RETURN_IF_EXCEPTION(scope, std::nullopt);
            scope.release();
            raiseUnsupported(globalObject, text);
            return std::nullopt;
        }
        name = String(function->def().name).substring(lengthOfConstructorPrefix);
    }
    auto kind = hashKindNamed(name);
    if (!kind || isExtendable(*kind)) {
        if (!isStr(digestmod))
            name = reprForMessage(globalObject, digestmod);
        scope.release();
        raiseUnsupported(globalObject, name);
        return std::nullopt;
    }
    return kind;
}

static constexpr NativeDef hmacMethods[] = {
    PY_SLOT("__repr__", hmacRepr, "($self, /)"),
    PY_METHOD("update", hmacUpdate, "($self, /, msg)"),
    PY_METHOD("digest", hmacDigest, "($self, /)"),
    PY_METHOD("hexdigest", hmacHexdigest, "($self, /)"),
    PY_METHOD("copy", hmacCopy, "($self, /)"),
};

static constexpr NativeGetSet hmacGetSets[] = {
    { "digest_size"_s, hmacDigestSize },
    { "block_size"_s, hmacBlockSize },
    { "name"_s, hmacName },
};

static constexpr TypeDef hmacTypeDef { "_hashlib.HMAC"_s, { TypeFlag::Immutable, TypeFlag::DisallowInstantiation }, hmacMethods, hmacGetSets, {} };

static JSValue hmacNew(JSGlobalObject* globalObject, JSValue keyValue, JSValue message, JSValue digestmod)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder key(globalObject);
    if (!key.get(keyValue))
        return {};
    if (!digestmod)
        return raiseTypeError(globalObject, scope, "Missing required parameter 'digestmod'."_s);
    auto kind = kindForHMAC(globalObject, digestmod);
    if (!kind)
        return {};
    auto state = makeUnique<HMACState>();
    state->initialize(*kind, key.buffer.span());
    if (message && !message.isUndefined()) {
        BufferHolder input(globalObject);
        if (failed(scope, getDataToHash(globalObject, message, input)))
            return {};
        state->update(input.buffer.span());
    }
    RELEASE_AND_RETURN(scope, createRecordWithState(globalObject, runtime(globalObject).typeFor(hmacTypeDef), 0, WTF::move(state)));
}

static JSValue hmacDigestFunction(JSGlobalObject* globalObject, JSValue keyValue, JSValue messageValue, JSValue digest)
{
    BufferHolder key(globalObject);
    BufferHolder message(globalObject);
    if (!key.get(keyValue) || !message.get(messageValue))
        return {};
    auto kind = kindForHMAC(globalObject, digest);
    if (!kind)
        return {};
    return hmacOf(globalObject, *kind, key, message);
}

// ---- Keys from passwords ----

static const EVP_MD* boringSSLDigestFor(HashKind kind)
{
    switch (kind) {
    case HashKind::MD5:
        return EVP_md5();
    case HashKind::SHA1:
        return EVP_sha1();
    case HashKind::SHA224:
        return EVP_sha224();
    case HashKind::SHA256:
        return EVP_sha256();
    case HashKind::SHA384:
        return EVP_sha384();
    case HashKind::SHA512:
        return EVP_sha512();
    case HashKind::SHA512_224:
        return EVP_sha512_224();
    case HashKind::SHA512_256:
        return EVP_sha512_256();
    case HashKind::SHA3_224:
        return EVP_sha3_224();
    case HashKind::SHA3_256:
        return EVP_sha3_256();
    case HashKind::SHA3_384:
        return EVP_sha3_384();
    case HashKind::SHA3_512:
        return EVP_sha3_512();
    case HashKind::Blake2b:
        return EVP_blake2b512();
    case HashKind::RIPEMD160:
        return EVP_ripemd160();
    case HashKind::MD5SHA1:
        return EVP_md5_sha1();
    default:
        return nullptr;
    }
}

// RFC 8018, section 5.2. For what BoringSSL has no EVP_MD of: BLAKE2s.
static void pbkdf2(HashKind kind, std::span<const uint8_t> password, std::span<const uint8_t> salt, uint32_t iterations, std::span<uint8_t> key)
{
    HMACState keyed;
    keyed.initialize(kind, password);
    unsigned digestSize = keyed.digestSize();
    for (uint32_t block = 1; !key.empty(); ++block) {
        uint8_t u[maxHashDigestSize];
        uint8_t t[maxHashDigestSize];
        uint8_t index[4] = { static_cast<uint8_t>(block >> 24), static_cast<uint8_t>(block >> 16), static_cast<uint8_t>(block >> 8), static_cast<uint8_t>(block) };
        HMACState hmac = keyed;
        hmac.update(salt);
        hmac.update(index);
        hmac.digest(u);
        memcpy(t, u, digestSize);
        for (uint32_t i = 1; i < iterations; ++i) {
            hmac = keyed;
            hmac.update({ u, digestSize });
            hmac.digest(u);
            for (unsigned k = 0; k < digestSize; ++k)
                t[k] ^= u[k];
        }
        size_t taken = std::min<size_t>(digestSize, key.size());
        memcpy(key.data(), t, taken);
        key = key.subspan(taken);
    }
}

static JSValue pbkdf2HMAC(JSGlobalObject* globalObject, JSValue hashName, JSValue passwordValue, JSValue saltValue, JSValue iterationsValue, JSValue keyLengthValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    String name;
    if (failed(scope, stringArgument(globalObject, "pbkdf2_hmac"_s, "hash_name"_s, hashName, name)))
        return {};
    BufferHolder password(globalObject);
    BufferHolder salt(globalObject);
    if (!password.get(passwordValue) || !salt.get(saltValue))
        return {};
    int64_t iterations = toInt64(globalObject, iterationsValue);
    RETURN_IF_EXCEPTION(scope, {});

    auto kind = kindNamed(globalObject, name);
    if (!kind)
        return {};
    if (isExtendable(*kind))
        return raiseValueError(globalObject, scope, "[digital envelope routines] unsupported"_s);
    if (password.buffer.length > std::numeric_limits<int>::max())
        return raiseOverflowError(globalObject, scope, "password is too long."_s);
    if (salt.buffer.length > std::numeric_limits<int>::max())
        return raiseOverflowError(globalObject, scope, "salt is too long."_s);
    if (iterations < 1)
        return raiseValueError(globalObject, scope, "iteration value must be greater than 0."_s);
    if (iterations > std::numeric_limits<int>::max())
        return raiseOverflowError(globalObject, scope, "iteration value is too great."_s);
    int64_t keyLength = infoFor(*kind).digestSize;
    if (keyLengthValue && !keyLengthValue.isUndefined()) {
        keyLength = toInt64(globalObject, keyLengthValue);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (keyLength < 1)
        return raiseValueError(globalObject, scope, "key length must be greater than 0."_s);
    if (keyLength > std::numeric_limits<int>::max())
        return raiseOverflowError(globalObject, scope, "key length is too great."_s);
    if (!refreshBuffers(globalObject, password, salt))
        return {};

    PyBytes* key = newBytes(globalObject, keyLength);
    if (!key)
        return {};
    std::span<uint8_t> keySpan { key->mutableData(), static_cast<size_t>(keyLength) };
    if (const EVP_MD* digest = boringSSLDigestFor(*kind)) {
        auto passwordSpan = password.buffer.span();
        if (!PKCS5_PBKDF2_HMAC(byteCast<char>(passwordSpan.data()), passwordSpan.size(), salt.buffer.span().data(), salt.buffer.span().size(), static_cast<uint32_t>(iterations), digest, keySpan.size(), keySpan.data())) {
            ERR_clear_error();
            return raiseMemoryError(globalObject, scope, String());
        }
    } else
        pbkdf2(*kind, password.buffer.span(), salt.buffer.span(), static_cast<uint32_t>(iterations), keySpan);
    return key;
}

static JSValue scrypt(JSGlobalObject* globalObject, JSValue passwordValue, JSValue saltValue, JSValue nValue, JSValue rValue, JSValue pValue, JSValue maxMemoryValue, JSValue keyLengthValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder password(globalObject);
    BufferHolder salt(globalObject);
    uint64_t n, r, p;
    if (!password.get(passwordValue) || !salt.get(saltValue)
        || failed(scope, unsignedArgument(globalObject, nValue, "unsigned long"_s, 0, n))
        || failed(scope, unsignedArgument(globalObject, rValue, "unsigned long"_s, 0, r))
        || failed(scope, unsignedArgument(globalObject, pValue, "unsigned long"_s, 0, p)))
        return {};
    int64_t maxMemory = 0;
    if (maxMemoryValue) {
        maxMemory = toInt64(globalObject, maxMemoryValue);
        RETURN_IF_EXCEPTION(scope, {});
    }
    int64_t keyLength = 64;
    if (keyLengthValue) {
        keyLength = toInt64(globalObject, keyLengthValue);
        RETURN_IF_EXCEPTION(scope, {});
    }
    constexpr int64_t limit = std::numeric_limits<int>::max();
    if (password.buffer.length > limit)
        return raiseOverflowError(globalObject, scope, "password is too long"_s);
    if (salt.buffer.length > limit)
        return raiseOverflowError(globalObject, scope, "salt is too long"_s);
    if (n < 2 || n & (n - 1))
        return raiseValueError(globalObject, scope, "n must be a power of 2"_s);
    if (maxMemory < 0 || maxMemory > limit)
        return raiseValueError(globalObject, scope, "maxmem must be positive and at most "_s, limit);
    if (keyLength < 1 || keyLength > limit)
        return raiseValueError(globalObject, scope, "dklen must be at least 1 and at most "_s, limit);
    if (!refreshBuffers(globalObject, password, salt))
        return {};

    PyBytes* key = newBytes(globalObject, keyLength);
    if (!key)
        return {};
    auto passwordSpan = password.buffer.span();
    if (!EVP_PBE_scrypt(byteCast<char>(passwordSpan.data()), passwordSpan.size(), salt.buffer.span().data(), salt.buffer.span().size(), n, r, p, static_cast<size_t>(maxMemory), key->mutableData(), static_cast<size_t>(keyLength))) {
        bool isOverLimit = ERR_GET_REASON(ERR_peek_last_error()) == EVP_R_MEMORY_LIMIT_EXCEEDED;
        ERR_clear_error();
        if (isOverLimit)
            return raiseValueError(globalObject, scope, "[digital envelope routines] memory limit exceeded"_s);
        return raiseValueError(globalObject, scope, "invalid parameter combination for n, r, p, and maxmem"_s);
    }
    return key;
}

// ---- The rest ----

// In a time that depends on the length of `b` and on nothing else.
static bool equalInConstantTime(std::span<const uint8_t> a, std::span<const uint8_t> b)
{
    volatile const uint8_t* left = a.data();
    volatile const uint8_t* right = b.data();
    volatile uint8_t difference = 0;
    if (a.size() != b.size()) {
        left = right;
        difference = 1;
    }
    for (size_t i = 0; i < b.size(); ++i)
        difference = difference | (left[i] ^ right[i]);
    return !difference;
}

static JSValue compareDigest(JSGlobalObject* globalObject, JSValue a, JSValue b)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (isStr(a) && isStr(b)) {
        String left = strValue(a)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        String right = strValue(b)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (!left.containsOnlyASCII() || !right.containsOnlyASCII())
            return raiseTypeError(globalObject, scope, "comparing strings with non-ASCII characters is not supported"_s);
        CString leftBytes = left.ascii();
        CString rightBytes = right.ascii();
        return jsBoolean(equalInConstantTime(byteCast<uint8_t>(leftBytes.span()), byteCast<uint8_t>(rightBytes.span())));
    }
    if (!hasBuffer(a) && !hasBuffer(b))
        return raiseTypeError(globalObject, scope, "unsupported operand types(s) or combination of types: '"_s, typeName(globalObject, a), "' and '"_s, typeName(globalObject, b), '\'');
    BufferHolder left(globalObject);
    BufferHolder right(globalObject);
    if (!left.get(a) || !right.get(b) || !refreshBuffers(globalObject, left))
        return {};
    return jsBoolean(equalInConstantTime(left.buffer.span(), right.buffer.span()));
}

static JSValue getFIPSMode(JSGlobalObject*) { return jsNumber(0); }

static constexpr NativeDef functions[] = {
    PY_FUNCTION("new", newHash, "(name, data=b'', *, usedforsecurity=True, string=None)"),
    PY_FUNCTION("pbkdf2_hmac", pbkdf2HMAC, "(hash_name, password, salt, iterations, dklen=None)"),
    PY_FUNCTION("scrypt", scrypt, "(password, *, salt, n, r, p, maxmem=0, dklen=64)"),
    PY_FUNCTION("get_fips_mode", getFIPSMode, "()"),
    PY_FUNCTION("compare_digest", compareDigest, "(a, b, /)"),
    PY_FUNCTION("hmac_digest", hmacDigestFunction, "(key, msg, digest)"),
    PY_FUNCTION("hmac_new", hmacNew, "(key, msg=b'', digestmod=None)"),
};

} // namespace Hashlib

void initializeHashlibModule(JSGlobalObject* globalObject, PyModule* module)
{
    using namespace Hashlib;
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    module->addFunctions(globalObject, functions);
    module->addFunctions(globalObject, constructors);
    module->add(globalObject, "HASH"_s, hashType(globalObject));
    module->add(globalObject, "HASHXOF"_s, extendableHashType(globalObject));
    module->add(globalObject, "HMAC"_s, rt.typeFor(hmacTypeDef));
    module->add(globalObject, "UnsupportedDigestmodError"_s, unsupportedDigestmodError(globalObject));
    module->add(globalObject, "_GIL_MINSIZE"_s, jsNumber(2048));

    PySet* names = PySet::createFrozen(globalObject);
    for (unsigned i = 0; i < numberOfHashKinds; ++i) {
        names->add(globalObject, makeStr(vm, String(infoFor(static_cast<HashKind>(i)).name)));
        RETURN_IF_EXCEPTION(scope, void());
    }
    module->add(globalObject, "openssl_md_meth_names"_s, names);

    // The functions above, to the names of what they make.
    PyDict* byFunction = PyDict::create(globalObject);
    for (auto& def : constructors) {
        JSValue function = module->dict()->get(internString(vm, def.name));
        byFunction->set(globalObject, function, makeStr(vm, String(def.name).substring(lengthOfConstructorPrefix)));
        RETURN_IF_EXCEPTION(scope, void());
    }
    module->add(globalObject, "_constructors"_s, makeMappingProxy(globalObject, byFunction));
}

} // namespace PythonModules
} // namespace Bun
