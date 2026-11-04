#include "BunPythonModule.h"

#if !OS(WINDOWS)

#include "../../../../packages/bun-usockets/src/crypto/root_certs_header.h"
#include <JavaScriptCore/PyEventWait.h>
#include <JavaScriptCore/PyIO.h>
#include <JavaScriptCore/PySocket.h>
#include <JavaScriptCore/PyWeakRef.h>
#include <dirent.h>
#include <openssl/bio.h>
#include <openssl/crypto.h>
#include <openssl/dh.h>
#include <openssl/err.h>
#include <openssl/obj.h>
#include <openssl/pem.h>
#include <openssl/rand.h>
#include <openssl/ssl.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <wtf/HexNumber.h>
#include <wtf/Scope.h>
#include <wtf/text/ASCIIFastPath.h>

// The module _ssl, under ssl. (Modules/_ssl.c in CPython is the reference.) The library is the BoringSSL that the rest of Bun uses,
// which is not OpenSSL: python/DEFERRED.md in JavaScriptCore says what that means to a program.
//
// No call into the library is made without the GIL, because it calls back (the SNI callback, the message callback, passwords,
// PSK...), and no call into it blocks: to the library every socket is non-blocking. Where it says that it wants to read or write, a
// socket that blocks or has a timeout waits in waitForEvents(), as every other operation of a socket does. That lets other threads
// run, runs the handlers of signals, and on the main thread keeps the event loop turning.

namespace Bun {
namespace PythonModules {
namespace Ssl {

enum Protocol : int {
    ProtocolTLS = 2,
    ProtocolTLSv1 = 3,
    ProtocolTLSv1_1 = 4,
    ProtocolTLSv1_2 = 5,
    ProtocolTLSClient = 16,
    ProtocolTLSServer = 17,
};

// What SSLError.args[0] is. Up to WantConnect they are the library's own.
enum ErrorNumber : int {
    ErrorNone,
    ErrorSSL,
    ErrorWantRead,
    ErrorWantWrite,
    ErrorWantX509Lookup,
    ErrorSyscall,
    ErrorZeroReturn,
    ErrorWantConnect,
    ErrorEOF,
    ErrorNoSocket,
    ErrorInvalidErrorCode,
};

enum { CertNone,
    CertOptional,
    CertRequired };

enum { EncodingPEM = 1,
    EncodingDER = 2,
    EncodingPEMAux = 0x101 };

static constexpr int protoMinimumSupported = -2;
static constexpr int protoMaximumSupported = -1;

// BoringSSL always does what these two ask for, and has 0 for them. A program sets them and looks whether they are set, so they have the
// values that OpenSSL gives them, which mean nothing to BoringSSL: it keeps them with the other flags.
static constexpr unsigned long verifyFlagStrict = 0x20;
static constexpr unsigned long verifyFlagTrustedFirst = 0x8000;
static_assert(!X509_V_FLAG_X509_STRICT && !X509_V_FLAG_TRUSTED_FIRST);

// CPython's, without "@SECLEVEL=2", which this library does not know. What else it does not know (DHE, CCM) it passes over.
#define DEFAULT_CIPHERS "ECDH+AESGCM:ECDH+CHACHA20:ECDH+AES:DHE+AES:!aNULL:!eNULL:!aDSS:!SHA1:!AESCCM"

// ---- The objects ----

struct Context {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(Context);

    ~Context()
    {
        if (keylogFile)
            fclose(keylogFile);
    }

    bssl::UniquePtr<SSL_CTX> ctx;
    Vector<uint8_t> alpnProtocols;
    // What clients, and what servers, may sign with. Which of the two a connection signs with and which it accepts depends on its
    // side, so they are given to connections. Empty: whatever the library likes.
    Vector<uint16_t> signatureAlgorithmsOfClients;
    Vector<uint16_t> signatureAlgorithmsOfServers;
    // A context of OpenSSL has a certificate for each kind of key, the library's has one: the last that was loaded. Those of other
    // kinds that were loaded before it are kept here, with the kind, and given to connections.
    Vector<std::pair<int, bssl::UniquePtr<SSL_CREDENTIAL>>> otherCredentials;
    int protocol { 0 };
    bool checksHostname { false };
    // The library answers with a version where none has been set.
    bool hasMinimumVersion { false };
    bool hasMaximumVersion { false };
    unsigned hostFlags { 0 }; // It has no way to ask for them.
    FILE* keylogFile { nullptr };
    // It does not count.
    unsigned connects { 0 };
    unsigned goodConnects { 0 };
    unsigned accepts { 0 };
    unsigned goodAccepts { 0 };
    unsigned hits { 0 };
};

enum ContextField : unsigned {
    ContextSNICallback,
    ContextMessageCallback,
    ContextKeylogFilename,
    ContextPSKClientCallback,
    ContextPSKServerCallback,
    ContextFieldCount
};

struct Connection {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(Connection);

    ~Connection()
    {
        // A session is still good for another connection if this one was never shut down.
        if (ssl)
            SSL_set_shutdown(ssl.get(), SSL_SENT_SHUTDOWN | SSL_get_shutdown(ssl.get()));
    }

    bssl::UniquePtr<SSL> ssl;
    bool isServer { false };
    bool hasSeenZeroFromShutdown { false };
    bool hasSeenEOF { false };
    bool hasStartedHandshake { false };
    bool hasCountedHandshake { false };
    // For the BIO.
    int descriptor { -1 };
    int systemError { 0 };
    // What the library does not keep.
    bssl::UniquePtr<STACK_OF(X509)> verifiedChain;
    bssl::UniquePtr<SSL_SESSION> newestSession;
    Vector<uint16_t> ciphersOfClient;
};

enum ConnectionField : unsigned {
    ConnectionSocket, // A weak reference. Empty: the connection works on two MemoryBIOs.
    ConnectionContext,
    ConnectionOwner, // A weak reference, or empty.
    ConnectionServerHostname,
    ConnectionCallbackException, // What a callback raised while the library was running.
    ConnectionFieldCount
};

struct MemoryBIO {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(MemoryBIO);

    bssl::UniquePtr<BIO> bio;
    bool hasEOF { false };
};

struct Session {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(Session);

    bssl::UniquePtr<SSL_SESSION> session;
};
enum SessionField : unsigned { SessionContext,
    SessionFieldCount };

struct Certificate {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(Certificate);

    bssl::UniquePtr<X509> certificate;
};

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(Context);
WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(Connection);
WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(MemoryBIO);
WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(Session);
WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(Certificate);

static PyType* contextType(JSGlobalObject*);
static PyType* connectionType(JSGlobalObject*);
static PyType* memoryBIOType(JSGlobalObject*);
static PyType* sessionType(JSGlobalObject*);
static PyType* certificateType(JSGlobalObject*);

static Context& contextOf(JSValue self) { return *stateOf<Context>(self); }
static Connection& connectionOf(JSValue self) { return *stateOf<Connection>(self); }
static PyRecord* recordOf(const SSL* ssl) { return static_cast<PyRecord*>(SSL_get_app_data(ssl)); }
static PyRecord* contextRecordOf(PyRecord* connection) { return PyRecord::from(connection->get(ConnectionContext)); }

// ---- Text ----

// Bytes with a NUL after them, which is how the library takes names and paths.
class CText {
public:
    CText() { m_bytes.append('\0'); }

    void assign(std::span<const uint8_t> bytes)
    {
        m_bytes.shrink(0);
        m_bytes.append(byteCast<char>(bytes));
        m_bytes.append('\0');
    }
    const char* data() const { return m_bytes.span().data(); }
    size_t length() const { return m_bytes.size() - 1; }
    std::span<const uint8_t> span() const { return byteCast<uint8_t>(m_bytes.span().first(length())); }

private:
    Vector<char, 64> m_bytes;
};

static JSString* strFromASCII(VM& vm, const char* text) { return makeStr(vm, String::fromLatin1(text)); }
static JSValue strOrNone(VM& vm, const char* text) { return text ? JSValue(strFromASCII(vm, text)) : jsUndefined(); }

// Empty: a UnicodeDecodeError.
static JSValue strFromUTF8(JSGlobalObject* globalObject, std::span<const uint8_t> bytes)
{
    VM& vm = getVM(globalObject);
    if (charactersAreAllASCII(bytes))
        return makeStr(vm, String(byteCast<Latin1Character>(bytes)));
    JSValue object = bytesFrom(globalObject, bytes);
    if (!object)
        return {};
    return bytesDecode(globalObject, object, internString(vm, "utf-8"_s), internString(vm, "strict"_s));
}

static std::span<const uint8_t> spanOf(const ASN1_STRING* string)
{
    return { ASN1_STRING_get0_data(string), static_cast<size_t>(ASN1_STRING_length(string)) };
}

static std::span<const uint8_t> contentsOf(BIO* bio)
{
    const uint8_t* data = nullptr;
    size_t length = 0;
    BIO_mem_contents(bio, &data, &length);
    return { data, length };
}

// ---- Errors ----

static JSValue sslErrorStr(JSGlobalObject* globalObject, JSValue self)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue text = getAttr(globalObject, self, internString(vm, "strerror"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (isStr(text))
        return text;
    JSValue args = getAttr(globalObject, self, internString(vm, "args"_s));
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, str(globalObject, args));
}

static constexpr NativeDef sslErrorMethods[] = {
    PY_SLOT("__str__", sslErrorStr, "($self, /)"),
};

static constexpr TypeDef sslErrorTypeDef { "ssl.SSLError"_s, { TypeFlag::Base, TypeFlag::Immutable }, sslErrorMethods, {}, "An error occurred in the SSL implementation."_s };

static PyType* sslError(JSGlobalObject* globalObject)
{
    Runtime& rt = runtime(globalObject);
    return rt.typeFor(sslErrorTypeDef, rt.OSError());
}

// The classes derived from it are made as a class statement would make them, one of them from two bases. They are kept in a tuple
// that is a hidden field of SSLError.
enum DerivedError : unsigned {
    CertVerificationError,
    ZeroReturnError,
    WantWriteError,
    WantReadError,
    SyscallError,
    EOFError,
    DerivedErrorCount
};

struct DerivedErrorDef {
    ASCIILiteral name;
    ASCIILiteral doc;
};

static constexpr DerivedErrorDef derivedErrors[DerivedErrorCount] = {
    { "SSLCertVerificationError"_s, "A certificate could not be verified."_s },
    { "SSLZeroReturnError"_s, "SSL/TLS session closed cleanly."_s },
    { "SSLWantWriteError"_s, "Non-blocking SSL socket needs to write more data\nbefore the requested operation can be completed."_s },
    { "SSLWantReadError"_s, "Non-blocking SSL socket needs to read more data\nbefore the requested operation can be completed."_s },
    { "SSLSyscallError"_s, "System error when attempting SSL operation."_s },
    { "SSLEOFError"_s, "SSL/TLS connection terminated abruptly."_s },
};

static PyType* derivedError(JSGlobalObject* globalObject, DerivedError which)
{
    return PyType::from(PyTuple::from(hiddenField(globalObject, sslError(globalObject), 0))->at(which));
}

static bool makeDerivedErrors(JSGlobalObject* globalObject)
{
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    PyType* base = sslError(globalObject);
    if (hiddenField(globalObject, base, 0))
        return true;
    JSValue types[DerivedErrorCount];
    for (unsigned i = 0; i < DerivedErrorCount; ++i) {
        PyDict* dict = PyDict::create(globalObject);
        dict->set(vm, internString(vm, "__module__"_s), makeStr(vm, "ssl"_s));
        dict->set(vm, internString(vm, "__doc__"_s), makeStr(vm, derivedErrors[i].doc));
        // ssl.CertificateError, which is this one now, used to be a ValueError.
        PyTuple* bases = i == CertVerificationError ? PyTuple::create(globalObject, { JSValue(base), JSValue(rt.ValueError()) }) : PyTuple::create(globalObject, { JSValue(base) });
        types[i] = call(globalObject, rt.typeType(), makeStr(vm, derivedErrors[i].name), bases, dict);
        RETURN_IF_EXCEPTION(scope, false);
    }
    setHiddenField(globalObject, base, 0, PyTuple::create(globalObject, std::span<const JSValue> { types, DerivedErrorCount }));
    return true;
}

// The library says CERTIFICATE_VERIFY_FAILED where OpenSSL says "certificate verify failed", which programs look for.
static String reasonText(uint32_t code)
{
    const char* text = ERR_reason_error_string(code);
    if (!text)
        return {};
    StringBuilder builder;
    for (const char* p = text; *p; ++p) {
        // It has a few in words of its own: "PEM routines", "malloc failure".
        if (!isASCIIUpper(*p) && !isASCIIDigit(*p) && *p != '_')
            return String::fromLatin1(text);
        builder.append(*p == '_' ? ' ' : toASCIILower(*p));
    }
    return builder.toString();
}

// raise type(number, "[library: REASON] text: what is wrong with the certificate (_ssl.c:line)"). A null text is the library's for
// the code. The queue of the library's errors is left as it is.
static void raiseWithCode(JSGlobalObject* globalObject, PyRecord* connection, PyType* type, int number, const String& givenText, int line, uint32_t code)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (number == ErrorEOF && connection)
        connectionOf(connection).hasSeenEOF = true;

    String text = givenText;
    JSValue reason = jsUndefined();
    JSValue library = jsUndefined();
    if (code) {
        reason = strOrNone(vm, ERR_reason_symbol_name(code));
        library = strOrNone(vm, ERR_lib_symbol_name(code));
        if (text.isNull())
            text = reasonText(code);
    }

    bool isAboutCertificate = connection && type == derivedError(globalObject, CertVerificationError);
    long verifyCode = 0;
    JSValue verifyMessage;
    if (isAboutCertificate) {
        verifyCode = SSL_get_verify_result(connectionOf(connection).ssl.get());
        if (verifyCode == X509_V_ERR_HOSTNAME_MISMATCH || verifyCode == X509_V_ERR_IP_ADDRESS_MISMATCH) {
            JSValue hostname = connection->get(ConnectionServerHostname);
            String name = hostname ? strValue(hostname)->value(globalObject) : String("None"_s);
            RETURN_IF_EXCEPTION(scope, void());
            verifyMessage = makeStr(vm, makeString(verifyCode == X509_V_ERR_HOSTNAME_MISMATCH ? "Hostname"_s : "IP address"_s, " mismatch, certificate is not valid for '"_s, name, "'."_s));
        } else
            verifyMessage = strOrNone(vm, X509_verify_cert_error_string(verifyCode));
    }

    StringBuilder message;
    if (!library.isUndefined()) {
        message.append('[', asString(library)->value(globalObject).data);
        if (!reason.isUndefined())
            message.append(": "_s, asString(reason)->value(globalObject).data);
        message.append("] "_s);
    }
    if (!text.isNull())
        message.append(text);
    else
        message.append("unknown error (0x"_s, hex(code, Lowercase), ')');
    if (verifyMessage)
        message.append(": "_s, verifyMessage.isUndefined() ? String("None"_s) : String(asString(verifyMessage)->value(globalObject).data));
    message.append(" (_ssl.c:"_s, line, ')');

    JSValue exception = call(globalObject, type, jsNumber(number), makeStr(vm, message.toString()));
    RETURN_IF_EXCEPTION(scope, void());
    setAttr(globalObject, exception, internString(vm, "reason"_s), reason);
    RETURN_IF_EXCEPTION(scope, void());
    setAttr(globalObject, exception, internString(vm, "library"_s), library);
    RETURN_IF_EXCEPTION(scope, void());
    if (isAboutCertificate) {
        setAttr(globalObject, exception, internString(vm, "verify_code"_s), makeInt(globalObject, static_cast<int64_t>(verifyCode)));
        RETURN_IF_EXCEPTION(scope, void());
        setAttr(globalObject, exception, internString(vm, "verify_message"_s), verifyMessage);
        RETURN_IF_EXCEPTION(scope, void());
    }
    raiseException(globalObject, scope, exception);
}

// SSLError for the last error the library has queued, or with a text of our own.
static JSValue raiseLibraryError(JSGlobalObject* globalObject, int line)
{
    uint32_t code = ERR_peek_last_error();
    raiseWithCode(globalObject, nullptr, sslError(globalObject), ERR_GET_REASON(code), String(), line, code);
    ERR_clear_error();
    return {};
}

static JSValue raiseOwnError(JSGlobalObject* globalObject, ASCIILiteral text, int line)
{
    raiseWithCode(globalObject, nullptr, sslError(globalObject), 0, text, line, 0);
    ERR_clear_error();
    return {};
}

// SSLError(text): its str() is that of the tuple.
static JSValue raisePlainError(JSGlobalObject* globalObject, const String& text)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return raise(globalObject, scope, sslError(globalObject), text);
}

#define LIBRARY_ERROR(globalObject) raiseLibraryError(globalObject, __LINE__)
#define OWN_ERROR(globalObject, text) raiseOwnError(globalObject, text ""_s, __LINE__)
#define TEXT_WITH_LINE(text) makeString("_ssl.c:"_s, __LINE__, ": " text ""_s)

static void raiseCannotDelete(JSGlobalObject* globalObject)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    raise(globalObject, scope, runtime(globalObject).AttributeError(), "cannot delete attribute"_s);
}

static bool warnDeprecated(JSGlobalObject* globalObject, ASCIILiteral message)
{
    return warn(globalObject, runtime(globalObject).DeprecationWarning(), message, 2);
}

// The exception that is propagating gets `context` as its __context__; if none is, that one propagates.
static void chainException(JSGlobalObject* globalObject, JSValue context)
{
    if (!context)
        return;
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue current = takePendingException(globalObject);
    if (!current) {
        raiseException(globalObject, scope, context);
        return;
    }
    if (current != context) {
        setAttr(globalObject, current, internString(vm, "__context__"_s), context);
        if (scope.exception()) [[unlikely]]
            takePendingException(globalObject);
    }
    throwPythonException(globalObject, scope, current);
}

// ---- Arguments ----

// PyUnicode_FSConverter. What is not a path at all is a TypeError with this text, if there is one.
static bool pathArgument(JSGlobalObject* globalObject, JSValue value, ASCIILiteral complaint, CText& result)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue path = ioFSPath(globalObject, value);
    if (!path) {
        if (!complaint.isNull() && clearPendingExceptionIfMatches(globalObject, runtime(globalObject).TypeError()))
            raiseTypeError(globalObject, scope, complaint);
        return false;
    }
    if (isStr(path)) {
        String text = strValue(path)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        result.assign(encodeFilesystem(text).span());
    } else
        result.assign(PyBytes::from(path)->span());
    if (memchr(result.data(), 0, result.length())) {
        raiseValueError(globalObject, scope, "embedded null byte"_s);
        return false;
    }
    return true;
}

// A parameter declared `str` to Argument Clinic, as UTF-8.
static bool textArgument(JSGlobalObject* globalObject, ASCIILiteral function, ASCIILiteral parameter, JSValue value, CText& result)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!isStr(value)) {
        raiseTypeError(globalObject, scope, function, "() argument"_s, parameter.isNull() ? ""_s : " '"_s, parameter.isNull() ? ""_s : parameter, parameter.isNull() ? ""_s : "'"_s, " must be str, not "_s, typeNameOfArgument(globalObject, value));
        return false;
    }
    String text = strValue(value)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    auto encoded = tryEncodeUTF8(text);
    if (!encoded) {
        strEncode(globalObject, strValue(value), internString(vm, "utf-8"_s), internString(vm, "strict"_s));
        ASSERT(scope.exception());
        return false;
    }
    if (encoded->contains(0)) {
        raiseValueError(globalObject, scope, "embedded null character"_s);
        return false;
    }
    result.assign(encoded->span());
    return true;
}

static bool boolArgument(JSGlobalObject* globalObject, JSValue value, bool defaultValue, bool& result)
{
    result = defaultValue;
    if (!value)
        return true;
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    result = isTrue(globalObject, value);
    return !scope.exception();
}

// ---- Certificates as Python sees them ----

static JSValue objectIdentifierText(JSGlobalObject* globalObject, const ASN1_OBJECT* object, bool alwaysNumeric)
{
    VM& vm = getVM(globalObject);
    Vector<char, 256> buffer(256);
    int length = OBJ_obj2txt(buffer.mutableSpan().data(), buffer.size(), object, alwaysNumeric);
    if (length < 0)
        return LIBRARY_ERROR(globalObject);
    if (static_cast<size_t>(length) >= buffer.size()) {
        buffer.grow(length + 1);
        length = OBJ_obj2txt(buffer.mutableSpan().data(), buffer.size(), object, alwaysNumeric);
        if (length < 0)
            return LIBRARY_ERROR(globalObject);
    }
    if (!length && alwaysNumeric)
        return jsUndefined();
    return makeStr(vm, String(byteCast<Latin1Character>(buffer.span().first(length))));
}

