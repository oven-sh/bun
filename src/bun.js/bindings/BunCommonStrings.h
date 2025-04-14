#pragma once

// clang-format off
// The items in this list must also be present in BunBuiltinNames.h
// If we use it as an identifier name in hot code, we should put it in this list.
#define BUN_COMMON_STRINGS_EACH_NAME(macro) \
    macro(require)                          \
    macro(resolve) \
    macro(mockedFunction)

// These ones don't need to be in BunBuiltinNames.h
// If we don't use it as an identifier name, but we want to avoid allocating the string frequently, put it in this list.
#define BUN_COMMON_STRINGS_EACH_NAME_NOT_BUILTIN_NAMES(macro) \
    macro(httpACL, "ACL") \
    macro(httpBIND, "BIND") \
    macro(httpCHECKOUT, "CHECKOUT") \
    macro(httpCONNECT, "CONNECT") \
    macro(httpCOPY, "COPY") \
    macro(ConnectionWasClosed, "The connection was closed.") \
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
    macro(httpMKCALENDAR, "MKCALENDAR") \
    macro(httpMKCOL, "MKCOL") \
    macro(httpMOVE, "MOVE") \
    macro(httpMSEARCH, "M-SEARCH") \
    macro(httpNOTIFY, "NOTIFY") \
    macro(httpOPTIONS, "OPTIONS") \
    macro(OperationFailed, "The operation failed.") \
    macro(OperationTimedOut, "The operation timed out.") \
    macro(OperationWasAborted, "The operation was aborted.") \
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
    macro(ascii, "ascii") \
    macro(base64, "base64") \
    macro(base64url, "base64url") \
    macro(buffer, "buffer") \
    macro(ec, "ec") \
    macro(ed25519, "ed25519") \
    macro(hex, "hex") \
    macro(latin1, "latin1") \
    macro(lax, "lax") \
    macro(none, "none") \
    macro(rsa, "rsa") \
    macro(rsaPss, "rsa-pss") \
    macro(s3Error, "S3Error") \
    macro(strict, "strict") \
    macro(jwkCrv, "crv") \
    macro(jwkD, "d") \
    macro(jwkDp, "dp") \
    macro(jwkDq, "dq") \
    macro(jwkDsa, "DSA") \
    macro(jwkE, "e") \
    macro(jwkEc, "EC") \
    macro(jwkG, "g") \
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
    macro(systemError, "SystemError") \
    macro(ucs2, "ucs2") \
    macro(utf16le, "utf16le") \
    macro(utf8, "utf8") \
    macro(x25519, "x25519")

// clang-format on

#define BUN_COMMON_STRINGS_ACCESSOR_DEFINITION(name)                           \
    JSC::JSString* name##String(JSC::JSGlobalObject* globalObject)             \
    {                                                                          \
        return m_commonString_##name.getInitializedOnMainThread(globalObject); \
    }

#define BUN_COMMON_STRINGS_ACCESSOR_DEFINITION_NOT_BUILTIN_NAMES(name, literal) \
    BUN_COMMON_STRINGS_ACCESSOR_DEFINITION(name)

#define BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION(name) \
    JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSString> m_commonString_##name;

#define BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION_NOT_BUILTIN_NAMES(name, literal) \
    BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION(name)

namespace Bun {

class CommonStrings {
public:
    BUN_COMMON_STRINGS_EACH_NAME(BUN_COMMON_STRINGS_ACCESSOR_DEFINITION)
    BUN_COMMON_STRINGS_EACH_NAME_NOT_BUILTIN_NAMES(BUN_COMMON_STRINGS_ACCESSOR_DEFINITION_NOT_BUILTIN_NAMES)
    void initialize();

    template<typename Visitor>
    void visit(Visitor& visitor);

private:
    BUN_COMMON_STRINGS_EACH_NAME(BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION)
    BUN_COMMON_STRINGS_EACH_NAME_NOT_BUILTIN_NAMES(BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION_NOT_BUILTIN_NAMES)
};

} // namespace Bun

#undef BUN_COMMON_STRINGS_ACCESSOR_DEFINITION
#undef BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION
#undef BUN_COMMON_STRINGS_ACCESSOR_DEFINITION_NOT_BUILTIN_NAMES
#undef BUN_COMMON_STRINGS_LAZY_PROPERTY_DECLARATION_NOT_BUILTIN_NAMES
