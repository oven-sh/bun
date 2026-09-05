#pragma once

// clang-format off
// macro(name, builtinName): strings that are also Bun builtin names (BunBuiltinNames.h).
#define BUN_COMMON_STRINGS_EACH_NAME(macro) \
    macro(require, require) \
    macro(resolve, resolve) \
    macro(mockedFunction, mockedFunction) \
    macro(binaryTypeBlob, blob)

// macro(name, propertyName, literal): strings that are also JSC common identifiers (vm.propertyNames).
#define BUN_COMMON_STRINGS_EACH_VM_PROPERTY_NAME(macro) \
    macro(fetchError, error, "error") \
    macro(keyTypePrivate, privateKeyword, "private") \
    macro(keyTypePublic, publicKeyword, "public") \
    macro(mockResultReturn, returnKeyword, "return") \
    macro(mockResultThrow, throwKeyword, "throw")

// These ones don't need to be in BunBuiltinNames.h
// If we don't use it as an identifier name, but we want to avoid allocating the string frequently, put it in this list.
#define BUN_COMMON_STRINGS_EACH_NAME_NOT_BUILTIN_NAMES(macro) \
    macro(httpACL, "ACL") \
    macro(httpBIND, "BIND") \
    macro(httpCHECKOUT, "CHECKOUT") \
    macro(httpCONNECT, "CONNECT") \
    macro(httpCOPY, "COPY") \
    macro(httpDELETE, "DELETE") \
    macro(httpGET, "GET") \
    macro(httpHEAD, "HEAD") \
    macro(IN4Loopback, "127.0.0.1") \
    macro(IN6Any, "::") \
    macro(IPv4, "IPv4") \
    macro(IPv6, "IPv6") \
    macro(httpLINK, "LINK") \
    macro(httpLOCK, "LOCK") \
    macro(httpMERGE, "MERGE") \
    macro(httpMKACTIVITY, "MKACTIVITY") \
    macro(httpMKADDRESSBOOK, "MKADDRESSBOOK") \
    macro(httpMKCALENDAR, "MKCALENDAR") \
    macro(httpMKCOL, "MKCOL") \
    macro(httpMOVE, "MOVE") \
    macro(httpMSEARCH, "M-SEARCH") \
    macro(httpNOTIFY, "NOTIFY") \
    macro(httpOPTIONS, "OPTIONS") \
    /* node's AbortError default message, which unlike the DOMException one has no trailing period: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/errors.js#L980 */ \
    macro(OperationWasAborted, "The operation was aborted") \
    macro(httpPATCH, "PATCH") \
    macro(httpPOST, "POST") \
    macro(httpPROPFIND, "PROPFIND") \
    macro(httpPROPPATCH, "PROPPATCH") \
    macro(httpPURGE, "PURGE") \
    macro(httpPUT, "PUT") \
    macro(httpQUERY, "QUERY") \
    macro(httpREBIND, "REBIND") \
    macro(httpREPORT, "REPORT") \
    macro(httpSEARCH, "SEARCH") \
    macro(httpSOURCE, "SOURCE") \
    macro(httpSUBSCRIBE, "SUBSCRIBE") \
    macro(httpTRACE, "TRACE") \
    macro(httpUNBIND, "UNBIND") \
    macro(httpUNLINK, "UNLINK") \
    macro(httpUNLOCK, "UNLOCK") \
    macro(httpUNSUBSCRIBE, "UNSUBSCRIBE") \
    macro(alpnH2, "h2") \
    macro(alpnHttp11, "http/1.1") \
    macro(ascii, "ascii") \
    macro(base64, "base64") \
    macro(base64url, "base64url") \
    macro(binaryTypeArrayBuffer, "arraybuffer") \
    macro(binaryTypeNodeBuffer, "nodebuffer") \
    macro(binaryTypeUint8Array, "uint8array") \
    macro(buffer, "buffer") \
    macro(fetchCors, "cors") \
    macro(fetchFollow, "follow") \
    macro(fetchForceCache, "force-cache") \
    macro(fetchInclude, "include") \
    macro(fetchManual, "manual") \
    macro(fetchNavigate, "navigate") \
    macro(fetchNoCache, "no-cache") \
    macro(fetchNoCors, "no-cors") \
    macro(fetchNoStore, "no-store") \
    macro(fetchOnlyIfCached, "only-if-cached") \
    macro(fetchReload, "reload") \
    macro(fetchSameOrigin, "same-origin") \
    macro(hex, "hex") \
    macro(ipv4Lower, "ipv4") \
    macro(ipv6Lower, "ipv6") \
    macro(keyTypeSecret, "secret") \
    macro(latin1, "latin1") \
    macro(lax, "lax") \
    macro(mockResultIncomplete, "incomplete") \
    macro(none, "none") \
    macro(protocolHttp, "http") \
    macro(protocolHttps, "https") \
    macro(quicDatagramAbandoned, "abandoned") \
    macro(quicDatagramAcknowledged, "acknowledged") \
    macro(quicDatagramLost, "lost") \
    macro(s3Error, "S3Error") \
    macro(strict, "strict") \
    macro(jwkCrv, "crv") \
    macro(jwkD, "d") \
    macro(jwkDp, "dp") \
    macro(jwkDq, "dq") \
    macro(jwkE, "e") \
    macro(jwkEc, "EC") \
    macro(jwkK, "k") \
    macro(jwkP, "p") \
    macro(jwkQ, "q") \
    macro(jwkQi, "qi") \
    macro(jwkKty, "kty") \
    macro(jwkN, "n") \
    macro(jwkOct, "oct") \
    macro(jwkOkp, "OKP") \
    macro(jwkRsa, "RSA") \
    macro(jwkX, "x") \
    macro(jwkY, "y") \
    macro(ucs2, "ucs2") \
    macro(unknown, "unknown") \
    macro(utf16le, "utf16le") \
    macro(utf8, "utf8") \
    macro(utf8WithDash, "utf-8")