// ('commonName', 'localhost')
static JSValue attributeTuple(JSGlobalObject* globalObject, const ASN1_OBJECT* name, const ASN1_STRING* value)
{
    JSValue nameText = objectIdentifierText(globalObject, name, false);
    if (!nameText)
        return {};
    JSValue valueObject;
    if (ASN1_STRING_type(value) == V_ASN1_BIT_STRING)
        valueObject = bytesFrom(globalObject, spanOf(value));
    else {
        unsigned char* text = nullptr;
        int length = ASN1_STRING_to_UTF8(&text, value);
        if (length < 0)
            return LIBRARY_ERROR(globalObject);
        valueObject = strFromUTF8(globalObject, { text, static_cast<size_t>(length) });
        OPENSSL_free(text);
    }
    if (!valueObject)
        return {};
    return PyTuple::create(globalObject, { nameText, valueObject });
}

// A tuple of relative distinguished names, each a tuple of attributes.
static JSValue nameTuple(JSGlobalObject* globalObject, const X509_NAME* name)
{
    JSArray* all = newList(globalObject);
    JSArray* current = newList(globalObject);
    int level = -1;
    int count = X509_NAME_entry_count(name);
    for (int i = 0; i < count; ++i) {
        const X509_NAME_ENTRY* entry = X509_NAME_get_entry(name, i);
        if (level >= 0 && level != X509_NAME_ENTRY_set(entry)) {
            listAppend(globalObject, all, tupleFromList(globalObject, current));
            current = newList(globalObject);
        }
        level = X509_NAME_ENTRY_set(entry);
        JSValue attribute = attributeTuple(globalObject, X509_NAME_ENTRY_get_object(entry), X509_NAME_ENTRY_get_data(entry));
        if (!attribute)
            return {};
        listAppend(globalObject, current, attribute);
    }
    if (listLength(current))
        listAppend(globalObject, all, tupleFromList(globalObject, current));
    return tupleFromList(globalObject, all);
}

static JSValue pairOf(JSGlobalObject* globalObject, ASCIILiteral kind, JSValue value)
{
    if (!value)
        return {};
    return PyTuple::create(globalObject, { JSValue(makeStr(getVM(globalObject), kind)), value });
}

// None: there are none.
static JSValue subjectAltNames(JSGlobalObject* globalObject, X509* certificate)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    bssl::UniquePtr<GENERAL_NAMES> names(static_cast<GENERAL_NAMES*>(X509_get_ext_d2i(certificate, NID_subject_alt_name, nullptr, nullptr)));
    if (!names)
        return jsUndefined();
    JSArray* result = newList(globalObject);
    for (size_t i = 0; i < sk_GENERAL_NAME_num(names.get()); ++i) {
        const GENERAL_NAME* name = sk_GENERAL_NAME_value(names.get(), i);
        JSValue item;
        switch (name->type) {
        case GEN_DIRNAME:
            item = pairOf(globalObject, "DirName"_s, nameTuple(globalObject, name->d.dirn));
            break;
        // Not as the library prints them, which stops at a NUL (CVE-2013-4238).
        case GEN_EMAIL:
            item = pairOf(globalObject, "email"_s, strFromUTF8(globalObject, spanOf(name->d.rfc822Name)));
            break;
        case GEN_DNS:
            item = pairOf(globalObject, "DNS"_s, strFromUTF8(globalObject, spanOf(name->d.dNSName)));
            break;
        case GEN_URI:
            item = pairOf(globalObject, "URI"_s, strFromUTF8(globalObject, spanOf(name->d.uniformResourceIdentifier)));
            break;
        case GEN_RID: {
            char buffer[2048];
            int length = i2t_ASN1_OBJECT(buffer, sizeof(buffer) - 1, name->d.rid);
            if (length < 0)
                RELEASE_AND_RETURN(scope, LIBRARY_ERROR(globalObject));
            item = pairOf(globalObject, "Registered ID"_s, static_cast<size_t>(length) >= sizeof(buffer) ? makeStr(vm, "<INVALID>"_s) : makeStr(vm, String(byteCast<Latin1Character>(std::span { buffer, static_cast<size_t>(length) }))));
            break;
        }
        case GEN_IPADD: {
            auto bytes = spanOf(name->d.ip);
            String text = "<invalid>"_s;
            if (bytes.size() == 4)
                text = makeString(bytes[0], '.', bytes[1], '.', bytes[2], '.', bytes[3]);
            else if (bytes.size() == 16) {
                StringBuilder builder;
                for (unsigned group = 0; group < 8; ++group)
                    builder.append(group ? ":"_s : ""_s, hex(static_cast<unsigned>(bytes[2 * group] << 8 | bytes[2 * group + 1])));
                text = builder.toString();
            }
            item = pairOf(globalObject, "IP Address"_s, makeStr(vm, text));
            break;
        }
        default: {
            if (name->type != GEN_OTHERNAME && name->type != GEN_X400 && name->type != GEN_EDIPARTY) {
                if (!warn(globalObject, runtime(globalObject).RuntimeWarning(), makeString("Unknown general name type "_s, name->type)))
                    return {};
            }
            bssl::UniquePtr<BIO> bio(BIO_new(BIO_s_mem()));
            if (!bio)
                RELEASE_AND_RETURN(scope, raisePlainError(globalObject, "failed to allocate BIO"_s));
            GENERAL_NAME_print(bio.get(), name);
            auto printed = contentsOf(bio.get());
            if (size_t newline = find(printed, '\n'); newline != notFound)
                printed = printed.first(newline + 1);
            size_t colon = find(printed, ':');
            if (colon == notFound)
                return raiseValueError(globalObject, scope, "Invalid value "_s, decodeUTF8Lenient(printed.first(std::min<size_t>(printed.size(), 200))));
            JSValue kind = strFromUTF8(globalObject, printed.first(colon));
            RETURN_IF_EXCEPTION(scope, {});
            JSValue value = strFromUTF8(globalObject, printed.subspan(colon + 1));
            RETURN_IF_EXCEPTION(scope, {});
            item = PyTuple::create(globalObject, { kind, value });
            break;
        }
        }
        if (!item)
            return {};
        listAppend(globalObject, result, item);
    }
    RELEASE_AND_RETURN(scope, tupleFromList(globalObject, result));
}

// The URIs of authority information access of one kind. None: there are none.
static JSValue authorityInformation(JSGlobalObject* globalObject, X509* certificate, int nid)
{
    bssl::UniquePtr<AUTHORITY_INFO_ACCESS> info(static_cast<AUTHORITY_INFO_ACCESS*>(X509_get_ext_d2i(certificate, NID_info_access, nullptr, nullptr)));
    if (!info)
        return jsUndefined();
    JSArray* result = newList(globalObject);
    for (size_t i = 0; i < sk_ACCESS_DESCRIPTION_num(info.get()); ++i) {
        const ACCESS_DESCRIPTION* description = sk_ACCESS_DESCRIPTION_value(info.get(), i);
        if (OBJ_obj2nid(description->method) != nid || description->location->type != GEN_URI)
            continue;
        JSValue uri = strFromUTF8(globalObject, spanOf(description->location->d.uniformResourceIdentifier));
        if (!uri)
            return {};
        listAppend(globalObject, result, uri);
    }
    return listLength(result) ? JSValue(tupleFromList(globalObject, result)) : jsUndefined();
}

static JSValue distributionPoints(JSGlobalObject* globalObject, X509* certificate)
{
    bssl::UniquePtr<CRL_DIST_POINTS> points(static_cast<CRL_DIST_POINTS*>(X509_get_ext_d2i(certificate, NID_crl_distribution_points, nullptr, nullptr)));
    if (!points)
        return jsUndefined();
    JSArray* result = newList(globalObject);
    for (size_t i = 0; i < sk_DIST_POINT_num(points.get()); ++i) {
        const DIST_POINT* point = sk_DIST_POINT_value(points.get(), i);
        // CVE-2019-5010. And the name may be relative to the issuer's, which is another member of the union.
        if (!point->distpoint || point->distpoint->type)
            continue;
        const GENERAL_NAMES* names = point->distpoint->name.fullname;
        for (size_t j = 0; j < sk_GENERAL_NAME_num(names); ++j) {
            const GENERAL_NAME* name = sk_GENERAL_NAME_value(names, j);
            if (name->type != GEN_URI)
                continue;
            JSValue uri = strFromUTF8(globalObject, spanOf(name->d.uniformResourceIdentifier));
            if (!uri)
                return {};
            listAppend(globalObject, result, uri);
        }
    }
    return listLength(result) ? JSValue(tupleFromList(globalObject, result)) : jsUndefined();
}

template<typename Print>
static JSValue printed(JSGlobalObject* globalObject, const Print& print)
{
    bssl::UniquePtr<BIO> bio(BIO_new(BIO_s_mem()));
    if (!bio)
        return raisePlainError(globalObject, "failed to allocate BIO"_s);
    print(bio.get());
    return strFromUTF8(globalObject, contentsOf(bio.get()));
}

// The dict that getpeercert() returns.
static JSValue decodeCertificate(JSGlobalObject* globalObject, X509* certificate)
{
    VM& vm = getVM(globalObject);
    PyDict* result = PyDict::create(globalObject);
    auto add = [&](ASCIILiteral key, JSValue value, bool unlessNone = false) {
        if (!value)
            return false;
        if (!unlessNone || !value.isUndefined())
            result->set(vm, internString(vm, key), value);
        return true;
    };
    if (!add("subject"_s, nameTuple(globalObject, X509_get_subject_name(certificate)))
        || !add("issuer"_s, nameTuple(globalObject, X509_get_issuer_name(certificate)))
        || !add("version"_s, jsNumber(static_cast<int32_t>(X509_get_version(certificate) + 1)))
        || !add("serialNumber"_s, printed(globalObject, [&](BIO* bio) { i2a_ASN1_INTEGER(bio, X509_get0_serialNumber(certificate)); }))
        || !add("notBefore"_s, printed(globalObject, [&](BIO* bio) { ASN1_TIME_print(bio, X509_get0_notBefore(certificate)); }))
        || !add("notAfter"_s, printed(globalObject, [&](BIO* bio) { ASN1_TIME_print(bio, X509_get0_notAfter(certificate)); }))
        || !add("subjectAltName"_s, subjectAltNames(globalObject, certificate), true)
        || !add("OCSP"_s, authorityInformation(globalObject, certificate, NID_ad_OCSP), true)
        || !add("caIssuers"_s, authorityInformation(globalObject, certificate, NID_ad_ca_issuers), true)
        || !add("crlDistributionPoints"_s, distributionPoints(globalObject, certificate), true))
        return {};
    return result;
}

static JSValue certificateToDER(JSGlobalObject* globalObject, X509* certificate)
{
    uint8_t* bytes = nullptr;
    int length = i2d_X509(certificate, &bytes);
    if (length < 0)
        return LIBRARY_ERROR(globalObject);
    JSValue result = bytesFrom(globalObject, { bytes, static_cast<size_t>(length) });
    OPENSSL_free(bytes);
    return result;
}

// ---- Certificate ----

static X509* x509Of(JSValue self) { return stateOf<Certificate>(self)->certificate.get(); }

static JSValue createCertificate(JSGlobalObject* globalObject, bssl::UniquePtr<X509>&& x509)
{
    auto state = makeUnique<Certificate>();
    state->certificate = WTF::move(x509);
    return createRecordWithState(globalObject, certificateType(globalObject), 0, WTF::move(state));
}

static JSArray* certificatesFrom(JSGlobalObject* globalObject, const STACK_OF(X509)* stack)
{
    JSArray* result = newList(globalObject);
    for (size_t i = 0; i < sk_X509_num(stack); ++i)
        listAppend(globalObject, result, createCertificate(globalObject, bssl::UpRef(sk_X509_value(stack, i))));
    return result;
}

static JSValue certificatePublicBytes(JSGlobalObject* globalObject, JSValue self, JSValue formatValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int format;
    if (failed(scope, intArgument(globalObject, formatValue, EncodingPEM, format)))
        return {};
    bssl::UniquePtr<BIO> bio(BIO_new(BIO_s_mem()));
    if (!bio)
        RELEASE_AND_RETURN(scope, raisePlainError(globalObject, "failed to allocate BIO"_s));
    int succeeded;
    switch (format) {
    case EncodingPEM:
        succeeded = PEM_write_bio_X509(bio.get(), x509Of(self));
        break;
    case EncodingPEMAux:
        succeeded = PEM_write_bio_X509_AUX(bio.get(), x509Of(self));
        break;
    case EncodingDER:
        succeeded = i2d_X509_bio(bio.get(), x509Of(self));
        break;
    default:
        return raiseValueError(globalObject, scope, "Unsupported format"_s);
    }
    if (succeeded != 1)
        RELEASE_AND_RETURN(scope, LIBRARY_ERROR(globalObject));
    if (format == EncodingDER)
        RELEASE_AND_RETURN(scope, bytesFrom(globalObject, contentsOf(bio.get())));
    RELEASE_AND_RETURN(scope, strFromUTF8(globalObject, contentsOf(bio.get())));
}

static JSValue certificateGetInfo(JSGlobalObject* globalObject, JSValue self) { return decodeCertificate(globalObject, x509Of(self)); }

static JSValue certificateRepr(JSGlobalObject* globalObject, JSValue self)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    bssl::UniquePtr<BIO> bio(BIO_new(BIO_s_mem()));
    if (!bio)
        return raiseMemoryError(globalObject, scope, "failed to allocate BIO"_s);
    if (X509_NAME_print_ex(bio.get(), X509_get_subject_name(x509Of(self)), 0, XN_FLAG_RFC2253) <= 0)
        RELEASE_AND_RETURN(scope, LIBRARY_ERROR(globalObject));
    JSValue subject = strFromUTF8(globalObject, contentsOf(bio.get()));
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, makeStr(vm, makeString("<_ssl.Certificate '"_s, asString(subject)->value(globalObject).data, "'>"_s)));
}

static JSValue certificateHash(JSGlobalObject* globalObject, JSValue self) { return makeInt(globalObject, static_cast<uint64_t>(X509_subject_name_hash(x509Of(self)))); }

template<bool isEqual>
static JSValue certificateCompare(JSGlobalObject* globalObject, JSValue self, JSValue other)
{
    if (typeOf(globalObject, other) != certificateType(globalObject))
        return runtime(globalObject).notImplemented();
    return jsBoolean(!X509_cmp(x509Of(self), x509Of(other)) == isEqual);
}

static JSValue neverOrdered(JSGlobalObject* globalObject, JSValue, JSValue) { return runtime(globalObject).notImplemented(); }

static constexpr NativeDef certificateMethods[] = {
    PY_SLOT("__repr__", certificateRepr, "($self, /)"),
    PY_SLOT("__hash__", certificateHash, "($self, /)"),
    PY_SLOT("__eq__", certificateCompare<true>, "($self, value, /)"),
    PY_SLOT("__ne__", certificateCompare<false>, "($self, value, /)"),
    PY_SLOT("__lt__", neverOrdered, "($self, value, /)"),
    PY_SLOT("__le__", neverOrdered, "($self, value, /)"),
    PY_SLOT("__gt__", neverOrdered, "($self, value, /)"),
    PY_SLOT("__ge__", neverOrdered, "($self, value, /)"),
    PY_METHOD("public_bytes", certificatePublicBytes, "($self, /, format=Encoding.PEM)"),
    PY_METHOD("get_info", certificateGetInfo, "($self, /)"),
};

static constexpr TypeDef certificateTypeDef { "_ssl.Certificate"_s, { TypeFlag::Immutable, TypeFlag::DisallowInstantiation }, certificateMethods, {}, {} };

static PyType* certificateType(JSGlobalObject* globalObject) { return runtime(globalObject).typeFor(certificateTypeDef); }

// ---- MemoryBIO ----

static MemoryBIO& memoryBIOOf(JSValue self) { return *stateOf<MemoryBIO>(self); }

static JSValue memoryBIONew(JSGlobalObject* globalObject, JSValue type, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (args.totalCount())
        return raiseTypeError(globalObject, scope, "MemoryBIO() takes no arguments"_s);
    auto state = makeUnique<MemoryBIO>();
    state->bio.reset(BIO_new(BIO_s_mem()));
    if (!state->bio)
        return raiseMemoryError(globalObject, scope, "failed to allocate BIO"_s);
    // That there is nothing to read does not mean that it is over, only that there is nothing yet.
    BIO_set_retry_read(state->bio.get());
    BIO_set_mem_eof_return(state->bio.get(), -1);
    RELEASE_AND_RETURN(scope, createRecordWithState(globalObject, PyType::from(type), 0, WTF::move(state)));
}

static JSValue memoryBIOPending(JSGlobalObject* globalObject, JSValue self) { return makeInt(globalObject, static_cast<uint64_t>(BIO_ctrl_pending(memoryBIOOf(self).bio.get()))); }
static JSValue memoryBIOEOF(JSGlobalObject*, JSValue self) { return jsBoolean(!BIO_ctrl_pending(memoryBIOOf(self).bio.get()) && memoryBIOOf(self).hasEOF); }

static JSValue memoryBIORead(JSGlobalObject* globalObject, JSValue self, JSValue size)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int length;
    if (failed(scope, intArgument(globalObject, size, -1, length)))
        return {};
    BIO* bio = memoryBIOOf(self).bio.get();
    int available = static_cast<int>(std::min<size_t>(BIO_ctrl_pending(bio), INT_MAX));
    if (length < 0 || length > available)
        length = available;
    PyBytes* result = newBytes(globalObject, length);
    if (!result || !length)
        return result;
    // As much as is asked for is there.
    if (BIO_read(bio, result->mutableData(), length) != length)
        RELEASE_AND_RETURN(scope, LIBRARY_ERROR(globalObject));
    return result;
}

static JSValue memoryBIOWrite(JSGlobalObject* globalObject, JSValue self, JSValue data)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder input(globalObject);
    if (!input.get(data))
        return {};
    if (input.buffer.length > INT_MAX)
        return raiseOverflowError(globalObject, scope, "string longer than "_s, INT_MAX, " bytes"_s);
    if (memoryBIOOf(self).hasEOF)
        RELEASE_AND_RETURN(scope, raisePlainError(globalObject, "cannot write() after write_eof()"_s));
    int written = BIO_write(memoryBIOOf(self).bio.get(), input.buffer.data, static_cast<int>(input.buffer.length));
    if (written < 0)
        RELEASE_AND_RETURN(scope, LIBRARY_ERROR(globalObject));
    return jsNumber(written);
}

static JSValue memoryBIOWriteEOF(JSGlobalObject*, JSValue self)
{
    MemoryBIO& state = memoryBIOOf(self);
    state.hasEOF = true;
    // From now on, nothing to read is the end.
    BIO_clear_retry_flags(state.bio.get());
    BIO_set_mem_eof_return(state.bio.get(), 0);
    return jsUndefined();
}

static constexpr NativeDef memoryBIOMethods[] = {
    PY_NEW(memoryBIONew, "($type, *args, **kwargs)"),
    PY_METHOD("read", memoryBIORead, "($self, size=-1, /)"),
    PY_METHOD("write", memoryBIOWrite, "($self, b, /)"),
    PY_METHOD("write_eof", memoryBIOWriteEOF, "($self, /)"),
};

static constexpr NativeGetSet memoryBIOGetSets[] = {
    { "pending"_s, memoryBIOPending },
    { "eof"_s, memoryBIOEOF },
};

static constexpr TypeDef memoryBIOTypeDef { "_ssl.MemoryBIO"_s, { TypeFlag::Immutable }, memoryBIOMethods, memoryBIOGetSets, {} };

static PyType* memoryBIOType(JSGlobalObject* globalObject) { return runtime(globalObject).typeFor(memoryBIOTypeDef); }

// ---- SSLSession ----

static SSL_SESSION* sessionOf(JSValue self) { return stateOf<Session>(self)->session.get(); }

