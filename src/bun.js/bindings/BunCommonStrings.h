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
    macro(ACL, "ACL") \
    macro(BIND, "BIND") \
    macro(CHECKOUT, "CHECKOUT") \
    macro(CONNECT, "CONNECT") \
    macro(COPY, "COPY") \
    macro(ConnectionWasClosed, "The connection was closed.") \
    macro(DELETE, "DELETE") \
    macro(GET, "GET") \
    macro(HEAD, "HEAD") \
    macro(IN4Loopback, "127.0.0.1") \
    macro(IN6Any, "::") \
    macro(IPv4, "IPv4") \
    macro(IPv6, "IPv6") \
    macro(LINK, "LINK") \
    macro(LOCK, "LOCK") \
    macro(MERGE, "MERGE") \
    macro(MKACTIVITY, "MKACTIVITY") \
    macro(MKCALENDAR, "MKCALENDAR") \
    macro(MKCOL, "MKCOL") \
    macro(MOVE, "MOVE") \
    macro(MSEARCH, "M_SEARCH") \
    macro(NOTIFY, "NOTIFY") \
    macro(OPTIONS, "OPTIONS") \
    macro(OperationFailed, "The operation failed.") \
    macro(OperationTimedOut, "The operation timed out.") \
    macro(OperationWasAborted, "The operation was aborted.") \
    macro(PATCH, "PATCH") \
    macro(POST, "POST") \
    macro(PROPFIND, "PROPFIND") \
    macro(PROPPATCH, "PROPPATCH") \
    macro(PURGE, "PURGE") \
    macro(PUT, "PUT") \
    macro(QUERY, "QUERY") \
    macro(REBIND, "REBIND") \
    macro(REPORT, "REPORT") \
    macro(SEARCH, "SEARCH") \
    macro(SOURCE, "SOURCE") \
    macro(SUBSCRIBE, "SUBSCRIBE") \
    macro(TRACE, "TRACE") \
    macro(UNBIND, "UNBIND") \
    macro(UNLINK, "UNLINK") \
    macro(UNLOCK, "UNLOCK") \
    macro(UNSUBSCRIBE, "UNSUBSCRIBE") \
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