// clang-format on

namespace JSC {
class VM;
class JSString;
class AbstractSlotVisitor;
class SlotVisitor;
}

#define BUN_COMMON_STRINGS_INDEX_ENTRY(name, ...) name,
#define BUN_COMMON_STRINGS_SLOT(name, ...) JSC::JSString* m_##name { nullptr };
#define BUN_COMMON_STRINGS_ACCESSOR(name, ...) \
    JSC::JSString* name##String()              \
    {                                          \
        if (!m_##name) [[unlikely]]            \
            initialize(m_##name, Index::name); \
        return m_##name;                       \
    }

namespace Bun {

// One JSString per entry above, created on first use; see Bun::commonStrings(vm) in BunClientData.h.
struct CommonStrings {
    // Only the instance in JSVMClientData is rooted: a copy would hand out unrooted cells.
    WTF_MAKE_NONCOPYABLE(CommonStrings);
    WTF_MAKE_NONMOVABLE(CommonStrings);

    // clang-format off
    enum class Index : uint8_t {
        BUN_COMMON_STRINGS_EACH_NAME(BUN_COMMON_STRINGS_INDEX_ENTRY)
        BUN_COMMON_STRINGS_EACH_VM_PROPERTY_NAME(BUN_COMMON_STRINGS_INDEX_ENTRY)
        BUN_COMMON_STRINGS_EACH_NAME_NOT_BUILTIN_NAMES(BUN_COMMON_STRINGS_INDEX_ENTRY)
        Count
    };

    BUN_COMMON_STRINGS_EACH_NAME(BUN_COMMON_STRINGS_SLOT)
    BUN_COMMON_STRINGS_EACH_VM_PROPERTY_NAME(BUN_COMMON_STRINGS_SLOT)
    BUN_COMMON_STRINGS_EACH_NAME_NOT_BUILTIN_NAMES(BUN_COMMON_STRINGS_SLOT)

    BUN_COMMON_STRINGS_EACH_NAME(BUN_COMMON_STRINGS_ACCESSOR)
    BUN_COMMON_STRINGS_EACH_VM_PROPERTY_NAME(BUN_COMMON_STRINGS_ACCESSOR)
    BUN_COMMON_STRINGS_EACH_NAME_NOT_BUILTIN_NAMES(BUN_COMMON_STRINGS_ACCESSOR)
    // clang-format on

    explicit CommonStrings(JSC::VM& vm)
        : m_vm(vm)
    {
    }

    template<typename Visitor>
    void visit(Visitor& visitor);

#if ASSERT_ENABLED
    // For the assert in Bun::toJS(BunString): is `literal` one of the strings above?
    static bool isCommonStringLiteral(std::span<const Latin1Character> literal);
#endif

private:
    void initialize(JSC::JSString*& slot, Index);

    JSC::VM& m_vm;
};

} // namespace Bun

#undef BUN_COMMON_STRINGS_INDEX_ENTRY
#undef BUN_COMMON_STRINGS_SLOT
#undef BUN_COMMON_STRINGS_ACCESSOR