static JSValue createSession(JSGlobalObject* globalObject, bssl::UniquePtr<SSL_SESSION>&& session, PyRecord* context)
{
    auto state = makeUnique<Session>();
    state->session = WTF::move(session);
    PyRecord* record = createRecordWithState(globalObject, sessionType(globalObject), SessionFieldCount, WTF::move(state));
    record->set(getVM(globalObject), SessionContext, context);
    return record;
}

template<bool isEqual>
static JSValue sessionCompare(JSGlobalObject* globalObject, JSValue self, JSValue other)
{
    if (typeOf(globalObject, other) != sessionType(globalObject))
        return runtime(globalObject).notImplemented();
    unsigned length, otherLength;
    const uint8_t* id = SSL_SESSION_get_id(sessionOf(self), &length);
    const uint8_t* otherID = SSL_SESSION_get_id(sessionOf(other), &otherLength);
    bool isSame = self == other || (length == otherLength && !memcmp(id, otherID, length));
    return jsBoolean(isSame == isEqual);
}

static JSValue sessionTime(JSGlobalObject* globalObject, JSValue self) { return makeInt(globalObject, SSL_SESSION_get_time(sessionOf(self))); }
static JSValue sessionTimeout(JSGlobalObject* globalObject, JSValue self) { return makeInt(globalObject, static_cast<uint64_t>(SSL_SESSION_get_timeout(sessionOf(self)))); }
static JSValue sessionTicketLifetimeHint(JSGlobalObject* globalObject, JSValue self) { return makeInt(globalObject, static_cast<uint64_t>(SSL_SESSION_get_ticket_lifetime_hint(sessionOf(self)))); }
static JSValue sessionHasTicket(JSGlobalObject*, JSValue self) { return jsBoolean(SSL_SESSION_has_ticket(sessionOf(self))); }
static JSValue sessionID(JSGlobalObject* globalObject, JSValue self)
{
    unsigned length;
    const uint8_t* id = SSL_SESSION_get_id(sessionOf(self), &length);
    return bytesFrom(globalObject, { id, length });
}

static constexpr NativeDef sessionMethods[] = {
    PY_SLOT("__eq__", sessionCompare<true>, "($self, value, /)"),
    PY_SLOT("__ne__", sessionCompare<false>, "($self, value, /)"),
    PY_SLOT("__lt__", neverOrdered, "($self, value, /)"),
    PY_SLOT("__le__", neverOrdered, "($self, value, /)"),
    PY_SLOT("__gt__", neverOrdered, "($self, value, /)"),
    PY_SLOT("__ge__", neverOrdered, "($self, value, /)"),
};

static constexpr NativeGetSet sessionGetSets[] = {
    { "has_ticket"_s, sessionHasTicket },
    { "id"_s, sessionID },
    { "ticket_lifetime_hint"_s, sessionTicketLifetimeHint },
    { "time"_s, sessionTime },
    { "timeout"_s, sessionTimeout },
};

static constexpr TypeDef sessionTypeDef { "_ssl.SSLSession"_s, { TypeFlag::Immutable, TypeFlag::DisallowInstantiation }, sessionMethods, sessionGetSets, {} };

static PyType* sessionType(JSGlobalObject* globalObject) { return runtime(globalObject).typeFor(sessionTypeDef); }

// ---- A socket, as the library sees it ----

#ifndef MSG_NOSIGNAL
#define MSG_NOSIGNAL 0
#endif

static bool shouldTryAgain(int error) { return error == EAGAIN || error == EWOULDBLOCK || error == EINTR; }

static int socketBIORead(BIO* bio, char* out, int length)
{
    auto& connection = *static_cast<Connection*>(BIO_get_data(bio));
    BIO_clear_retry_flags(bio);
    ssize_t count = recv(connection.descriptor, out, length, MSG_DONTWAIT);
    if (count < 0) {
        if (shouldTryAgain(errno))
            BIO_set_retry_read(bio);
        else
            connection.systemError = errno;
    }
    return static_cast<int>(count);
}

static int socketBIOWrite(BIO* bio, const char* in, int length)
{
    auto& connection = *static_cast<Connection*>(BIO_get_data(bio));
    BIO_clear_retry_flags(bio);
    ssize_t count = send(connection.descriptor, in, length, MSG_DONTWAIT | MSG_NOSIGNAL);
    if (count < 0) {
        if (shouldTryAgain(errno))
            BIO_set_retry_write(bio);
        else
            connection.systemError = errno;
    }
    return static_cast<int>(count);
}

static long socketBIOControl(BIO*, int command, long, void*) { return command == BIO_CTRL_FLUSH; }

static const BIO_METHOD* socketBIOMethod()
{
    static const BIO_METHOD* method = [] {
        BIO_METHOD* method = BIO_meth_new(BIO_get_new_index() | BIO_TYPE_SOURCE_SINK, "socket of Python");
        RELEASE_ASSERT(method);
        BIO_meth_set_read(method, socketBIORead);
        BIO_meth_set_write(method, socketBIOWrite);
        BIO_meth_set_ctrl(method, socketBIOControl);
        return method;
    }();
    return method;
}

// ---- What the library calls ----
//
// All of it with the GIL, from within a method of the connection, which is what keeps the record alive.

// What a callback written in Python is given for the connection: the SSLSocket or SSLObject. Empty: that is gone.
static JSValue publicObjectOf(PyRecord* connection)
{
    JSValue reference = connection->get(ConnectionOwner);
    if (!reference)
        reference = connection->get(ConnectionSocket);
    if (!reference)
        return connection;
    JSValue object = weakRefGet(reference);
    return isNone(object) ? JSValue() : object;
}

// A callback has raised. The library goes on; the method that called it raises the exception when it is back.
static void setExceptionAside(JSGlobalObject* globalObject, PyRecord* connection)
{
    VM& vm = getVM(globalObject);
    JSValue exception = takePendingException(globalObject);
    if (!exception)
        return;
    if (JSValue earlier = connection->get(ConnectionCallbackException); earlier && earlier != exception) {
        setAttr(globalObject, exception, internString(vm, "__context__"_s), earlier);
        takePendingException(globalObject);
    }
    connection->set(vm, ConnectionCallbackException, exception);
}

static JSValue takeExceptionSetAside(JSGlobalObject* globalObject, PyRecord* connection)
{
    JSValue exception = connection->get(ConnectionCallbackException);
    if (exception)
        connection->set(getVM(globalObject), ConnectionCallbackException, JSValue());
    return exception;
}

// Whether the method stops for it, the library having returned with this error. On a socket that blocks it goes on waiting, as
// the library itself would in CPython, and raises the exception at the end.
static bool stopsForExceptionSetAside(PyRecord* connection, PyRecord* socket, int error)
{
    if (!connection->get(ConnectionCallbackException)) [[likely]]
        return false;
    return (error != SSL_ERROR_WANT_READ && error != SSL_ERROR_WANT_WRITE) || !socket || socketTimeoutOf(socket) >= 0;
}

static void messageCallback(int isWrite, int version, int contentType, const void* buffer, size_t length, SSL* ssl, void*)
{
    PyRecord* connection = recordOf(ssl);
    JSValue callback = contextRecordOf(connection)->get(ContextMessageCallback);
    if (!callback)
        return;
    JSGlobalObject* globalObject = connection->realm();
    VM& vm = getVM(globalObject);
    std::span bytes { static_cast<const uint8_t*>(buffer), length };
    int messageType = -1;
    switch (contentType) {
    case SSL3_RT_CHANGE_CIPHER_SPEC:
        messageType = 0x0101; // It is no handshake message, and OpenSSL has made up a type for it.
        break;
    case SSL3_RT_ALERT:
        if (length > 1)
            messageType = bytes[1];
        break;
    case SSL3_RT_HANDSHAKE:
        if (length)
            messageType = bytes[0];
        break;
    case SSL3_RT_HEADER:
        if (length > 2) {
            version = bytes[1] << 8 | bytes[2];
            messageType = bytes[0];
        }
        break;
    }
    JSValue object = publicObjectOf(connection);
    if (!object)
        return;
    JSValue data = bytesFrom(globalObject, bytes);
    if (data)
        call(globalObject, callback, object, makeStr(vm, isWrite ? "write"_s : "read"_s), jsNumber(version), jsNumber(contentType), jsNumber(messageType), data);
    setExceptionAside(globalObject, connection);
}

static void keylogCallback(const SSL* ssl, const char* line)
{
    PyRecord* connection = recordOf(ssl);
    PyRecord* contextRecord = contextRecordOf(connection);
    FILE* file = contextOf(contextRecord).keylogFile;
    if (!file)
        return;
    if (fprintf(file, "%s\n", line) >= 0 && !fflush(file))
        return;
    JSGlobalObject* globalObject = connection->realm();
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    raiseOSError(globalObject, scope, errno, contextRecord->get(ContextKeylogFilename));
    scope.release();
    setExceptionAside(globalObject, connection);
}

static int serverNameCallback(SSL* ssl, int* alert, void*)
{
    PyRecord* connection = recordOf(ssl);
    // The context the connection has now, which need not be the one whose SSL_CTX led here.
    PyRecord* contextRecord = contextRecordOf(connection);
    JSValue callback = contextRecord->get(ContextSNICallback);
    if (!callback)
        return SSL_TLSEXT_ERR_OK;
    JSGlobalObject* globalObject = connection->realm();
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue object = publicObjectOf(connection);
    if (!object) {
        *alert = SSL_AD_INTERNAL_ERROR;
        return SSL_TLSEXT_ERR_ALERT_FATAL;
    }

    JSValue name = jsUndefined();
    if (const char* serverName = SSL_get_servername(ssl, TLSEXT_NAMETYPE_host_name)) {
        std::span bytes { byteCast<uint8_t>(serverName), strlen(serverName) };
        if (!charactersAreAllASCII(bytes)) {
            JSValue object = bytesFrom(globalObject, bytes);
            if (object)
                bytesDecode(globalObject, object, internString(vm, "ascii"_s), internString(vm, "strict"_s));
            String shown = object ? reprForMessage(globalObject, object) : String();
            scope.release();
            reportUnraisable(globalObject, makeString("Exception ignored in ssl servername callback while decoding name "_s, shown), jsUndefined());
            *alert = SSL_AD_INTERNAL_ERROR;
            return SSL_TLSEXT_ERR_ALERT_FATAL;
        }
        name = strFromASCII(vm, serverName);
    }

    JSValue result = call(globalObject, callback, object, name, contextRecord);
    if (scope.exception()) [[unlikely]] {
        JSValue exception = takePendingException(globalObject);
        String shown = reprForMessage(globalObject, callback);
        takePendingException(globalObject);
        throwPythonException(globalObject, scope, exception);
        scope.release();
        reportUnraisable(globalObject, makeString("Exception ignored in ssl servername callback while calling set SNI callback "_s, shown), jsUndefined());
        *alert = SSL_AD_HANDSHAKE_FAILURE;
        return SSL_TLSEXT_ERR_ALERT_FATAL;
    }
    if (isNone(result))
        return SSL_TLSEXT_ERR_OK;
    // An int is the alert to send. Anything else is a mistake.
    *alert = toCInt(globalObject, result);
    if (scope.exception()) [[unlikely]] {
        JSValue exception = takePendingException(globalObject);
        String shown = reprForMessage(globalObject, result);
        takePendingException(globalObject);
        throwPythonException(globalObject, scope, exception);
        scope.release();
        reportUnraisable(globalObject, makeString("Exception ignored in ssl servername callback while calling set SNI callback (result="_s, shown, ')'), jsUndefined());
        *alert = SSL_AD_INTERNAL_ERROR;
    }
    return SSL_TLSEXT_ERR_ALERT_FATAL;
}

static int selectALPNCallback(SSL* ssl, const uint8_t** out, uint8_t* outLength, const uint8_t* offered, unsigned offeredLength, void*)
{
    auto& ours = contextOf(contextRecordOf(recordOf(ssl))).alpnProtocols;
    if (ours.isEmpty() || !offeredLength)
        return SSL_TLSEXT_ERR_NOACK;
    // The first of ours that the client offers.
    if (SSL_select_next_proto(const_cast<uint8_t**>(out), outLength, ours.span().data(), ours.size(), offered, offeredLength) != OPENSSL_NPN_NEGOTIATED)
        return SSL_TLSEXT_ERR_NOACK;
    return SSL_TLSEXT_ERR_OK;
}

// shared_ciphers() wants to know what the client offered, which the library forgets.
static enum ssl_select_cert_result_t clientHelloCallback(const SSL_CLIENT_HELLO* hello)
{
    auto& ciphers = connectionOf(recordOf(hello->ssl)).ciphersOfClient;
    ciphers.shrink(0);
    for (size_t i = 0; i + 1 < hello->cipher_suites_len; i += 2)
        ciphers.append(static_cast<uint16_t>(hello->cipher_suites[i] << 8 | hello->cipher_suites[i + 1]));
    return ssl_select_cert_success;
}

// In TLS 1.3 the sessions that can be resumed come after the handshake, and this is the only way to get at them.
static int newSessionCallback(SSL* ssl, SSL_SESSION* session)
{
    if (SSL_is_server(ssl))
        return 0;
    connectionOf(recordOf(ssl)).newestSession.reset(session);
    return 1;
}

static int verifyCallback(X509_STORE_CTX* store, void*)
{
    int result = X509_verify_cert(store);
    if (result > 0) {
        // Keys that Bun trusts in no chain, whatever the roots say. CPython has such a list too.
        if (int error = us_x509_store_ctx_blocked_key_error(store); error != X509_V_OK) {
            X509_STORE_CTX_set_error(store, error == X509_V_ERR_CERT_REVOKED ? X509_V_ERR_CERT_REJECTED : error); // As CPython puts it.
            result = 0;
        }
    }
    auto* ssl = static_cast<SSL*>(X509_STORE_CTX_get_ex_data(store, SSL_get_ex_data_X509_STORE_CTX_idx()));
    connectionOf(recordOf(ssl)).verifiedChain.reset(X509_STORE_CTX_get1_chain(store));
    return result;
}

static void reportPSKFailure(JSGlobalObject* globalObject, ASCIILiteral side, JSValue callback)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue exception = takePendingException(globalObject);
    if (!exception)
        return;
    String shown = reprForMessage(globalObject, callback);
    takePendingException(globalObject);
    throwPythonException(globalObject, scope, exception);
    scope.release();
    reportUnraisable(globalObject, makeString("Exception ignored in ssl PSK "_s, side, " callback while calling callback "_s, shown), jsUndefined());
}

// The hint or the identity that the other side sent. Empty: it is not UTF-8, which is against the standard and ends the connection.
static JSValue textFromPeer(JSGlobalObject* globalObject, const char* text)
{
    if (!text || !*text)
        return jsUndefined();
    JSValue result = strFromUTF8(globalObject, { byteCast<uint8_t>(text), strlen(text) });
    if (!result)
        takePendingException(globalObject);
    return result;
}

static unsigned pskClientCallback(SSL* ssl, const char* hint, char* identity, unsigned maxIdentityLength, uint8_t* psk, unsigned maxPSKLength)
{
    PyRecord* connection = recordOf(ssl);
    JSValue callback = contextRecordOf(connection)->get(ContextPSKClientCallback);
    if (!callback)
        return 0;
    JSGlobalObject* globalObject = connection->realm();
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue hintText = textFromPeer(globalObject, hint);
    if (!hintText)
        return 0;
    auto fail = [&] {
        scope.release();
        reportPSKFailure(globalObject, "client"_s, callback);
        return 0u;
    };
    JSValue result = call(globalObject, callback, hintText);
    if (scope.exception()) [[unlikely]]
        return fail();
    // (identity: str or None, key: bytes)
    auto* pair = PyTuple::tryFrom(result);
    if (!pair) {
        raiseSystemError(globalObject, scope, "new style getargs format but argument is not a tuple"_s);
        return fail();
    }
    if (pair->length() != 2) {
        raiseTypeError(globalObject, scope, "function takes exactly 2 arguments ("_s, pair->length(), " given)"_s);
        return fail();
    }
    CText identityBytes;
    if (!isNone(pair->at(0))) {
        if (!isStr(pair->at(0))) {
            raiseTypeError(globalObject, scope, "argument 1 must be str or None, not "_s, typeNameOfArgument(globalObject, pair->at(0)));
            return fail();
        }
        String text = strValue(pair->at(0))->value(globalObject);
        auto encoded = tryEncodeUTF8(text);
        if (!encoded) {
            strEncode(globalObject, strValue(pair->at(0)), internString(vm, "utf-8"_s), internString(vm, "strict"_s));
            return fail();
        }
        identityBytes.assign(encoded->span());
    }
    BufferHolder key(globalObject);
    if (isStr(pair->at(1)) || !key.get(pair->at(1)) || !key.buffer.isReadOnly) {
        if (!scope.exception())
            raiseTypeError(globalObject, scope, "argument 2 must be read-only bytes-like object, not "_s, typeNameOfArgument(globalObject, pair->at(1)));
        return fail();
    }
    if (identityBytes.length() + 1 > maxIdentityLength || static_cast<uint64_t>(key.buffer.length) > maxPSKLength)
        return 0;
    memcpy(psk, key.buffer.data, key.buffer.length);
    memcpy(identity, identityBytes.data(), identityBytes.length());
    identity[identityBytes.length()] = 0;
    return static_cast<unsigned>(key.buffer.length);
}

static unsigned pskServerCallback(SSL* ssl, const char* identity, uint8_t* psk, unsigned maxPSKLength)
{
    PyRecord* connection = recordOf(ssl);
    JSValue callback = contextRecordOf(connection)->get(ContextPSKServerCallback);
    if (!callback)
        return 0;
    JSGlobalObject* globalObject = connection->realm();
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue identityText = textFromPeer(globalObject, identity);
    if (!identityText)
        return 0;
    JSValue result = call(globalObject, callback, identityText);
    auto* key = scope.exception() ? nullptr : PyBytes::tryFrom(result);
    if (!key) {
        if (!scope.exception())
            raiseTypeError(globalObject, scope, "expected bytes, "_s, typeName(globalObject, result), " found"_s);
        scope.release();
        reportPSKFailure(globalObject, "server"_s, callback);
        return 0;
    }
    if (key->length() > maxPSKLength)
        return 0;
    memcpy(psk, key->data(), key->length());
    return static_cast<unsigned>(key->length());
}

// ---- _SSLSocket ----

// The socket under the connection, or null if there is none. False: it has been closed, or is no more.
static bool getSocket(JSGlobalObject* globalObject, PyRecord* self, PyRecord*& socket, int line)
{
    socket = nullptr;
    // A call that a signal or a timeout ended may have left one.
    takeExceptionSetAside(globalObject, self);
    JSValue reference = self->get(ConnectionSocket);
    if (!reference)
        return true;
    JSValue value = weakRefGet(reference);
    int descriptor = -1;
    if (!isNone(value)) {
        socket = PyRecord::from(value);
        descriptor = socketDescriptor(socket);
    }
    connectionOf(self).descriptor = descriptor;
    if (descriptor >= 0)
        return true;
    socket = nullptr;
    raiseOwnError(globalObject, "Underlying socket connection gone"_s, line);
    return false;
}

enum class SocketState { IsNonBlocking,
    HasTimedOut,
    HasBeenClosed,
    IsReady,
    HasRaised };

// `timeout`: how long there is left, in nanoseconds. Negative: none, if the socket has a timeout at all.
static SocketState waitForSocket(JSGlobalObject* globalObject, PyRecord* socket, bool isWriting, int64_t timeout)
{
    if (!socket || !timeout)
        return SocketState::IsNonBlocking;
    if (timeout < 0 && socketTimeoutOf(socket) > 0)
        return SocketState::HasTimedOut;
    int descriptor = socketDescriptor(socket);
    if (descriptor < 0)
        return SocketState::HasBeenClosed;
    struct pollfd polled { descriptor, static_cast<short>(isWriting ? POLLOUT : POLLIN), 0 };
    WaitRequest request { WaitRequest::Kind::Poll };
    request.timeout = timeout < 0 ? -1 : timeout;
    request.descriptors = &polled;
    request.descriptorCount = 1;
    int ready = waitForEvents(globalObject, request);
    if (ready == waitRaised)
        return SocketState::HasRaised;
    // What is wrong with the descriptor, if poll() failed, the operation itself will tell.
    return ready ? SocketState::IsReady : SocketState::HasTimedOut;
}

class Deadline {
public:
    explicit Deadline(PyRecord* socket)
        : m_timeout(socket ? socketTimeoutOf(socket) : 0)
    {
        if (m_timeout > 0 && __builtin_add_overflow(monotonicNanoseconds(), m_timeout, &m_deadline))
            m_deadline = std::numeric_limits<int64_t>::max();
    }

    int64_t whole() const { return m_timeout; }
    int64_t remaining() const
    {
        if (m_timeout <= 0)
            return m_timeout;
        int64_t left = m_deadline - monotonicNanoseconds();
        return left > 0 ? left : -1;
    }

private:
    int64_t m_timeout;
    int64_t m_deadline { 0 };
};

static JSValue raiseEOF(JSGlobalObject* globalObject, PyRecord* self, int line)
{
    raiseWithCode(globalObject, self, derivedError(globalObject, EOFError), ErrorEOF, "EOF occurred in violation of protocol"_s, line, 0);
    return {};
}

static JSValue raiseTimeout(JSGlobalObject* globalObject, const String& text)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return raise(globalObject, scope, runtime(globalObject).TimeoutError(), text);
}

// An operation of the library on the connection has failed: `error` is what SSL_get_error() says.
static JSValue raiseConnectionError(JSGlobalObject* globalObject, PyRecord* self, int error, JSValue callbackException, int line)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    PyType* type = sslError(globalObject);
    String text;
    int number = ErrorNone;
    uint32_t code = ERR_peek_last_error();
    bool isVerification = ERR_GET_LIB(code) == ERR_LIB_SSL && ERR_GET_REASON(code) == SSL_R_CERTIFICATE_VERIFY_FAILED;
    auto raiseSystemError = [&](int systemError) {
        ERR_clear_error();
        raiseOSError(globalObject, scope, systemError);
        scope.release();
        chainException(globalObject, callbackException);
        return JSValue();
    };

    switch (error) {
    case SSL_ERROR_ZERO_RETURN:
        text = "TLS/SSL connection has been closed (EOF)"_s;
        type = derivedError(globalObject, ZeroReturnError);
        number = ErrorZeroReturn;
        break;
    case SSL_ERROR_WANT_READ:
        text = "The operation did not complete (read)"_s;
        type = derivedError(globalObject, WantReadError);
        number = ErrorWantRead;
        break;
    case SSL_ERROR_WANT_WRITE:
        text = "The operation did not complete (write)"_s;
        type = derivedError(globalObject, WantWriteError);
        number = ErrorWantWrite;
        break;
    case SSL_ERROR_WANT_X509_LOOKUP:
        text = "The operation did not complete (X509 lookup)"_s;
        number = ErrorWantX509Lookup;
        break;
    case SSL_ERROR_WANT_CONNECT:
        text = "The operation did not complete (connect)"_s;
        number = ErrorWantConnect;
        break;
    case SSL_ERROR_SYSCALL:
        if (!code) {
            if (int systemError = connectionOf(self).systemError)
                return raiseSystemError(systemError);
            text = "EOF occurred in violation of protocol"_s;
            type = derivedError(globalObject, EOFError);
            number = ErrorEOF;
            break;
        }
        if (ERR_GET_LIB(code) == ERR_LIB_SYS)
            return raiseSystemError(ERR_GET_REASON(code));
        if (isVerification)
            type = derivedError(globalObject, CertVerificationError);
        number = ErrorSyscall;
        break;
    case SSL_ERROR_SSL:
        if (ERR_GET_LIB(code) == ERR_LIB_SYS)
            return raiseSystemError(ERR_GET_REASON(code));
        if (!code)
            text = "A failure in the SSL library occurred"_s;
        if (isVerification)
            type = derivedError(globalObject, CertVerificationError);
        number = ErrorSSL;
        break;
    default:
        text = "Invalid error code"_s;
        number = ErrorInvalidErrorCode;
    }
    scope.release();
    raiseWithCode(globalObject, self, type, number, text, line, code);
    ERR_clear_error();
    chainException(globalObject, callbackException);
    return {};
}

static void connectionSetOwner(JSGlobalObject*, JSValue self, JSValue value);
static void connectionSetSession(JSGlobalObject*, JSValue self, JSValue value);

// What a connection has of its context that the library does not hand on by itself: when the connection is made, and again when it
// is given another context, which undoes it. False: an exception.
static bool applyContext(JSGlobalObject* globalObject, PyRecord* self)
{
    Connection& connection = connectionOf(self);
    Context& context = contextOf(contextRecordOf(self));
    for (auto& [kind, credential] : context.otherCredentials) {
        if (!SSL_add1_credential(connection.ssl.get(), credential.get())) {
            LIBRARY_ERROR(globalObject);
            return false;
        }
    }
    auto& ours = connection.isServer ? context.signatureAlgorithmsOfServers : context.signatureAlgorithmsOfClients;
    auto& theirs = connection.isServer ? context.signatureAlgorithmsOfClients : context.signatureAlgorithmsOfServers;
    if ((ours.isEmpty() || SSL_set_signing_algorithm_prefs(connection.ssl.get(), ours.span().data(), ours.size()))
        && (theirs.isEmpty() || SSL_set_verify_algorithm_prefs(connection.ssl.get(), theirs.span().data(), theirs.size())))
        return true;
    LIBRARY_ERROR(globalObject);
    return false;
}

// False: an exception.
static bool configureHostname(JSGlobalObject* globalObject, PyRecord* self, const CText& hostname)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // A name that starts with a dot would match the certificate of any subdomain.
    if (!hostname.length() || hostname.data()[0] == '.') {
        raiseValueError(globalObject, scope, "server_hostname cannot be an empty string or start with a leading dot."_s);
        return false;
    }
    SSL* ssl = connectionOf(self).ssl.get();
    bssl::UniquePtr<ASN1_OCTET_STRING> address(a2i_IPADDRESS(hostname.data()));
    if (!address)
        ERR_clear_error();
    self->set(vm, ConnectionServerHostname, strFromASCII(vm, hostname.data()));
    // There is no SNI for addresses.
    if (!address && !SSL_set_tlsext_host_name(ssl, hostname.data())) {
        LIBRARY_ERROR(globalObject);
        return false;
    }
    if (!contextOf(contextRecordOf(self)).checksHostname)
        return true;
    X509_VERIFY_PARAM* parameters = SSL_get0_param(ssl);
    int succeeded = address ? X509_VERIFY_PARAM_set1_ip(parameters, ASN1_STRING_get0_data(address.get()), ASN1_STRING_length(address.get())) : X509_VERIFY_PARAM_set1_host(parameters, hostname.data(), hostname.length());
    if (!succeeded) {
        LIBRARY_ERROR(globalObject);
        return false;
    }
    return true;
}

// Over a socket, or else over two MemoryBIOs.
static JSValue createConnection(JSGlobalObject* globalObject, PyRecord* contextRecord, PyRecord* socket, bool isServer, JSValue hostnameValue, JSValue owner, JSValue session, PyRecord* incoming, PyRecord* outgoing)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Context& context = contextOf(contextRecord);

    // An A-label, without a NUL in it.
    CText hostname;
    bool hasHostname = hostnameValue && !isNone(hostnameValue);
    if (hasHostname) {
        if (!isStr(hostnameValue))
            return raiseTypeError(globalObject, scope, "argument must be str, not "_s, typeNameOfArgument(globalObject, hostnameValue));
        JSValue encoded = strEncode(globalObject, strValue(hostnameValue), internString(vm, "ascii"_s), internString(vm, "strict"_s));
        RETURN_IF_EXCEPTION(scope, {});
        auto bytes = PyBytes::from(encoded)->span();
        if (WTF::contains(bytes, static_cast<uint8_t>(0)))
            return raiseTypeError(globalObject, scope, "argument must be encoded string without null bytes, not str"_s);
        hostname.assign(bytes);
    }

    if (isServer && context.protocol == ProtocolTLSClient)
        RELEASE_AND_RETURN(scope, OWN_ERROR(globalObject, "Cannot create a server socket with a PROTOCOL_TLS_CLIENT context"));
    if (!isServer && context.protocol == ProtocolTLSServer)
        RELEASE_AND_RETURN(scope, OWN_ERROR(globalObject, "Cannot create a client socket with a PROTOCOL_TLS_SERVER context"));

    ERR_clear_error();
    auto state = makeUnique<Connection>();
    state->ssl.reset(SSL_new(context.ctx.get()));
    if (!state->ssl)
        RELEASE_AND_RETURN(scope, LIBRARY_ERROR(globalObject));
    state->isServer = isServer;
    SSL* ssl = state->ssl.get();
    Connection* connection = state.get();
    // About what a connection holds on to once it has buffers.
    PyRecord* self = createRecordWithState(globalObject, connectionType(globalObject), ConnectionFieldCount, WTF::move(state), 40 * KB);
    self->set(vm, ConnectionContext, contextRecord);
    SSL_set_app_data(ssl, self);

    if (isServer) {
        static constexpr uint8_t sessionIDContext[] = "Python";
        SSL_set_session_id_context(ssl, sessionIDContext, sizeof(sessionIDContext));
    }
    X509_VERIFY_PARAM_set_hostflags(SSL_get0_param(ssl), context.hostFlags);

    if (socket) {
        BIO* bio = BIO_new(socketBIOMethod());
        if (!bio)
            RELEASE_AND_RETURN(scope, LIBRARY_ERROR(globalObject));
        BIO_set_data(bio, connection);
        BIO_set_init(bio, 1);
        SSL_set_bio(ssl, bio, bio);
        connection->descriptor = socketDescriptor(socket);
        PyWeakRef* reference = makeWeakRef(globalObject, socket);
        RETURN_IF_EXCEPTION(scope, {});
        self->set(vm, ConnectionSocket, reference);
    } else {
        BIO* in = memoryBIOOf(incoming).bio.get();
        BIO* out = memoryBIOOf(outgoing).bio.get();
        // It takes a reference of ours to each, or one if they are one.
        BIO_up_ref(in);
        if (out != in)
            BIO_up_ref(out);
        SSL_set_bio(ssl, in, out);
    }
    SSL_set_mode(ssl, SSL_MODE_ACCEPT_MOVING_WRITE_BUFFER | SSL_MODE_AUTO_RETRY);
    if (!applyContext(globalObject, self))
        return {};

    if (hasHostname && !configureHostname(globalObject, self, hostname))
        return {};

    if (isServer)
        SSL_set_accept_state(ssl);
    else
        SSL_set_connect_state(ssl);

    if (owner && !isNone(owner)) {
        connectionSetOwner(globalObject, self, owner);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (session && !isNone(session)) {
        connectionSetSession(globalObject, self, session);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return self;
}

// What the library does not count: see session_stats().
static void countHandshake(PyRecord* self, bool isOver)
{
    Connection& connection = connectionOf(self);
    Context& context = contextOf(contextRecordOf(self));
    if (!connection.hasStartedHandshake) {
        connection.hasStartedHandshake = true;
        ++(connection.isServer ? context.accepts : context.connects);
    }
    if (!isOver || connection.hasCountedHandshake)
        return;
    connection.hasCountedHandshake = true;
    ++(connection.isServer ? context.goodAccepts : context.goodConnects);
    if (connection.isServer && SSL_session_reused(connection.ssl.get()))
        ++context.hits;
}

static JSValue connectionDoHandshake(JSGlobalObject* globalObject, JSValue selfValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    PyRecord* self = PyRecord::from(selfValue);
    Connection& connection = connectionOf(self);
    SSL* ssl = connection.ssl.get();
    PyRecord* socket;
    if (failed(scope, getSocket(globalObject, self, socket, __LINE__)))
        return {};
    if (connection.hasSeenEOF)
        RELEASE_AND_RETURN(scope, raiseEOF(globalObject, self, __LINE__));
    Deadline deadline(socket);
    countHandshake(self, false);

    int result, error;
    while (true) {
        connection.systemError = 0;
        result = SSL_do_handshake(ssl);
        error = result < 1 ? SSL_get_error(ssl, result) : SSL_ERROR_NONE;
        if (stopsForExceptionSetAside(self, socket, error))
            break;
        if (!checkSignals(globalObject))
            return {};
        if (error != SSL_ERROR_WANT_READ && error != SSL_ERROR_WANT_WRITE)
            break;
        SocketState state = waitForSocket(globalObject, socket, error == SSL_ERROR_WANT_WRITE, deadline.remaining());
        if (state == SocketState::HasRaised)
            return {};
        if (state == SocketState::HasTimedOut)
            RELEASE_AND_RETURN(scope, raiseTimeout(globalObject, TEXT_WITH_LINE("The handshake operation timed out")));
        if (state == SocketState::HasBeenClosed)
            RELEASE_AND_RETURN(scope, raisePlainError(globalObject, TEXT_WITH_LINE("Underlying socket has been closed.")));
        if (state == SocketState::IsNonBlocking)
            break;
        connection.descriptor = socketDescriptor(socket);
    }
    JSValue exception = takeExceptionSetAside(globalObject, self);
    if (result < 1)
        RELEASE_AND_RETURN(scope, raiseConnectionError(globalObject, self, error, exception, __LINE__));
    countHandshake(self, true);
    if (exception) {
        chainException(globalObject, exception);
        return {};
    }
    return jsUndefined();
}

static JSValue connectionWrite(JSGlobalObject* globalObject, JSValue selfValue, JSValue data)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    PyRecord* self = PyRecord::from(selfValue);
    Connection& connection = connectionOf(self);
    SSL* ssl = connection.ssl.get();
    IOBuffer input;
    if (!input.acquire(globalObject, data))
        return {};
    PyRecord* socket;
    if (failed(scope, getSocket(globalObject, self, socket, __LINE__)))
        return {};
    if (connection.hasSeenEOF)
        RELEASE_AND_RETURN(scope, raiseEOF(globalObject, self, __LINE__));
    Deadline deadline(socket);

    auto check = [&](SocketState state) {
        if (state == SocketState::HasTimedOut)
            raiseTimeout(globalObject, "The write operation timed out"_s);
        else if (state == SocketState::HasBeenClosed)
            raisePlainError(globalObject, "Underlying socket has been closed."_s);
        else
            return state != SocketState::HasRaised;
        return false;
    };
    // A socket that blocks is waited for where the library says that it has to wait.
    if (deadline.whole() > 0 && !check(waitForSocket(globalObject, socket, true, deadline.whole())))
        return {};

    int result, error;
    while (true) {
        if (!input.refresh())
            return {};
        if (!input.size())
            return jsNumber(0);
        connection.systemError = 0;
        connection.descriptor = socket ? socketDescriptor(socket) : -1;
        result = SSL_write(ssl, input.data(), static_cast<int>(std::min<size_t>(input.size(), INT_MAX)));
        error = result <= 0 ? SSL_get_error(ssl, result) : SSL_ERROR_NONE;
        if (stopsForExceptionSetAside(self, socket, error))
            break;
        if (!checkSignals(globalObject))
            return {};
        if (error != SSL_ERROR_WANT_READ && error != SSL_ERROR_WANT_WRITE)
            break;
        SocketState state = waitForSocket(globalObject, socket, error == SSL_ERROR_WANT_WRITE, deadline.remaining());
        if (!check(state))
            return {};
        if (state == SocketState::IsNonBlocking)
            break;
    }
    JSValue exception = takeExceptionSetAside(globalObject, self);
    if (result <= 0)
        RELEASE_AND_RETURN(scope, raiseConnectionError(globalObject, self, error, exception, __LINE__));
    if (exception) {
        chainException(globalObject, exception);
        return {};
    }
    return jsNumber(result);
}

static JSValue connectionPending(JSGlobalObject*, JSValue self) { return jsNumber(SSL_pending(connectionOf(self).ssl.get())); }

// read(size[, buffer])
static JSValue connectionRead(JSGlobalObject* globalObject, JSValue selfValue, const CallArgs& args)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    PyRecord* self = PyRecord::from(selfValue);
    Connection& connection = connectionOf(self);
    SSL* ssl = connection.ssl.get();

    if (args.hasKeywords())
        return raiseTypeError(globalObject, scope, "read() takes no keyword arguments"_s);
    if (args.size() < 1 || args.size() > 2)
        return raiseTypeError(globalObject, scope, "_ssl._SSLSocket.read requires 1 to 2 arguments"_s);
    int64_t length;
    if (failed(scope, ssizeArgument(globalObject, args[0], length)))
        return {};
    bool hasBuffer = args.size() == 2;
    IOBuffer output;
    if (hasBuffer && failed(scope, output.acquireWritable(globalObject, "read"_s, args[1], "argument 2"_s)))
        return {};
    if (!hasBuffer && length < 0)
        return raiseValueError(globalObject, scope, "size should not be negative"_s);

    PyRecord* socket;
    if (failed(scope, getSocket(globalObject, self, socket, __LINE__)))
        return {};
    if (connection.hasSeenEOF)
        RELEASE_AND_RETURN(scope, raiseEOF(globalObject, self, __LINE__));

    // One call gives what is left of one record, which has no more than this.
    constexpr int64_t mostAtOnce = SSL3_RT_MAX_PLAIN_LENGTH;
    Vector<uint8_t, 0> memory;
    if (hasBuffer) {
        if (length <= 0 || static_cast<uint64_t>(length) > output.size()) {
            if (output.size() > INT_MAX)
                return raiseOverflowError(globalObject, scope, "maximum length can't fit in a C 'int'"_s);
            length = output.size();
        }
        if (!length)
            return jsNumber(0);
    } else {
        if (!length)
            RELEASE_AND_RETURN(scope, runtime(globalObject).emptyBytes());
        length = std::min(length, mostAtOnce);
        if (!memory.tryGrow(length))
            return raiseMemoryError(globalObject, scope, String());
    }
    length = std::min<int64_t>(length, INT_MAX);

    Deadline deadline(socket);
    int result, error;
    while (true) {
        if (!output.refresh())
            return {};
        connection.systemError = 0;
        connection.descriptor = socket ? socketDescriptor(socket) : -1;
        result = SSL_read(ssl, hasBuffer ? output.mutableData() : memory.mutableSpan().data(), static_cast<int>(length));
        error = result <= 0 ? SSL_get_error(ssl, result) : SSL_ERROR_NONE;
        if (stopsForExceptionSetAside(self, socket, error))
            break;
        if (!checkSignals(globalObject))
            return {};
        if (error == SSL_ERROR_ZERO_RETURN && SSL_get_shutdown(ssl) == SSL_RECEIVED_SHUTDOWN) {
            // The other side has closed the connection as it should.
            result = 0;
            error = SSL_ERROR_NONE;
            break;
        }
        if (error != SSL_ERROR_WANT_READ && error != SSL_ERROR_WANT_WRITE)
            break;
        SocketState state = waitForSocket(globalObject, socket, error == SSL_ERROR_WANT_WRITE, deadline.remaining());
        if (state == SocketState::HasRaised)
            return {};
        if (state == SocketState::HasTimedOut)
            RELEASE_AND_RETURN(scope, raiseTimeout(globalObject, "The read operation timed out"_s));
        if (state == SocketState::IsNonBlocking || state == SocketState::HasBeenClosed)
            break;
    }
    JSValue exception = takeExceptionSetAside(globalObject, self);
    if (error != SSL_ERROR_NONE)
        RELEASE_AND_RETURN(scope, raiseConnectionError(globalObject, self, error, exception, __LINE__));
    if (exception) {
        scope.release();
        chainException(globalObject, exception);
        return {};
    }
    if (hasBuffer)
        return jsNumber(result);
    RELEASE_AND_RETURN(scope, bytesFrom(globalObject, memory.span().first(result)));
}

static JSValue connectionShutdown(JSGlobalObject* globalObject, JSValue selfValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    PyRecord* self = PyRecord::from(selfValue);
    Connection& connection = connectionOf(self);
    SSL* ssl = connection.ssl.get();
    PyRecord* socket;
    if (failed(scope, getSocket(globalObject, self, socket, __LINE__)))
        return {};
    Deadline deadline(socket);

    int result, error = SSL_ERROR_NONE;
    unsigned zeros = 0;
    while (true) {
        connection.systemError = 0;
        connection.descriptor = socket ? socketDescriptor(socket) : -1;
        result = SSL_shutdown(ssl);
        error = result < 0 ? SSL_get_error(ssl, result) : SSL_ERROR_NONE;
        if (result > 0 || stopsForExceptionSetAside(self, socket, error))
            break;
        if (!result) {
            // Ours has been sent. Now for theirs, once.
            if (++zeros > 1)
                break;
            connection.hasSeenZeroFromShutdown = true;
            continue;
        }
        if (error != SSL_ERROR_WANT_READ && error != SSL_ERROR_WANT_WRITE)
            break;
        SocketState state = waitForSocket(globalObject, socket, error == SSL_ERROR_WANT_WRITE, deadline.remaining());
        if (state == SocketState::HasRaised)
            return {};
        if (state == SocketState::HasTimedOut)
            RELEASE_AND_RETURN(scope, raiseTimeout(globalObject, error == SSL_ERROR_WANT_READ ? "The read operation timed out"_s : "The write operation timed out"_s));
        if (state != SocketState::IsReady)
            break;
    }
    JSValue exception = takeExceptionSetAside(globalObject, self);
    if (result < 0)
        RELEASE_AND_RETURN(scope, raiseConnectionError(globalObject, self, error, exception, __LINE__));
    if (exception) {
        chainException(globalObject, exception);
        return {};
    }
    return socket ? JSValue(socket) : jsUndefined();
}

static JSValue connectionGetPeerCert(JSGlobalObject* globalObject, JSValue self, JSValue binary)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool isBinary;
    if (failed(scope, boolArgument(globalObject, binary, false, isBinary)))
        return {};
    SSL* ssl = connectionOf(self).ssl.get();
    if (!SSL_is_init_finished(ssl))
        return raiseValueError(globalObject, scope, "handshake not done yet"_s);
    bssl::UniquePtr<X509> certificate(SSL_get_peer_certificate(ssl));
    if (!certificate)
        return jsUndefined();
    scope.release();
    if (isBinary)
        RELEASE_AND_RETURN(scope, certificateToDER(globalObject, certificate.get()));
    // What has not been verified is not worth telling.
    if (!(SSL_CTX_get_verify_mode(SSL_get_SSL_CTX(ssl)) & SSL_VERIFY_PEER))
        RELEASE_AND_RETURN(scope, PyDict::create(globalObject));
    RELEASE_AND_RETURN(scope, decodeCertificate(globalObject, certificate.get()));
}

static JSValue connectionGetVerifiedChain(JSGlobalObject* globalObject, JSValue self)
{
    auto& chain = connectionOf(self).verifiedChain;
    return chain ? JSValue(certificatesFrom(globalObject, chain.get())) : jsUndefined();
}

static JSValue connectionGetUnverifiedChain(JSGlobalObject* globalObject, JSValue self)
{
    Connection& connection = connectionOf(self);
    // As the other side sent it.
    const STACK_OF(X509)* chain = SSL_get_peer_full_cert_chain(connection.ssl.get());
    if (!chain || !sk_X509_num(chain))
        return jsUndefined();
    return certificatesFrom(globalObject, chain);
}

// The first version of the protocol that has the cipher. (SSL_CIPHER_get_version() says the same of all of them.)
static JSValue cipherVersion(VM& vm, const SSL_CIPHER* cipher)
{
    switch (SSL_CIPHER_get_min_version(cipher)) {
    case TLS1_3_VERSION:
        return makeStr(vm, "TLSv1.3"_s);
    case TLS1_2_VERSION:
        return makeStr(vm, "TLSv1.2"_s);
    default:
        return makeStr(vm, "SSLv3"_s);
    }
}

static JSValue cipherTuple(JSGlobalObject* globalObject, const SSL_CIPHER* cipher)
{
    VM& vm = getVM(globalObject);
    return PyTuple::create(globalObject, { strOrNone(vm, SSL_CIPHER_get_name(cipher)), cipherVersion(vm, cipher), jsNumber(SSL_CIPHER_get_bits(cipher, nullptr)) });
}

// The library's list has those of TLS 1.2 and before, which are what can be configured. Those of TLS 1.3 are always on.
template<typename Functor>
static void forEachCipher(SSL* ssl, const Functor& functor)
{
    for (uint16_t id : { 0x1301, 0x1302, 0x1303 }) {
        if (const SSL_CIPHER* cipher = SSL_get_cipher_by_value(id))
            functor(cipher);
    }
    const STACK_OF(SSL_CIPHER)* ciphers = SSL_get_ciphers(ssl);
    for (size_t i = 0; i < sk_SSL_CIPHER_num(ciphers); ++i)
        functor(sk_SSL_CIPHER_value(ciphers, i));
}

static JSValue connectionSharedCiphers(JSGlobalObject* globalObject, JSValue self)
{
    Connection& connection = connectionOf(self);
    if (connection.ciphersOfClient.isEmpty())
        return jsUndefined();
    JSArray* result = newList(globalObject);
    forEachCipher(connection.ssl.get(), [&](const SSL_CIPHER* cipher) {
        if (connection.ciphersOfClient.contains(SSL_CIPHER_get_protocol_id(cipher)))
            listAppend(globalObject, result, cipherTuple(globalObject, cipher));
    });
    return result;
}

static JSValue connectionCipher(JSGlobalObject* globalObject, JSValue self)
{
    const SSL_CIPHER* cipher = SSL_get_current_cipher(connectionOf(self).ssl.get());
    return cipher ? cipherTuple(globalObject, cipher) : jsUndefined();
}

static JSValue connectionGroup(JSGlobalObject* globalObject, JSValue self)
{
    uint16_t group = SSL_get_group_id(connectionOf(self).ssl.get());
    return group ? strOrNone(getVM(globalObject), SSL_get_group_name(group)) : jsUndefined();
}

template<bool ofServer>
static JSValue connectionSignatureAlgorithm(JSGlobalObject* globalObject, JSValue self)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Connection& connection = connectionOf(self);
    if (connection.isServer == ofServer)
        return raiseNotImplementedError(globalObject, scope, "BoringSSL only tells the signature algorithm of the other side."_s);
    uint16_t algorithm = SSL_get_peer_signature_algorithm(connection.ssl.get());
    return algorithm ? strOrNone(vm, SSL_get_signature_algorithm_name(algorithm, 1)) : jsUndefined();
}

static JSValue connectionVersion(JSGlobalObject* globalObject, JSValue self)
{
    SSL* ssl = connectionOf(self).ssl.get();
    if (!SSL_is_init_finished(ssl))
        return jsUndefined();
    const char* version = SSL_get_version(ssl);
    return strcmp(version, "unknown") ? JSValue(strFromASCII(getVM(globalObject), version)) : jsUndefined();
}

static JSValue connectionSelectedALPNProtocol(JSGlobalObject* globalObject, JSValue self)
{
    const uint8_t* protocol;
    unsigned length;
    SSL_get0_alpn_selected(connectionOf(self).ssl.get(), &protocol, &length);
    return protocol ? strFromUTF8(globalObject, { protocol, length }) : jsUndefined();
}

static JSValue connectionCompression(JSGlobalObject*, JSValue) { return jsUndefined(); }
static JSValue connectionUsesKTLS(JSGlobalObject*, JSValue) { return jsBoolean(false); }

static JSValue connectionGetChannelBinding(JSGlobalObject* globalObject, JSValue self, JSValue kindValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CText kind;
    if (kindValue && failed(scope, textArgument(globalObject, "get_channel_binding"_s, "cb_type"_s, kindValue, kind)))
        return {};
    if (kindValue && strcmp(kind.data(), "tls-unique"))
        return raiseValueError(globalObject, scope, '\'', String::fromUTF8(kind.span()), "' channel binding type not implemented"_s);
    Connection& connection = connectionOf(self);
    // The first Finished message of the handshake: the client's, or the server's if the session was resumed.
    uint8_t buffer[128];
    bool isOurs = !!SSL_session_reused(connection.ssl.get()) != !connection.isServer;
    size_t length = isOurs ? SSL_get_finished(connection.ssl.get(), buffer, sizeof(buffer)) : SSL_get_peer_finished(connection.ssl.get(), buffer, sizeof(buffer));
    RELEASE_AND_RETURN(scope, length ? bytesFrom(globalObject, { buffer, length }) : jsUndefined());
}

static JSValue connectionVerifyClientPostHandshake(JSGlobalObject* globalObject, JSValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return raiseNotImplementedError(globalObject, scope, "Post-handshake auth is not supported by your OpenSSL version."_s);
}

static JSValue connectionGetContext(JSGlobalObject*, JSValue self) { return PyRecord::from(self)->get(ConnectionContext); }

static void connectionSetContext(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!value)
        RELEASE_AND_RETURN(scope, raiseCannotDelete(globalObject));
    PyRecord* contextRecord = PyRecord::tryFrom(value, contextType(globalObject));
    if (!contextRecord) {
        raiseTypeError(globalObject, scope, "The value must be a SSLContext"_s);
        return;
    }
    if (value == PyRecord::from(self)->get(ConnectionContext))
        return;
    SSL* ssl = connectionOf(self).ssl.get();
    PyRecord::from(self)->set(vm, ConnectionContext, contextRecord);
    SSL_set_SSL_CTX(ssl, contextOf(contextRecord).ctx.get());
    SSL_set_msg_callback(ssl, contextRecord->get(ContextMessageCallback) ? messageCallback : nullptr);
    applyContext(globalObject, PyRecord::from(self));
}

static JSValue connectionGetServerSide(JSGlobalObject*, JSValue self) { return jsBoolean(connectionOf(self).isServer); }
static JSValue orNone(JSValue value) { return value ? value : jsUndefined(); }
static JSValue connectionGetServerHostname(JSGlobalObject*, JSValue self) { return orNone(PyRecord::from(self)->get(ConnectionServerHostname)); }
static JSValue connectionGetOwner(JSGlobalObject*, JSValue self)
{
    JSValue reference = PyRecord::from(self)->get(ConnectionOwner);
    return reference ? weakRefGet(reference) : jsUndefined();
}

static void connectionSetOwner(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    if (!value)
        return raiseCannotDelete(globalObject);
    if (PyWeakRef* reference = makeWeakRef(globalObject, value))
        PyRecord::from(self)->set(getVM(globalObject), ConnectionOwner, reference);
}

static JSValue connectionGetSession(JSGlobalObject* globalObject, JSValue self)
{
    Connection& connection = connectionOf(self);
    bssl::UniquePtr<SSL_SESSION> session = connection.newestSession ? bssl::UpRef(connection.newestSession) : bssl::UniquePtr<SSL_SESSION>(SSL_get1_session(connection.ssl.get()));
    if (!session)
        return jsUndefined();
    return createSession(globalObject, WTF::move(session), contextRecordOf(PyRecord::from(self)));
}

static void connectionSetSession(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!value)
        RELEASE_AND_RETURN(scope, raiseCannotDelete(globalObject));
    if (typeOf(globalObject, value) != sessionType(globalObject)) {
        raiseTypeError(globalObject, scope, "Value is not a SSLSession."_s);
        return;
    }
    Connection& connection = connectionOf(self);
    if (PyRecord::from(value)->get(SessionContext) != PyRecord::from(self)->get(ConnectionContext))
        raiseValueError(globalObject, scope, "Session refers to a different SSLContext."_s);
    else if (connection.isServer)
        raiseValueError(globalObject, scope, "Cannot set session for server-side SSLSocket."_s);
    else if (SSL_is_init_finished(connection.ssl.get()))
        raiseValueError(globalObject, scope, "Cannot set session after handshake."_s);
    else if (!SSL_set_session(connection.ssl.get(), sessionOf(value)))
        LIBRARY_ERROR(globalObject);
}

static JSValue connectionGetSessionReused(JSGlobalObject*, JSValue self) { return jsBoolean(SSL_session_reused(connectionOf(self).ssl.get())); }

static constexpr NativeDef connectionMethods[] = {
    PY_METHOD("do_handshake", connectionDoHandshake, "($self, /)"),
    PY_METHOD("uses_ktls_for_send", connectionUsesKTLS, "($self, /)"),
    PY_METHOD("uses_ktls_for_recv", connectionUsesKTLS, "($self, /)"),
    PY_METHOD("write", connectionWrite, "($self, b, /)"),
    PY_METHOD("read", connectionRead, "($self, *args, **kwargs)"),
    PY_METHOD("pending", connectionPending, "($self, /)"),
    PY_METHOD("getpeercert", connectionGetPeerCert, "($self, der=False, /)"),
    PY_METHOD("get_channel_binding", connectionGetChannelBinding, "($self, /, cb_type='tls-unique')"),
    PY_METHOD("cipher", connectionCipher, "($self, /)"),
    PY_METHOD("group", connectionGroup, "($self, /)"),
    PY_METHOD("client_sigalg", connectionSignatureAlgorithm<false>, "($self, /)"),
    PY_METHOD("server_sigalg", connectionSignatureAlgorithm<true>, "($self, /)"),
    PY_METHOD("shared_ciphers", connectionSharedCiphers, "($self, /)"),
    PY_METHOD("version", connectionVersion, "($self, /)"),
    PY_METHOD("selected_alpn_protocol", connectionSelectedALPNProtocol, "($self, /)"),
    PY_METHOD("compression", connectionCompression, "($self, /)"),
    PY_METHOD("shutdown", connectionShutdown, "($self, /)"),
    PY_METHOD("verify_client_post_handshake", connectionVerifyClientPostHandshake, "($self, /)"),
    PY_METHOD("get_unverified_chain", connectionGetUnverifiedChain, "($self, /)"),
    PY_METHOD("get_verified_chain", connectionGetVerifiedChain, "($self, /)"),
};

static constexpr NativeGetSet connectionGetSets[] = {
    { "context"_s, connectionGetContext, connectionSetContext },
    { "server_side"_s, connectionGetServerSide },
    { "server_hostname"_s, connectionGetServerHostname },
    { "owner"_s, connectionGetOwner, connectionSetOwner },
    { "session"_s, connectionGetSession, connectionSetSession },
    { "session_reused"_s, connectionGetSessionReused },
};

static constexpr TypeDef connectionTypeDef { "_ssl._SSLSocket"_s, { TypeFlag::Immutable, TypeFlag::DisallowInstantiation }, connectionMethods, connectionGetSets, {} };

static PyType* connectionType(JSGlobalObject* globalObject) { return runtime(globalObject).typeFor(connectionTypeDef); }

// ---- _SSLContext ----

static bool setVerifyMode(JSGlobalObject* globalObject, Context& context, int requirement)
{
    int mode;
    switch (requirement) {
    case CertNone:
        mode = SSL_VERIFY_NONE;
        break;
    case CertOptional:
        mode = SSL_VERIFY_PEER;
        break;
    case CertRequired:
        mode = SSL_VERIFY_PEER | SSL_VERIFY_FAIL_IF_NO_PEER_CERT;
        break;
    default: {
        VM& vm = getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        raiseValueError(globalObject, scope, "invalid value for verify_mode"_s);
        return false;
    }
    }
    SSL_CTX_set_verify(context.ctx.get(), mode, nullptr);
    return true;
}

static JSValue contextNew(JSGlobalObject* globalObject, JSValue type, JSValue protocolValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int protocol = toCInt(globalObject, protocolValue);
    RETURN_IF_EXCEPTION(scope, {});

    const SSL_METHOD* method = nullptr;
    ASCIILiteral deprecation;
    switch (protocol) {
    case ProtocolTLSv1:
        deprecation = "ssl.PROTOCOL_TLSv1 is deprecated"_s;
        method = TLSv1_method();
        break;
    case ProtocolTLSv1_1:
        deprecation = "ssl.PROTOCOL_TLSv1_1 is deprecated"_s;
        method = TLSv1_1_method();
        break;
    case ProtocolTLSv1_2:
        deprecation = "ssl.PROTOCOL_TLSv1_2 is deprecated"_s;
        method = TLSv1_2_method();
        break;
    case ProtocolTLS:
        deprecation = "ssl.PROTOCOL_TLS is deprecated"_s;
        method = TLS_method();
        break;
    case ProtocolTLSClient:
        method = TLS_client_method();
        break;
    case ProtocolTLSServer:
        method = TLS_server_method();
        break;
    }
    if (!method)
        return raiseValueError(globalObject, scope, "invalid or unsupported protocol version "_s, protocol);
    if (!deprecation.isNull() && !warnDeprecated(globalObject, deprecation))
        return {};

    auto state = makeUnique<Context>();
    state->ctx.reset(SSL_CTX_new(method));
    if (!state->ctx)
        RELEASE_AND_RETURN(scope, LIBRARY_ERROR(globalObject));
    SSL_CTX* ctx = state->ctx.get();
    state->protocol = protocol;
    state->checksHostname = protocol == ProtocolTLSClient;
    setVerifyMode(globalObject, *state, protocol == ProtocolTLSClient ? CertRequired : CertNone);
    SSL_CTX_set_cert_verify_callback(ctx, verifyCallback, nullptr);

    SSL_CTX_set_options(ctx, SSL_OP_ALL | SSL_OP_NO_SSLv2 | SSL_OP_NO_SSLv3 | SSL_OP_NO_COMPRESSION | SSL_OP_CIPHER_SERVER_PREFERENCE | SSL_OP_SINGLE_DH_USE | SSL_OP_SINGLE_ECDH_USE);
    if (!SSL_CTX_set_cipher_list(ctx, DEFAULT_CIPHERS)) {
        ERR_clear_error();
        RELEASE_AND_RETURN(scope, raisePlainError(globalObject, "No cipher can be selected."_s));
    }
    if (protocol == ProtocolTLS || protocol == ProtocolTLSClient || protocol == ProtocolTLSServer) {
        if (!SSL_CTX_set_min_proto_version(ctx, TLS1_2_VERSION))
            return raiseValueError(globalObject, scope, "Failed to set minimum protocol 0x303"_s);
        state->hasMinimumVersion = true;
    }
    SSL_CTX_set_mode(ctx, SSL_MODE_RELEASE_BUFFERS);

    X509_VERIFY_PARAM* parameters = SSL_CTX_get0_param(ctx);
    X509_VERIFY_PARAM_set_flags(parameters, verifyFlagTrustedFirst);
    state->hostFlags = X509_CHECK_FLAG_NO_PARTIAL_WILDCARDS;
    X509_VERIFY_PARAM_set_hostflags(parameters, state->hostFlags);

    SSL_CTX_set_select_certificate_cb(ctx, clientHelloCallback);
    // A client's sessions are not kept by the library in any case: they are handed to the callback.
    SSL_CTX_set_session_cache_mode(ctx, SSL_SESS_CACHE_BOTH);
    SSL_CTX_sess_set_new_cb(ctx, newSessionCallback);

    RELEASE_AND_RETURN(scope, createRecordWithState(globalObject, PyType::from(type), ContextFieldCount, WTF::move(state), 8 * KB));
}

static JSValue contextSetCiphers(JSGlobalObject* globalObject, JSValue self, JSValue list)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CText ciphers;
    if (failed(scope, textArgument(globalObject, "set_ciphers"_s, {}, list, ciphers)))
        return {};
    if (!SSL_CTX_set_cipher_list(contextOf(self).ctx.get(), ciphers.data())) {
        ERR_clear_error();
        RELEASE_AND_RETURN(scope, raisePlainError(globalObject, "No cipher can be selected."_s));
    }
    return jsUndefined();
}

static JSValue contextSetCiphersuites(JSGlobalObject* globalObject, JSValue, JSValue list)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CText ciphers;
    if (failed(scope, textArgument(globalObject, "set_ciphersuites"_s, {}, list, ciphers)))
        return {};
    return raiseNotImplementedError(globalObject, scope, "The cipher suites of TLS 1.3 cannot be configured in BoringSSL."_s);
}

static JSValue contextGetCiphers(JSGlobalObject* globalObject, JSValue self)
{
    VM& vm = getVM(globalObject);
    bssl::UniquePtr<SSL> ssl(SSL_new(contextOf(self).ctx.get()));
    if (!ssl)
        return LIBRARY_ERROR(globalObject);
    JSArray* result = newList(globalObject);
    forEachCipher(ssl.get(), [&](const SSL_CIPHER* cipher) {
        char description[512] = {};
        SSL_CIPHER_description(cipher, description, sizeof(description) - 1);
        if (size_t length = strlen(description); length > 1 && description[length - 1] == '\n')
            description[length - 1] = 0;
        int algorithmBits;
        int strengthBits = SSL_CIPHER_get_bits(cipher, &algorithmBits);
        auto nameOf = [&](int nid) { return nid != NID_undef ? strOrNone(vm, OBJ_nid2ln(nid)) : jsUndefined(); };
        PyDict* dict = PyDict::create(globalObject);
        auto add = [&](ASCIILiteral key, JSValue value) { dict->set(vm, internString(vm, key), value); };
        add("id"_s, jsNumber(SSL_CIPHER_get_id(cipher)));
        add("name"_s, strOrNone(vm, SSL_CIPHER_get_name(cipher)));
        add("protocol"_s, cipherVersion(vm, cipher));
        add("description"_s, strFromASCII(vm, description));
        add("strength_bits"_s, jsNumber(strengthBits));
        add("alg_bits"_s, jsNumber(algorithmBits));
        add("aead"_s, jsBoolean(SSL_CIPHER_is_aead(cipher)));
        add("symmetric"_s, nameOf(SSL_CIPHER_get_cipher_nid(cipher)));
        add("digest"_s, nameOf(SSL_CIPHER_get_digest_nid(cipher)));
        add("kea"_s, nameOf(SSL_CIPHER_get_kx_nid(cipher)));
        add("auth"_s, nameOf(SSL_CIPHER_get_auth_nid(cipher)));
        listAppend(globalObject, result, dict);
    });
    return result;
}

static JSValue contextSetGroups(JSGlobalObject* globalObject, JSValue self, JSValue list)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CText groups;
    if (failed(scope, textArgument(globalObject, "set_groups"_s, {}, list, groups)))
        return {};
    if (!SSL_CTX_set1_groups_list(contextOf(self).ctx.get(), groups.data()))
        RELEASE_AND_RETURN(scope, OWN_ERROR(globalObject, "unrecognized group"));
    return jsUndefined();
}

template<size_t (*getNames)(const char**, size_t)>
static JSValue listOfNames(JSGlobalObject* globalObject)
{
    VM& vm = getVM(globalObject);
    Vector<const char*> names(getNames(nullptr, 0));
    getNames(names.mutableSpan().data(), names.size());
    JSArray* result = newList(globalObject);
    for (const char* name : names)
        listAppend(globalObject, result, strFromASCII(vm, name));
    return result;
}

static JSValue contextGetGroups(JSGlobalObject* globalObject, JSValue, JSValue includeAliases)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // The library lists each group under all its names and does not say which is which.
    bool ignored;
    if (failed(scope, boolArgument(globalObject, includeAliases, false, ignored)))
        return {};
    RELEASE_AND_RETURN(scope, listOfNames<SSL_get_all_group_names>(globalObject));
}

// "rsa_pss_rsae_sha256:ECDSA+SHA384": the names of TLS 1.3, or a kind of key and a hash, as OpenSSL takes them. The library parses
// such lists too, but only to use them for both directions at once. False: there is something in it that is not known.
static bool parseSignatureAlgorithms(const CText& list, Vector<uint16_t>& result)
{
    static constexpr uint16_t known[] = {
        SSL_SIGN_RSA_PKCS1_SHA1, SSL_SIGN_RSA_PKCS1_SHA256, SSL_SIGN_RSA_PKCS1_SHA384, SSL_SIGN_RSA_PKCS1_SHA512,
        SSL_SIGN_ECDSA_SHA1, SSL_SIGN_ECDSA_SECP256R1_SHA256, SSL_SIGN_ECDSA_SECP384R1_SHA384, SSL_SIGN_ECDSA_SECP521R1_SHA512,
        SSL_SIGN_RSA_PSS_RSAE_SHA256, SSL_SIGN_RSA_PSS_RSAE_SHA384, SSL_SIGN_RSA_PSS_RSAE_SHA512, SSL_SIGN_ED25519
    };
    struct Pair {
        ASCIILiteral name;
        uint16_t algorithm;
    };
    static constexpr Pair pairs[] = {
        { "RSA+SHA1"_s, SSL_SIGN_RSA_PKCS1_SHA1 }, { "RSA+SHA256"_s, SSL_SIGN_RSA_PKCS1_SHA256 }, { "RSA+SHA384"_s, SSL_SIGN_RSA_PKCS1_SHA384 }, { "RSA+SHA512"_s, SSL_SIGN_RSA_PKCS1_SHA512 },
        { "ECDSA+SHA1"_s, SSL_SIGN_ECDSA_SHA1 }, { "ECDSA+SHA256"_s, SSL_SIGN_ECDSA_SECP256R1_SHA256 }, { "ECDSA+SHA384"_s, SSL_SIGN_ECDSA_SECP384R1_SHA384 }, { "ECDSA+SHA512"_s, SSL_SIGN_ECDSA_SECP521R1_SHA512 },
        { "RSA-PSS+SHA256"_s, SSL_SIGN_RSA_PSS_RSAE_SHA256 }, { "RSA-PSS+SHA384"_s, SSL_SIGN_RSA_PSS_RSAE_SHA384 }, { "RSA-PSS+SHA512"_s, SSL_SIGN_RSA_PSS_RSAE_SHA512 },
        { "PSS+SHA256"_s, SSL_SIGN_RSA_PSS_RSAE_SHA256 }, { "PSS+SHA384"_s, SSL_SIGN_RSA_PSS_RSAE_SHA384 }, { "PSS+SHA512"_s, SSL_SIGN_RSA_PSS_RSAE_SHA512 },
    };
    result.shrink(0);
    for (auto name : StringView::fromLatin1(list.data()).split(':')) {
        uint16_t found = 0;
        for (uint16_t algorithm : known) {
            if (name == StringView::fromLatin1(SSL_get_signature_algorithm_name(algorithm, 1)) || name == StringView::fromLatin1(SSL_get_signature_algorithm_name(algorithm, 0)))
                found = algorithm;
        }
        for (auto& pair : pairs) {
            if (name == pair.name)
                found = pair.algorithm;
        }
        if (!found)
            return false;
        if (!result.contains(found))
            result.append(found);
    }
    return !result.isEmpty();
}

template<bool ofServers>
static JSValue contextSetSigalgs(JSGlobalObject* globalObject, JSValue self, JSValue list)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CText algorithms;
    if (failed(scope, textArgument(globalObject, ofServers ? "set_server_sigalgs"_s : "set_client_sigalgs"_s, {}, list, algorithms)))
        return {};
    Vector<uint16_t> parsed;
    if (!parseSignatureAlgorithms(algorithms, parsed))
        RELEASE_AND_RETURN(scope, OWN_ERROR(globalObject, "unrecognized signature algorithm"));
    Context& context = contextOf(self);
    (ofServers ? context.signatureAlgorithmsOfServers : context.signatureAlgorithmsOfClients) = WTF::move(parsed);
    return jsUndefined();
}

static JSValue contextSetALPNProtocols(JSGlobalObject* globalObject, JSValue self, JSValue protocols)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BufferHolder input(globalObject);
    if (!input.get(protocols))
        return {};
    if (static_cast<uint64_t>(input.buffer.length) > UINT_MAX)
        return raiseOverflowError(globalObject, scope, "protocols longer than "_s, UINT_MAX, " bytes"_s);
    Context& context = contextOf(self);
    context.alpnProtocols = Vector<uint8_t>(input.buffer.span());
    // 0 is success.
    if (SSL_CTX_set_alpn_protos(context.ctx.get(), context.alpnProtocols.span().data(), context.alpnProtocols.size())) {
        ERR_clear_error();
        return raiseMemoryError(globalObject, scope, String());
    }
    SSL_CTX_set_alpn_select_cb(context.ctx.get(), selectALPNCallback, nullptr);
    return jsUndefined();
}

static JSValue contextGetVerifyMode(JSGlobalObject* globalObject, JSValue self)
{
    switch (SSL_CTX_get_verify_mode(contextOf(self).ctx.get()) & (SSL_VERIFY_PEER | SSL_VERIFY_FAIL_IF_NO_PEER_CERT)) {
    case SSL_VERIFY_NONE:
        return jsNumber(CertNone);
    case SSL_VERIFY_PEER:
        return jsNumber(CertOptional);
    case SSL_VERIFY_PEER | SSL_VERIFY_FAIL_IF_NO_PEER_CERT:
        return jsNumber(CertRequired);
    }
    return raisePlainError(globalObject, "invalid return value from SSL_CTX_get_verify_mode"_s);
}

static void contextSetVerifyMode(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!value)
        RELEASE_AND_RETURN(scope, raiseCannotDelete(globalObject));
    int mode = toCInt(globalObject, value);
    RETURN_IF_EXCEPTION(scope, void());
    Context& context = contextOf(self);
    if (mode == CertNone && context.checksHostname) {
        raiseValueError(globalObject, scope, "Cannot set verify_mode to CERT_NONE when check_hostname is enabled."_s);
        return;
    }
    setVerifyMode(globalObject, context, mode);
}

static JSValue contextGetVerifyFlags(JSGlobalObject* globalObject, JSValue self)
{
    return makeInt(globalObject, static_cast<uint64_t>(X509_VERIFY_PARAM_get_flags(SSL_CTX_get0_param(contextOf(self).ctx.get()))));
}

static void contextSetVerifyFlags(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!value)
        RELEASE_AND_RETURN(scope, raiseCannotDelete(globalObject));
    uint64_t wanted;
    if (failed(scope, unsignedArgument(globalObject, value, "unsigned long"_s, 0, wanted)))
        return;
    X509_VERIFY_PARAM* parameters = SSL_CTX_get0_param(contextOf(self).ctx.get());
    unsigned long flags = X509_VERIFY_PARAM_get_flags(parameters);
    if (unsigned long clear = flags & ~wanted; clear && !X509_VERIFY_PARAM_clear_flags(parameters, clear)) {
        LIBRARY_ERROR(globalObject);
        return;
    }
    if (unsigned long set = ~flags & wanted; set && !X509_VERIFY_PARAM_set_flags(parameters, set))
        LIBRARY_ERROR(globalObject);
}

template<bool isMaximum>
static JSValue contextGetVersion(JSGlobalObject*, JSValue self)
{
    Context& context = contextOf(self);
    if constexpr (isMaximum)
        return jsNumber(context.hasMaximumVersion ? SSL_CTX_get_max_proto_version(context.ctx.get()) : protoMaximumSupported);
    else
        return jsNumber(context.hasMinimumVersion ? SSL_CTX_get_min_proto_version(context.ctx.get()) : protoMinimumSupported);
}

template<bool isMaximum>
static void contextSetVersion(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!value)
        RELEASE_AND_RETURN(scope, raiseCannotDelete(globalObject));
    int version = toCInt(globalObject, value);
    RETURN_IF_EXCEPTION(scope, void());
    Context& context = contextOf(self);
    if (context.protocol != ProtocolTLS && context.protocol != ProtocolTLSClient && context.protocol != ProtocolTLSServer) {
        raiseValueError(globalObject, scope, "The context's protocol doesn't support modification of highest and lowest version."_s);
        return;
    }
    ASCIILiteral deprecation;
    switch (version) {
    case SSL3_VERSION:
        deprecation = "ssl.TLSVersion.SSLv3 is deprecated"_s;
        break;
    case TLS1_VERSION:
        deprecation = "ssl.TLSVersion.TLSv1 is deprecated"_s;
        break;
    case TLS1_1_VERSION:
        deprecation = "ssl.TLSVersion.TLSv1_1 is deprecated"_s;
        break;
    case protoMinimumSupported:
    case protoMaximumSupported:
    case TLS1_2_VERSION:
    case TLS1_3_VERSION:
        break;
    default:
        raiseValueError(globalObject, scope, "Unsupported TLS/SSL version 0x"_s, hex(static_cast<unsigned>(version), Lowercase));
        return;
    }
    if (!deprecation.isNull() && !warnDeprecated(globalObject, deprecation))
        return;

    // 0 is whatever the library's own limit is.
    bool isSet = true;
    if (version == (isMaximum ? protoMaximumSupported : protoMinimumSupported)) {
        version = 0;
        isSet = false;
    } else if (version == protoMaximumSupported)
        version = TLS1_3_VERSION;
    else if (version == protoMinimumSupported)
        version = TLS1_VERSION;
    int succeeded = isMaximum ? SSL_CTX_set_max_proto_version(context.ctx.get(), version) : SSL_CTX_set_min_proto_version(context.ctx.get(), version);
    if (!succeeded) {
        ERR_clear_error();
        raiseValueError(globalObject, scope, "Unsupported protocol version 0x"_s, hex(static_cast<unsigned>(version), Lowercase));
        return;
    }
    (isMaximum ? context.hasMaximumVersion : context.hasMinimumVersion) = isSet;
}

static JSValue contextGetNumTickets(JSGlobalObject* globalObject, JSValue self) { return makeInt(globalObject, static_cast<uint64_t>(SSL_CTX_get_num_tickets(contextOf(self).ctx.get()))); }

static void contextSetNumTickets(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!value)
        RELEASE_AND_RETURN(scope, raiseCannotDelete(globalObject));
    int64_t count = toInt64(globalObject, value);
    RETURN_IF_EXCEPTION(scope, void());
    Context& context = contextOf(self);
    if (count < 0)
        raiseValueError(globalObject, scope, "value must be non-negative"_s);
    else if (context.protocol != ProtocolTLSServer)
        raiseValueError(globalObject, scope, "SSLContext is not a server context."_s);
    else if (SSL_CTX_set_num_tickets(context.ctx.get(), count) != 1)
        raiseValueError(globalObject, scope, "failed to set num tickets."_s);
}

static JSValue contextGetSecurityLevel(JSGlobalObject*, JSValue self) { return jsNumber(SSL_CTX_get_security_level(contextOf(self).ctx.get())); }
static JSValue contextGetOptions(JSGlobalObject* globalObject, JSValue self) { return makeInt(globalObject, static_cast<uint64_t>(SSL_CTX_get_options(contextOf(self).ctx.get()))); }

static void contextSetOptions(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!value)
        RELEASE_AND_RETURN(scope, raiseCannotDelete(globalObject));
    JSValue index = toIndex(globalObject, value);
    RETURN_IF_EXCEPTION(scope, void());
    if (intSign(index) < 0) {
        raiseValueError(globalObject, scope, "value must be positive"_s);
        return;
    }
    auto wanted = tryUInt64(index);
    if (!wanted) {
        raiseOverflowError(globalObject, scope, "Python int too large to convert to C unsigned long long"_s);
        return;
    }
    SSL_CTX* ctx = contextOf(self).ctx.get();
    uint64_t options = SSL_CTX_get_options(ctx);
    uint64_t clear = options & ~*wanted;
    uint64_t set = ~options & *wanted;
    constexpr uint64_t versions = SSL_OP_NO_SSLv2 | SSL_OP_NO_SSLv3 | SSL_OP_NO_TLSv1 | SSL_OP_NO_TLSv1_1 | SSL_OP_NO_TLSv1_2 | SSL_OP_NO_TLSv1_3;
    if ((set & versions) && !warnDeprecated(globalObject, "ssl.OP_NO_SSL*/ssl.OP_NO_TLS* options are deprecated"_s))
        return;
    if (clear)
        SSL_CTX_clear_options(ctx, static_cast<uint32_t>(clear));
    if (set)
        SSL_CTX_set_options(ctx, static_cast<uint32_t>(set));
}

static JSValue contextGetHostFlags(JSGlobalObject* globalObject, JSValue self) { return makeInt(globalObject, static_cast<uint64_t>(contextOf(self).hostFlags)); }

static void contextSetHostFlags(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!value)
        RELEASE_AND_RETURN(scope, raiseCannotDelete(globalObject));
    uint32_t flags;
    if (failed(scope, bitwiseUnsignedArgument(globalObject, value, 0, flags)))
        return;
    Context& context = contextOf(self);
    context.hostFlags = flags;
    X509_VERIFY_PARAM_set_hostflags(SSL_CTX_get0_param(context.ctx.get()), flags);
}

static JSValue contextGetCheckHostname(JSGlobalObject*, JSValue self) { return jsBoolean(contextOf(self).checksHostname); }

static void contextSetCheckHostname(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!value)
        RELEASE_AND_RETURN(scope, raiseCannotDelete(globalObject));
    bool checks;
    if (failed(scope, boolArgument(globalObject, value, false, checks)))
        return;
    Context& context = contextOf(self);
    // There is nothing to check the name against in a certificate that is not verified.
    if (checks && SSL_CTX_get_verify_mode(context.ctx.get()) == SSL_VERIFY_NONE)
        setVerifyMode(globalObject, context, CertRequired);
    context.checksHostname = checks;
}

// The library has none. ssl.py takes None to mean that.
static JSValue contextGetPostHandshakeAuth(JSGlobalObject*, JSValue) { return jsUndefined(); }
static JSValue contextGetProtocol(JSGlobalObject*, JSValue self) { return jsNumber(contextOf(self).protocol); }

// What the library asks for the password of a private key with.
struct PasswordSource {
    JSGlobalObject* globalObject;
    JSValue callable;
    Vector<uint8_t> password;
    bool hasFailed { false };

    // From a str, bytes or a bytearray.
    bool set(JSValue value, ASCIILiteral complaint)
    {
        VM& vm = getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (isStr(value)) {
            JSValue encoded = strEncode(globalObject, strValue(value), internString(vm, "utf-8"_s), internString(vm, "strict"_s));
            RETURN_IF_EXCEPTION(scope, false);
            password = Vector<uint8_t>(PyBytes::from(encoded)->span());
        } else if (auto* bytes = PyBytes::tryFrom(value))
            password = Vector<uint8_t>(bytes->span());
        else if (auto* array = PyByteArray::tryFrom(value))
            password = Vector<uint8_t>(array->span());
        else {
            raiseTypeError(globalObject, scope, complaint);
            return false;
        }
        if (password.size() > INT_MAX) {
            raiseValueError(globalObject, scope, "password cannot be longer than "_s, INT_MAX, " bytes"_s);
            return false;
        }
        return true;
    }
};

static int passwordCallback(char* buffer, int size, int, void* data)
{
    auto& source = *static_cast<PasswordSource*>(data);
    JSGlobalObject* globalObject = source.globalObject;
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (source.hasFailed)
        return -1;
    source.hasFailed = true;
    if (source.callable) {
        JSValue result = call(globalObject, source.callable);
        RETURN_IF_EXCEPTION(scope, -1);
        if (!source.set(result, "password callback must return a string"_s))
            return -1;
    }
    if (source.password.size() > static_cast<size_t>(size)) {
        raiseValueError(globalObject, scope, "password cannot be longer than "_s, size, " bytes"_s);
        return -1;
    }
    source.hasFailed = false;
    memcpy(buffer, source.password.span().data(), source.password.size());
    return static_cast<int>(source.password.size());
}

// The certificate, its chain and its key that the library's context has. Null: it has none, or there is no memory.
static bssl::UniquePtr<SSL_CREDENTIAL> credentialOf(SSL_CTX* ctx)
{
    X509* leaf = SSL_CTX_get0_certificate(ctx);
    EVP_PKEY* key = SSL_CTX_get0_privatekey(ctx);
    if (!leaf || !key)
        return nullptr;
    Vector<bssl::UniquePtr<CRYPTO_BUFFER>> buffers;
    Vector<CRYPTO_BUFFER*> pointers;
    auto add = [&](X509* certificate) {
        uint8_t* bytes = nullptr;
        int length = i2d_X509(certificate, &bytes);
        if (length <= 0)
            return false;
        buffers.append(bssl::UniquePtr<CRYPTO_BUFFER>(CRYPTO_BUFFER_new(bytes, length, nullptr)));
        OPENSSL_free(bytes);
        pointers.append(buffers.last().get());
        return !!pointers.last();
    };
    if (!add(leaf))
        return nullptr;
    STACK_OF(X509)* chain = nullptr;
    SSL_CTX_get0_chain_certs(ctx, &chain);
    for (size_t i = 0; chain && i < sk_X509_num(chain); ++i) {
        if (!add(sk_X509_value(chain, i)))
            return nullptr;
    }
    bssl::UniquePtr<SSL_CREDENTIAL> credential(SSL_CREDENTIAL_new_x509());
    if (!credential || !SSL_CREDENTIAL_set1_cert_chain(credential.get(), pointers.span().data(), pointers.size()) || !SSL_CREDENTIAL_set1_private_key(credential.get(), key))
        return nullptr;
    return credential;
}

static JSValue contextLoadCertChain(JSGlobalObject* globalObject, JSValue self, JSValue certfile, JSValue keyfile, JSValue password)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    SSL_CTX* ctx = contextOf(self).ctx.get();
    CText certificatePath, keyPath;
    if (failed(scope, pathArgument(globalObject, certfile, "certfile should be a valid filesystem path"_s, certificatePath)))
        return {};
    JSValue keyPathObject = certfile;
    if (keyfile && !isNone(keyfile)) {
        if (failed(scope, pathArgument(globalObject, keyfile, "keyfile should be a valid filesystem path"_s, keyPath)))
            return {};
        keyPathObject = keyfile;
    } else
        keyPath = certificatePath;
    PasswordSource source { globalObject, {}, {} };
    if (password && !isNone(password)) {
        if (isCallable(globalObject, password))
            source.callable = password;
        else if (!source.set(password, "password should be a string or callable"_s))
            return {};
    }

    auto* previousCallback = SSL_CTX_get_default_passwd_cb(ctx);
    void* previousData = SSL_CTX_get_default_passwd_cb_userdata(ctx);
    SSL_CTX_set_default_passwd_cb(ctx, passwordCallback);
    SSL_CTX_set_default_passwd_cb_userdata(ctx, &source);
    auto restore = makeScopeExit([&] {
        SSL_CTX_set_default_passwd_cb(ctx, previousCallback);
        SSL_CTX_set_default_passwd_cb_userdata(ctx, previousData);
    });

    auto fail = [&](JSValue path, int line) -> JSValue {
        // The callback has said what is wrong.
        if (source.hasFailed) {
            ERR_clear_error();
            return {};
        }
        if (errno) {
            int error = errno;
            ERR_clear_error();
            return raiseOSError(globalObject, scope, error, path);
        }
        return raiseLibraryError(globalObject, line);
    };
    bssl::UniquePtr<SSL_CREDENTIAL> previous = credentialOf(ctx);
    int previousKind = previous ? EVP_PKEY_id(SSL_CTX_get0_privatekey(ctx)) : EVP_PKEY_NONE;
    ERR_clear_error();
    errno = 0;
    if (SSL_CTX_use_certificate_chain_file(ctx, certificatePath.data()) != 1)
        return fail(certfile, __LINE__);
    const EVP_PKEY* publicKey = X509_get0_pubkey(SSL_CTX_get0_certificate(ctx));
    int kind = publicKey ? EVP_PKEY_id(publicKey) : EVP_PKEY_NONE;
    auto& others = contextOf(self).otherCredentials;
    others.removeAllMatching([&](auto& other) { return other.first == kind || other.first == previousKind; });
    if (previous && previousKind != kind)
        others.append({ previousKind, WTF::move(previous) });

    errno = 0;
    if (SSL_CTX_use_PrivateKey_file(ctx, keyPath.data(), SSL_FILETYPE_PEM) != 1)
        return fail(keyPathObject, __LINE__);
    if (SSL_CTX_check_private_key(ctx) != 1)
        RELEASE_AND_RETURN(scope, LIBRARY_ERROR(globalObject));
    return jsUndefined();
}

// False: an exception.
static bool addCACertificates(JSGlobalObject* globalObject, SSL_CTX* ctx, std::span<const uint8_t> data, bool isPEM)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (data.empty()) {
        raiseValueError(globalObject, scope, "Empty certificate data"_s);
        return false;
    }
    if (data.size() > INT_MAX) {
        raiseOverflowError(globalObject, scope, "Certificate data is too long."_s);
        return false;
    }
    bssl::UniquePtr<BIO> bio(BIO_new_mem_buf(data.data(), data.size()));
    if (!bio) {
        OWN_ERROR(globalObject, "Can't allocate buffer");
        return false;
    }
    X509_STORE* store = SSL_CTX_get_cert_store(ctx);
    unsigned loaded = 0;
    bool reachedEnd = false;
    while (true) {
        if (!isPEM && BIO_eof(bio.get())) {
            reachedEnd = true;
            break;
        }
        bssl::UniquePtr<X509> certificate(isPEM ? PEM_read_bio_X509(bio.get(), nullptr, SSL_CTX_get_default_passwd_cb(ctx), SSL_CTX_get_default_passwd_cb_userdata(ctx)) : d2i_X509_bio(bio.get(), nullptr));
        if (!certificate)
            break;
        // One that is there already is not an error to this library.
        if (!X509_STORE_add_cert(store, certificate.get()))
            break;
        ++loaded;
    }
    uint32_t code = ERR_peek_last_error();
    if (!loaded) {
        if (isPEM)
            OWN_ERROR(globalObject, "no start line: cadata does not contain a certificate");
        else
            OWN_ERROR(globalObject, "not enough data: cadata does not contain a certificate");
        return false;
    }
    if (reachedEnd || (isPEM && ERR_GET_LIB(code) == ERR_LIB_PEM && ERR_GET_REASON(code) == PEM_R_NO_START_LINE)) {
        ERR_clear_error();
        return true;
    }
    if (code) {
        LIBRARY_ERROR(globalObject);
        return false;
    }
    return true;
}

static JSValue contextLoadVerifyLocations(JSGlobalObject* globalObject, JSValue self, JSValue cafile, JSValue capath, JSValue cadata)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    SSL_CTX* ctx = contextOf(self).ctx.get();
    bool hasFile = cafile && !isNone(cafile);
    bool hasPath = capath && !isNone(capath);
    bool hasData = cadata && !isNone(cadata);
    if (!hasFile && !hasPath && !hasData)
        return raiseTypeError(globalObject, scope, "cafile, capath and cadata cannot be all omitted"_s);
    CText file, path;
    if (hasFile && failed(scope, pathArgument(globalObject, cafile, "cafile should be a valid filesystem path"_s, file)))
        return {};
    if (hasPath && failed(scope, pathArgument(globalObject, capath, "capath should be a valid filesystem path"_s, path)))
        return {};

    if (hasData) {
        constexpr auto complaint = "cadata should be an ASCII string or a bytes-like object"_s;
        if (isStr(cadata)) {
            String text = strValue(cadata)->value(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (!text.containsOnlyASCII())
                return raiseTypeError(globalObject, scope, complaint);
            auto ascii = tryEncodeUTF8(text);
            if (!addCACertificates(globalObject, ctx, ascii->span(), true))
                return {};
        } else if (hasBuffer(cadata)) {
            BufferHolder data(globalObject);
            if (!data.get(cadata))
                return {};
            if (!addCACertificates(globalObject, ctx, data.buffer.span(), false))
                return {};
        } else
            return raiseTypeError(globalObject, scope, complaint);
    }

    if (hasFile || hasPath) {
        ERR_clear_error();
        errno = 0;
        if (SSL_CTX_load_verify_locations(ctx, hasFile ? file.data() : nullptr, hasPath ? path.data() : nullptr) != 1) {
            if (errno) {
                int error = errno;
                ERR_clear_error();
                return raiseOSError(globalObject, scope, error);
            }
            RELEASE_AND_RETURN(scope, LIBRARY_ERROR(globalObject));
        }
    }
    return jsUndefined();
}

static JSValue contextLoadDHParams(JSGlobalObject* globalObject, JSValue self, JSValue pathValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CText path;
    if (failed(scope, pathArgument(globalObject, pathValue, {}, path)))
        return {};
    if (failed(scope, audit(globalObject, "open"_s, pathValue, makeStr(vm, "rb"_s), jsNumber(0))))
        return {};
    ERR_clear_error();
    errno = 0;
    bssl::UniquePtr<BIO> bio(BIO_new_file(path.data(), "rb"));
    bssl::UniquePtr<DH> parameters(bio ? PEM_read_bio_DHparams(bio.get(), nullptr, nullptr, nullptr) : nullptr);
    if (!parameters) {
        if (errno) {
            int error = errno;
            ERR_clear_error();
            return raiseOSError(globalObject, scope, error, pathValue);
        }
        RELEASE_AND_RETURN(scope, LIBRARY_ERROR(globalObject));
    }
    // Which does nothing: the library has no cipher that would use them.
    if (!SSL_CTX_set_tmp_dh(contextOf(self).ctx.get(), parameters.get()))
        RELEASE_AND_RETURN(scope, LIBRARY_ERROR(globalObject));
    return jsUndefined();
}

static JSValue contextWrapSocket(JSGlobalObject* globalObject, JSValue self, JSValue socketValue, JSValue serverSide, JSValue hostname, JSValue owner, JSValue session)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    PyRecord* socket = PyRecord::tryFrom(socketValue, socketType(globalObject));
    if (!socket)
        return raiseTypeError(globalObject, scope, "_wrap_socket() argument 'sock' must be _socket.socket, not "_s, typeNameOfArgument(globalObject, socketValue));
    bool isServer;
    if (failed(scope, boolArgument(globalObject, serverSide, false, isServer)))
        return {};
    RELEASE_AND_RETURN(scope, createConnection(globalObject, PyRecord::from(self), socket, isServer, hostname, owner, session, nullptr, nullptr));
}

static JSValue contextWrapBIO(JSGlobalObject* globalObject, JSValue self, JSValue incomingValue, JSValue outgoingValue, JSValue serverSide, JSValue hostname, JSValue owner, JSValue session)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    PyRecord* incoming = PyRecord::tryFrom(incomingValue, memoryBIOType(globalObject));
    if (!incoming)
        return raiseTypeError(globalObject, scope, "_wrap_bio() argument 'incoming' must be _ssl.MemoryBIO, not "_s, typeNameOfArgument(globalObject, incomingValue));
    PyRecord* outgoing = PyRecord::tryFrom(outgoingValue, memoryBIOType(globalObject));
    if (!outgoing)
        return raiseTypeError(globalObject, scope, "_wrap_bio() argument 'outgoing' must be _ssl.MemoryBIO, not "_s, typeNameOfArgument(globalObject, outgoingValue));
    bool isServer;
    if (failed(scope, boolArgument(globalObject, serverSide, false, isServer)))
        return {};
    RELEASE_AND_RETURN(scope, createConnection(globalObject, PyRecord::from(self), nullptr, isServer, hostname, owner, session, incoming, outgoing));
}

static JSValue contextSessionStats(JSGlobalObject* globalObject, JSValue self)
{
    VM& vm = getVM(globalObject);
    Context& context = contextOf(self);
    PyDict* result = PyDict::create(globalObject);
    auto add = [&](ASCIILiteral key, uint64_t value) { result->set(vm, internString(vm, key), makeInt(globalObject, value)); };
    add("number"_s, SSL_CTX_sess_number(context.ctx.get()));
    add("connect"_s, context.connects);
    add("connect_good"_s, context.goodConnects);
    add("connect_renegotiate"_s, 0);
    add("accept"_s, context.accepts);
    add("accept_good"_s, context.goodAccepts);
    add("accept_renegotiate"_s, 0);
    add("hits"_s, context.hits);
    // Nobody knows these.
    add("misses"_s, 0);
    add("timeouts"_s, 0);
    add("cache_full"_s, 0);
    return result;
}

static bool exists(const char* path)
{
    struct stat status;
    return path && !stat(path, &status);
}

// Whether the directory has what the library looks for in one: files named by the hash of a subject, like "5ad8a5d6.0".
static bool hasHashedCertificates(const char* path)
{
    DIR* directory = path ? opendir(path) : nullptr;
    if (!directory)
        return false;
    bool found = false;
    while (struct dirent* entry = readdir(directory)) {
        const char* name = entry->d_name;
        size_t digits = 0;
        while (digits < 8 && isASCIIHexDigit(name[digits]))
            ++digits;
        if (digits == 8 && name[8] == '.' && isASCIIDigit(name[9])) {
            found = true;
            break;
        }
    }
    closedir(directory);
    return found;
}

static JSValue contextSetDefaultVerifyPaths(JSGlobalObject* globalObject, JSValue self)
{
    SSL_CTX* ctx = contextOf(self).ctx.get();
    // $SSL_CERT_FILE and $SSL_CERT_DIR, or else where OpenSSL keeps its certificates.
    if (!SSL_CTX_set_default_verify_paths(ctx))
        return LIBRARY_ERROR(globalObject);
    ERR_clear_error();
    // Where that is nothing, and nobody has said so, programs trust what fetch() trusts: the roots that come with Bun.
    if (getenv(X509_get_default_cert_file_env()) || getenv(X509_get_default_cert_dir_env()) || exists(X509_get_default_cert_file()) || hasHashedCertificates(X509_get_default_cert_dir()))
        return jsUndefined();
    X509_LAZY_CERT_SET* roots = us_get_bundled_root_cert_set();
    if (!roots || !X509_STORE_add_lazy_cert_set(SSL_CTX_get_cert_store(ctx), roots))
        return LIBRARY_ERROR(globalObject);
    return jsUndefined();
}

static JSValue contextSetECDHCurve(JSGlobalObject* globalObject, JSValue self, JSValue nameValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CText name;
    if (failed(scope, pathArgument(globalObject, nameValue, {}, name)))
        return {};
    int nid = OBJ_sn2nid(name.data());
    if (!nid)
        return raiseValueError(globalObject, scope, "unknown elliptic curve name "_s, reprForMessage(globalObject, nameValue));
    if (!SSL_CTX_set1_groups(contextOf(self).ctx.get(), &nid, 1))
        RELEASE_AND_RETURN(scope, LIBRARY_ERROR(globalObject));
    return jsUndefined();
}

static JSValue contextGetSNICallback(JSGlobalObject*, JSValue self) { return orNone(PyRecord::from(self)->get(ContextSNICallback)); }

static void contextSetSNICallback(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!value)
        RELEASE_AND_RETURN(scope, raiseCannotDelete(globalObject));
    Context& context = contextOf(self);
    if (context.protocol == ProtocolTLSClient) {
        raiseValueError(globalObject, scope, "sni_callback cannot be set on TLS_CLIENT context"_s);
        return;
    }
    if (isCallable(globalObject, value)) {
        PyRecord::from(self)->set(vm, ContextSNICallback, value);
        SSL_CTX_set_tlsext_servername_callback(context.ctx.get(), serverNameCallback);
        return;
    }
    SSL_CTX_set_tlsext_servername_callback(context.ctx.get(), nullptr);
    PyRecord::from(self)->set(vm, ContextSNICallback, JSValue());
    if (!isNone(value))
        raiseTypeError(globalObject, scope, "not a callable object"_s);
}

static JSValue contextGetMessageCallback(JSGlobalObject*, JSValue self) { return orNone(PyRecord::from(self)->get(ContextMessageCallback)); }

static void raiseCannotDeleteNamed(JSGlobalObject* globalObject, ASCIILiteral name, JSValue self)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    raise(globalObject, scope, runtime(globalObject).AttributeError(), makeString("attribute '"_s, name, "' of '"_s, typeName(globalObject, self), "' objects cannot be deleted"_s));
}

static void contextSetMessageCallback(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!value)
        RELEASE_AND_RETURN(scope, raiseCannotDeleteNamed(globalObject, "_msg_callback"_s, self));
    bool isSet = !isNone(value);
    if (isSet && !isCallable(globalObject, value)) {
        raiseTypeError(globalObject, scope, "not a callable object"_s);
        return;
    }
    PyRecord::from(self)->set(vm, ContextMessageCallback, isSet ? value : JSValue());
    SSL_CTX_set_msg_callback(contextOf(self).ctx.get(), isSet ? messageCallback : nullptr);
}

static JSValue contextGetKeylogFilename(JSGlobalObject*, JSValue self) { return orNone(PyRecord::from(self)->get(ContextKeylogFilename)); }

static void contextSetKeylogFilename(JSGlobalObject* globalObject, JSValue self, JSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!value)
        RELEASE_AND_RETURN(scope, raiseCannotDeleteNamed(globalObject, "keylog_filename"_s, self));
    Context& context = contextOf(self);
    SSL_CTX_set_keylog_callback(context.ctx.get(), nullptr);
    PyRecord::from(self)->set(vm, ContextKeylogFilename, JSValue());
    if (FILE* file = std::exchange(context.keylogFile, nullptr))
        fclose(file);
    if (isNone(value))
        return;

    CText path;
    if (failed(scope, pathArgument(globalObject, value, {}, path)))
        return;
    if (failed(scope, audit(globalObject, "open"_s, value, makeStr(vm, "ab"_s), jsNumber(0))))
        return;
    FILE* file = fopen(path.data(), "ae");
    if (!file) {
        raiseOSError(globalObject, scope, errno, value);
        return;
    }
    context.keylogFile = file;
    PyRecord::from(self)->set(vm, ContextKeylogFilename, value);
    // A file that is new, and is a file, gets a header.
    if (!ftell(file)) {
        fputs("# TLS secrets log file, generated by OpenSSL / Python\n", file);
        fflush(file);
    }
    SSL_CTX_set_keylog_callback(context.ctx.get(), keylogCallback);
}

template<typename Functor>
static bool forEachObjectInStore(JSGlobalObject* globalObject, JSValue self, const Functor& functor)
{
    bssl::UniquePtr<STACK_OF(X509_OBJECT)> objects(X509_STORE_get1_objects(SSL_CTX_get_cert_store(contextOf(self).ctx.get())));
    if (!objects) {
        VM& vm = getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        raiseMemoryError(globalObject, scope, "failed to query cert store"_s);
        return false;
    }
    for (size_t i = 0; i < sk_X509_OBJECT_num(objects.get()); ++i) {
        if (!functor(sk_X509_OBJECT_value(objects.get(), i)))
            return false;
    }
    return true;
}

static JSValue contextCertStoreStats(JSGlobalObject* globalObject, JSValue self)
{
    VM& vm = getVM(globalObject);
    int certificates = 0, authorities = 0, revocationLists = 0;
    bool succeeded = forEachObjectInStore(globalObject, self, [&](const X509_OBJECT* object) {
        switch (X509_OBJECT_get_type(object)) {
        case X509_LU_X509:
            ++certificates;
            if (X509_check_ca(X509_OBJECT_get0_X509(object)))
                ++authorities;
            break;
        case X509_LU_CRL:
            ++revocationLists;
            break;
        }
        return true;
    });
    if (!succeeded)
        return {};
    PyDict* result = PyDict::create(globalObject);
    result->set(vm, internString(vm, "x509"_s), jsNumber(certificates));
    result->set(vm, internString(vm, "crl"_s), jsNumber(revocationLists));
    result->set(vm, internString(vm, "x509_ca"_s), jsNumber(authorities));
    return result;
}

static JSValue contextGetCACerts(JSGlobalObject* globalObject, JSValue self, JSValue binaryForm)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool isBinary;
    if (failed(scope, boolArgument(globalObject, binaryForm, false, isBinary)))
        return {};
    JSArray* result = newList(globalObject);
    bool succeeded = forEachObjectInStore(globalObject, self, [&](const X509_OBJECT* object) {
        if (X509_OBJECT_get_type(object) != X509_LU_X509)
            return true;
        X509* certificate = X509_OBJECT_get0_X509(object);
        if (!X509_check_ca(certificate))
            return true;
        JSValue item = isBinary ? certificateToDER(globalObject, certificate) : decodeCertificate(globalObject, certificate);
        if (!item)
            return false;
        listAppend(globalObject, result, item);
        return true;
    });
    return succeeded ? JSValue(result) : JSValue();
}

static JSValue contextSetPSKClientCallback(JSGlobalObject* globalObject, JSValue self, JSValue callback)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Context& context = contextOf(self);
    if (context.protocol == ProtocolTLSServer)
        RELEASE_AND_RETURN(scope, OWN_ERROR(globalObject, "Cannot add PSK client callback to a PROTOCOL_TLS_SERVER context"));
    bool isSet = !isNone(callback);
    if (isSet && !isCallable(globalObject, callback))
        return raiseTypeError(globalObject, scope, "callback must be callable"_s);
    PyRecord::from(self)->set(vm, ContextPSKClientCallback, isSet ? callback : JSValue());
    SSL_CTX_set_psk_client_callback(context.ctx.get(), isSet ? pskClientCallback : nullptr);
    return jsUndefined();
}

static JSValue contextSetPSKServerCallback(JSGlobalObject* globalObject, JSValue self, JSValue callback, JSValue hintValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Context& context = contextOf(self);
    CText hint;
    bool hasHint = hintValue && !isNone(hintValue);
    if (hasHint && failed(scope, textArgument(globalObject, "set_psk_server_callback"_s, "identity_hint"_s, hintValue, hint)))
        return {};
    if (context.protocol == ProtocolTLSClient)
        RELEASE_AND_RETURN(scope, OWN_ERROR(globalObject, "Cannot add PSK server callback to a PROTOCOL_TLS_CLIENT context"));
    bool isSet = !isNone(callback);
    if (isSet && !isCallable(globalObject, callback))
        return raiseTypeError(globalObject, scope, "callback must be callable"_s);
    if (SSL_CTX_use_psk_identity_hint(context.ctx.get(), isSet && hasHint ? hint.data() : nullptr) != 1) {
        ERR_clear_error();
        return raiseValueError(globalObject, scope, "failed to set identity hint"_s);
    }
    PyRecord::from(self)->set(vm, ContextPSKServerCallback, isSet ? callback : JSValue());
    SSL_CTX_set_psk_server_callback(context.ctx.get(), isSet ? pskServerCallback : nullptr);
    return jsUndefined();
}

static constexpr NativeDef contextMethods[] = {
    PY_NEW(contextNew, "($type, protocol, /)"),
    PY_METHOD("_wrap_socket", contextWrapSocket, "($self, /, sock, server_side, server_hostname=None, *, owner=None, session=None)"),
    PY_METHOD("_wrap_bio", contextWrapBIO, "($self, /, incoming, outgoing, server_side, server_hostname=None, *, owner=None, session=None)"),
    PY_METHOD("set_ciphers", contextSetCiphers, "($self, cipherlist, /)"),
    PY_METHOD("set_ciphersuites", contextSetCiphersuites, "($self, ciphersuites, /)"),
    PY_METHOD("set_groups", contextSetGroups, "($self, grouplist, /)"),
    PY_METHOD("set_client_sigalgs", contextSetSigalgs<false>, "($self, sigalgslist, /)"),
    PY_METHOD("set_server_sigalgs", contextSetSigalgs<true>, "($self, sigalgslist, /)"),
    PY_METHOD("_set_alpn_protocols", contextSetALPNProtocols, "($self, protos, /)"),
    PY_METHOD("load_cert_chain", contextLoadCertChain, "($self, /, certfile, keyfile=None, password=None)"),
    PY_METHOD("load_dh_params", contextLoadDHParams, "($self, path, /)"),
    PY_METHOD("load_verify_locations", contextLoadVerifyLocations, "($self, /, cafile=None, capath=None, cadata=None)"),
    PY_METHOD("session_stats", contextSessionStats, "($self, /)"),
    PY_METHOD("set_default_verify_paths", contextSetDefaultVerifyPaths, "($self, /)"),
    PY_METHOD("set_ecdh_curve", contextSetECDHCurve, "($self, name, /)"),
    PY_METHOD("cert_store_stats", contextCertStoreStats, "($self, /)"),
    PY_METHOD("get_ca_certs", contextGetCACerts, "($self, /, binary_form=False)"),
    PY_METHOD("get_ciphers", contextGetCiphers, "($self, /)"),
    PY_METHOD("get_groups", contextGetGroups, "($self, /, *, include_aliases=False)"),
    PY_METHOD("set_psk_client_callback", contextSetPSKClientCallback, "($self, /, callback)"),
    PY_METHOD("set_psk_server_callback", contextSetPSKServerCallback, "($self, /, callback, identity_hint=None)"),
};

static constexpr NativeGetSet contextGetSets[] = {
    { "check_hostname"_s, contextGetCheckHostname, contextSetCheckHostname },
    { "_host_flags"_s, contextGetHostFlags, contextSetHostFlags },
    { "minimum_version"_s, contextGetVersion<false>, contextSetVersion<false> },
    { "maximum_version"_s, contextGetVersion<true>, contextSetVersion<true> },
    { "keylog_filename"_s, contextGetKeylogFilename, contextSetKeylogFilename },
    { "_msg_callback"_s, contextGetMessageCallback, contextSetMessageCallback },
    { "sni_callback"_s, contextGetSNICallback, contextSetSNICallback },
    { "num_tickets"_s, contextGetNumTickets, contextSetNumTickets },
    { "options"_s, contextGetOptions, contextSetOptions },
    { "post_handshake_auth"_s, contextGetPostHandshakeAuth },
    { "protocol"_s, contextGetProtocol },
    { "verify_flags"_s, contextGetVerifyFlags, contextSetVerifyFlags },
    { "verify_mode"_s, contextGetVerifyMode, contextSetVerifyMode },
    { "security_level"_s, contextGetSecurityLevel },
};

static constexpr TypeDef contextTypeDef { "_ssl._SSLContext"_s, { TypeFlag::Base, TypeFlag::OwnLayout, TypeFlag::Immutable }, contextMethods, contextGetSets, {} };

static PyType* contextType(JSGlobalObject* globalObject) { return runtime(globalObject).typeFor(contextTypeDef); }

// ---- The functions of the module ----

static JSValue testDecodeCert(JSGlobalObject* globalObject, JSValue pathValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CText path;
    if (failed(scope, pathArgument(globalObject, pathValue, {}, path)))
        return {};
    bssl::UniquePtr<BIO> bio(BIO_new_file(path.data(), "rb"));
    if (!bio) {
        ERR_clear_error();
        RELEASE_AND_RETURN(scope, raisePlainError(globalObject, "Can't open file"_s));
    }
    bssl::UniquePtr<X509> certificate(PEM_read_bio_X509(bio.get(), nullptr, nullptr, nullptr));
    if (!certificate) {
        ERR_clear_error();
        RELEASE_AND_RETURN(scope, raisePlainError(globalObject, "Error decoding PEM-encoded file"_s));
    }
    RELEASE_AND_RETURN(scope, decodeCertificate(globalObject, certificate.get()));
}

static JSValue randAdd(JSGlobalObject* globalObject, JSValue data, JSValue entropyValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // The library seeds itself, and takes nothing.
    if (!isStr(data)) {
        BufferHolder input(globalObject);
        if (!input.get(data))
            return {};
    }
    toDouble(globalObject, entropyValue);
    RETURN_IF_EXCEPTION(scope, {});
    return jsUndefined();
}

static JSValue randBytes(JSGlobalObject* globalObject, JSValue countValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int count = toCInt(globalObject, countValue);
    RETURN_IF_EXCEPTION(scope, {});
    if (count < 0)
        return raiseValueError(globalObject, scope, "num must be positive"_s);
    PyBytes* result = newBytes(globalObject, count);
    if (result && count)
        RAND_bytes(result->mutableData(), count);
    return result;
}

static JSValue randStatus(JSGlobalObject*) { return jsBoolean(RAND_status()); }

static JSValue getDefaultVerifyPaths(JSGlobalObject* globalObject)
{
    VM& vm = getVM(globalObject);
    auto convert = [&](const char* text) -> JSValue {
        if (!text)
            return jsUndefined();
        return makeStr(vm, decodeFilesystem({ byteCast<uint8_t>(text), strlen(text) }));
    };
    return PyTuple::create(globalObject, { convert(X509_get_default_cert_file_env()), convert(X509_get_default_cert_file()), convert(X509_get_default_cert_dir_env()), convert(X509_get_default_cert_dir()) });
}

static JSValue getSigalgs(JSGlobalObject* globalObject) { return listOfNames<SSL_get_all_signature_algorithm_names>(globalObject); }

// (nid, short name, long name, OID)
static JSValue describeObject(JSGlobalObject* globalObject, const ASN1_OBJECT* object)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int nid = OBJ_obj2nid(object);
    if (nid == NID_undef)
        return raiseValueError(globalObject, scope, "Unknown object"_s);
    JSValue identifier = objectIdentifierText(globalObject, object, true);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, PyTuple::create(globalObject, { jsNumber(nid), strOrNone(vm, OBJ_nid2sn(nid)), strOrNone(vm, OBJ_nid2ln(nid)), identifier }));
}

static JSValue txt2obj(JSGlobalObject* globalObject, JSValue textValue, JSValue byName)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CText text;
    if (failed(scope, textArgument(globalObject, "txt2obj"_s, "txt"_s, textValue, text)))
        return {};
    bool allowsNames;
    if (failed(scope, boolArgument(globalObject, byName, false, allowsNames)))
        return {};
    bssl::UniquePtr<ASN1_OBJECT> object(OBJ_txt2obj(text.data(), !allowsNames));
    if (!object) {
        ERR_clear_error();
        return raiseValueError(globalObject, scope, "unknown object '"_s, String::fromUTF8(text.span().first(std::min<size_t>(text.length(), 100))), '\'');
    }
    RELEASE_AND_RETURN(scope, describeObject(globalObject, object.get()));
}

static JSValue nid2obj(JSGlobalObject* globalObject, JSValue nidValue)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int nid = toCInt(globalObject, nidValue);
    RETURN_IF_EXCEPTION(scope, {});
    if (nid < NID_undef)
        return raiseValueError(globalObject, scope, "NID must be positive."_s);
    const ASN1_OBJECT* object = OBJ_nid2obj(nid);
    if (!object) {
        ERR_clear_error();
        return raiseValueError(globalObject, scope, "unknown NID "_s, nid);
    }
    RELEASE_AND_RETURN(scope, describeObject(globalObject, object));
}

static constexpr NativeDef functions[] = {
    PY_FUNCTION("_test_decode_cert", testDecodeCert, "(path, /)"),
    PY_FUNCTION("RAND_add", randAdd, "(string, entropy, /)"),
    PY_FUNCTION("RAND_bytes", randBytes, "(n, /)"),
    PY_FUNCTION("RAND_status", randStatus, "()"),
    PY_FUNCTION("get_default_verify_paths", getDefaultVerifyPaths, "()"),
    PY_FUNCTION("get_sigalgs", getSigalgs, "()"),
    PY_FUNCTION("txt2obj", txt2obj, "(txt, name=False)"),
    PY_FUNCTION("nid2obj", nid2obj, "(nid, /)"),
};

struct Constant {
    ASCIILiteral name;
    int64_t value;
};

static constexpr Constant constants[] = {
    { "SSL_ERROR_ZERO_RETURN"_s, ErrorZeroReturn },
    { "SSL_ERROR_WANT_READ"_s, ErrorWantRead },
    { "SSL_ERROR_WANT_WRITE"_s, ErrorWantWrite },
    { "SSL_ERROR_WANT_X509_LOOKUP"_s, ErrorWantX509Lookup },
    { "SSL_ERROR_SYSCALL"_s, ErrorSyscall },
    { "SSL_ERROR_SSL"_s, ErrorSSL },
    { "SSL_ERROR_WANT_CONNECT"_s, ErrorWantConnect },
    { "SSL_ERROR_EOF"_s, ErrorEOF },
    { "SSL_ERROR_INVALID_ERROR_CODE"_s, ErrorInvalidErrorCode },

    { "CERT_NONE"_s, CertNone },
    { "CERT_OPTIONAL"_s, CertOptional },
    { "CERT_REQUIRED"_s, CertRequired },

    { "VERIFY_DEFAULT"_s, 0 },
    { "VERIFY_CRL_CHECK_LEAF"_s, X509_V_FLAG_CRL_CHECK },
    { "VERIFY_CRL_CHECK_CHAIN"_s, X509_V_FLAG_CRL_CHECK | X509_V_FLAG_CRL_CHECK_ALL },
    { "VERIFY_X509_STRICT"_s, verifyFlagStrict },
    { "VERIFY_ALLOW_PROXY_CERTS"_s, X509_V_FLAG_ALLOW_PROXY_CERTS },
    { "VERIFY_X509_TRUSTED_FIRST"_s, verifyFlagTrustedFirst },
    { "VERIFY_X509_PARTIAL_CHAIN"_s, X509_V_FLAG_PARTIAL_CHAIN },

#define ALERT(name) { "ALERT_DESCRIPTION_" #name ""_s, SSL_AD_##name }
    ALERT(CLOSE_NOTIFY),
    ALERT(UNEXPECTED_MESSAGE),
    ALERT(BAD_RECORD_MAC),
    ALERT(RECORD_OVERFLOW),
    ALERT(DECOMPRESSION_FAILURE),
    ALERT(HANDSHAKE_FAILURE),
    ALERT(BAD_CERTIFICATE),
    ALERT(UNSUPPORTED_CERTIFICATE),
    ALERT(CERTIFICATE_REVOKED),
    ALERT(CERTIFICATE_EXPIRED),
    ALERT(CERTIFICATE_UNKNOWN),
    ALERT(ILLEGAL_PARAMETER),
    ALERT(UNKNOWN_CA),
    ALERT(ACCESS_DENIED),
    ALERT(DECODE_ERROR),
    ALERT(DECRYPT_ERROR),
    ALERT(PROTOCOL_VERSION),
    ALERT(INSUFFICIENT_SECURITY),
    ALERT(INTERNAL_ERROR),
    ALERT(USER_CANCELLED),
    ALERT(NO_RENEGOTIATION),
    ALERT(UNSUPPORTED_EXTENSION),
    ALERT(CERTIFICATE_UNOBTAINABLE),
    ALERT(UNRECOGNIZED_NAME),
    ALERT(BAD_CERTIFICATE_STATUS_RESPONSE),
    ALERT(BAD_CERTIFICATE_HASH_VALUE),
    ALERT(UNKNOWN_PSK_IDENTITY),
#undef ALERT

    { "PROTOCOL_SSLv23"_s, ProtocolTLS },
    { "PROTOCOL_TLS"_s, ProtocolTLS },
    { "PROTOCOL_TLS_CLIENT"_s, ProtocolTLSClient },
    { "PROTOCOL_TLS_SERVER"_s, ProtocolTLSServer },
    { "PROTOCOL_TLSv1"_s, ProtocolTLSv1 },
    { "PROTOCOL_TLSv1_1"_s, ProtocolTLSv1_1 },
    { "PROTOCOL_TLSv1_2"_s, ProtocolTLSv1_2 },

    // As the library has them: an option that is 0 is one it has no use for, because it always, or never, does that.
    { "OP_ALL"_s, SSL_OP_ALL },
    { "OP_NO_SSLv2"_s, SSL_OP_NO_SSLv2 },
    { "OP_NO_SSLv3"_s, SSL_OP_NO_SSLv3 },
    { "OP_NO_TLSv1"_s, SSL_OP_NO_TLSv1 },
    { "OP_NO_TLSv1_1"_s, SSL_OP_NO_TLSv1_1 },
    { "OP_NO_TLSv1_2"_s, SSL_OP_NO_TLSv1_2 },
    { "OP_NO_TLSv1_3"_s, SSL_OP_NO_TLSv1_3 },
    { "OP_CIPHER_SERVER_PREFERENCE"_s, SSL_OP_CIPHER_SERVER_PREFERENCE },
    { "OP_SINGLE_DH_USE"_s, SSL_OP_SINGLE_DH_USE },
    { "OP_NO_TICKET"_s, SSL_OP_NO_TICKET },
    { "OP_LEGACY_SERVER_CONNECT"_s, SSL_OP_LEGACY_SERVER_CONNECT },
    { "OP_SINGLE_ECDH_USE"_s, SSL_OP_SINGLE_ECDH_USE },
    { "OP_NO_COMPRESSION"_s, SSL_OP_NO_COMPRESSION },
    { "OP_NO_RENEGOTIATION"_s, SSL_OP_NO_RENEGOTIATION },

    { "HOSTFLAG_ALWAYS_CHECK_SUBJECT"_s, X509_CHECK_FLAG_ALWAYS_CHECK_SUBJECT },
    { "HOSTFLAG_NEVER_CHECK_SUBJECT"_s, X509_CHECK_FLAG_NEVER_CHECK_SUBJECT },
    { "HOSTFLAG_NO_WILDCARDS"_s, X509_CHECK_FLAG_NO_WILDCARDS },
    { "HOSTFLAG_NO_PARTIAL_WILDCARDS"_s, X509_CHECK_FLAG_NO_PARTIAL_WILDCARDS },
    { "HOSTFLAG_MULTI_LABEL_WILDCARDS"_s, X509_CHECK_FLAG_MULTI_LABEL_WILDCARDS },
    { "HOSTFLAG_SINGLE_LABEL_SUBDOMAINS"_s, X509_CHECK_FLAG_SINGLE_LABEL_SUBDOMAINS },

    { "ENCODING_PEM"_s, EncodingPEM },
    { "ENCODING_DER"_s, EncodingDER },

    { "PROTO_MINIMUM_SUPPORTED"_s, protoMinimumSupported },
    { "PROTO_MAXIMUM_SUPPORTED"_s, protoMaximumSupported },
    { "PROTO_SSLv3"_s, SSL3_VERSION },
    { "PROTO_TLSv1"_s, TLS1_VERSION },
    { "PROTO_TLSv1_1"_s, TLS1_1_VERSION },
    { "PROTO_TLSv1_2"_s, TLS1_2_VERSION },
    { "PROTO_TLSv1_3"_s, TLS1_3_VERSION },
};

struct Feature {
    ASCIILiteral name;
    bool isThere;
};

static constexpr Feature features[] = {
    { "HAS_SNI"_s, true },
    { "HAS_TLS_UNIQUE"_s, true },
    { "HAS_ECDH"_s, true },
    { "HAS_NPN"_s, false },
    { "HAS_ALPN"_s, true },
    { "HAS_SSLv2"_s, false },
    { "HAS_SSLv3"_s, false },
    { "HAS_TLSv1"_s, true },
    { "HAS_TLSv1_1"_s, true },
    { "HAS_TLSv1_2"_s, true },
    { "HAS_TLSv1_3"_s, true },
    { "HAS_PSK"_s, true },
    { "HAS_PSK_TLS13"_s, false },
    { "HAS_PHA"_s, false },
};

// (major, minor, fix, patch, status)
static JSValue versionTuple(JSGlobalObject* globalObject, unsigned long version)
{
    return PyTuple::create(globalObject, { jsNumber((version >> 28) & 0xff), jsNumber((version >> 20) & 0xff), jsNumber((version >> 12) & 0xff), jsNumber((version >> 4) & 0xff), jsNumber(version & 0xf) });
}

static void initialize(JSGlobalObject* globalObject, PyModule* module)
{
    Runtime& rt = runtime(globalObject);
    VM& vm = rt.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // _ssl.c gets the type of sockets from there.
    importModule(globalObject, "_socket"_s);
    RETURN_IF_EXCEPTION(scope, void());

    module->add(globalObject, "__doc__"_s, makeStr(vm, "Implementation module for SSL socket operations.  See the socket module\nfor documentation."_s));
    module->addFunctions(globalObject, functions);
    module->add(globalObject, "_SSLContext"_s, contextType(globalObject));
    module->add(globalObject, "_SSLSocket"_s, connectionType(globalObject));
    module->add(globalObject, "MemoryBIO"_s, memoryBIOType(globalObject));
    module->add(globalObject, "Certificate"_s, certificateType(globalObject));
    PyType* session = sessionType(globalObject);
    session->dict()->set(vm, rt.name(Special::Hash), jsUndefined());
    session->didChange(vm);
    module->add(globalObject, "SSLSession"_s, session);

    if (failed(scope, makeDerivedErrors(globalObject)))
        return;
    module->add(globalObject, "SSLError"_s, sslError(globalObject));
    for (unsigned i = 0; i < DerivedErrorCount; ++i)
        module->add(globalObject, derivedErrors[i].name, derivedError(globalObject, static_cast<DerivedError>(i)));

    for (auto& constant : constants)
        module->add(globalObject, constant.name, makeInt(globalObject, constant.value));
    for (auto& feature : features)
        module->add(globalObject, feature.name, jsBoolean(feature.isThere));
    module->add(globalObject, "_DEFAULT_CIPHERS"_s, makeStr(vm, DEFAULT_CIPHERS ""_s));

    // The version of OpenSSL whose interface the library has, as the library itself puts it for those who look at this:
    // "OpenSSL 1.1.1 (compatible; BoringSSL)".
    module->add(globalObject, "OPENSSL_VERSION_NUMBER"_s, makeInt(globalObject, static_cast<uint64_t>(OpenSSL_version_num())));
    module->add(globalObject, "OPENSSL_VERSION_INFO"_s, versionTuple(globalObject, OpenSSL_version_num()));
    module->add(globalObject, "OPENSSL_VERSION"_s, makeStr(vm, OPENSSL_VERSION_TEXT ""_s));
    module->add(globalObject, "_OPENSSL_API_VERSION"_s, versionTuple(globalObject, OPENSSL_VERSION_NUMBER));
}

} // namespace Ssl

void initializeSslModule(JSGlobalObject* globalObject, PyModule* module)
{
    Ssl::initialize(globalObject, module);
}

} // namespace PythonModules
} // namespace Bun

#endif // !OS(WINDOWS)
