#pragma once

#ifdef __cplusplus
#include "wtf/Compiler.h"
#include "wtf/text/OrdinalNumber.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/ArgList.h"
#include <set>
#endif

#include "c-typedefs.h"

#ifndef HEADERS_HANDWRITTEN
#define HEADERS_HANDWRITTEN
typedef uint16_t ZigErrorCode;
typedef struct VirtualMachine VirtualMachine;
// exists to make headers.h happy
typedef struct CppWebSocket CppWebSocket;

typedef struct ZigString {
    const unsigned char* ptr;
    size_t len;
} ZigString;

#ifndef __cplusplus
typedef uint8_t BunStringTag;
#else
enum class BunStringTag : uint8_t {
    Dead = 0,
    WTFStringImpl = 1,
    ZigString = 2,
    StaticZigString = 3,
    Empty = 4,
};
#endif

typedef union BunStringImpl {
    ZigString zig;
    WTF__StringImpl* wtf;
} BunStringImpl;

typedef struct BunString {
    BunStringTag tag;
    BunStringImpl impl;

#ifdef __cplusplus
    enum ZeroCopyTag { ZeroCopy };
    enum NonNullTag { NonNull };

    // If it's not a WTFStringImpl, this does nothing
    inline void ref();

    // If it's not a WTFStringImpl, this does nothing
    inline void deref();

    static size_t utf8ByteLength(const WTF::String&);

    // Zero copy is kind of a lie.
    // We clone it if it's non-ASCII UTF-8.
    // We don't clone it if it was marked as static
    // if it was a ZigString, it still allocates a WTF::StringImpl.
    // It's only truly zero-copy if it was already a WTFStringImpl (which it is if it came from JS and we didn't use ZigString)
    WTF::String toWTFString(ZeroCopyTag) const;

    // If the string is empty, this will ensure m_impl is non-null by
    // using shared static emptyString.
    WTF::String toWTFString(NonNullTag) const;

    WTF::String transferToWTFString();

    // This one usually will clone the raw bytes.
    WTF::String toWTFString() const;

    bool isEmpty() const;
#endif
} BunString;

typedef struct ZigErrorType {
    ZigErrorCode code;
    void* ptr;
} ZigErrorType;
typedef union ErrorableZigStringResult {
    ZigString value;
    ZigErrorType err;
} ErrorableZigStringResult;
typedef struct ErrorableZigString {
    ErrorableZigStringResult result;
    bool success;
} ErrorableZigString;
typedef union ErrorableStringResult {
    BunString value;
    ZigErrorType err;
} ErrorableStringResult;
typedef struct ErrorableString {
    ErrorableStringResult result;
    bool success;
} ErrorableString;
typedef struct ResolvedSource {
    BunString specifier;
    BunString source_code;
    BunString source_url;
    bool isCommonJSModule;
    JSC__EncodedJSValue cjsCustomExtension;
    void* allocator;
    JSC__EncodedJSValue jsvalue_for_export;
    uint32_t tag;
    bool needsDeref;
    bool already_bundled;
    uint8_t* bytecode_cache;
    size_t bytecode_cache_size;
} ResolvedSource;
static const uint32_t ResolvedSourceTagPackageJSONTypeModule = 1;
typedef union ErrorableResolvedSourceResult {
    ResolvedSource value;
    ZigErrorType err;
} ErrorableResolvedSourceResult;
typedef struct ErrorableResolvedSource {
    ErrorableResolvedSourceResult result;
    bool success;
} ErrorableResolvedSource;

typedef struct SystemError {
    int errno_;
    BunString code;
    BunString message;
    BunString path;
    BunString syscall;
    BunString hostname;
    /// MinInt if not specified
    int fd;
    BunString dest;
} SystemError;

typedef void* ArrayBufferSink;

typedef uint8_t BunPluginTarget;
const BunPluginTarget BunPluginTargetBun = 0;
const BunPluginTarget BunPluginTargetBrowser = 1;
const BunPluginTarget BunPluginTargetNode = 2;
const BunPluginTarget BunPluginTargetMax = BunPluginTargetNode;

typedef uint8_t ZigStackFrameCode;
const ZigStackFrameCode ZigStackFrameCodeNone = 0;
const ZigStackFrameCode ZigStackFrameCodeEval = 1;
const ZigStackFrameCode ZigStackFrameCodeModule = 2;
const ZigStackFrameCode ZigStackFrameCodeFunction = 3;
const ZigStackFrameCode ZigStackFrameCodeGlobal = 4;
const ZigStackFrameCode ZigStackFrameCodeWasm = 5;
const ZigStackFrameCode ZigStackFrameCodeConstructor = 6;

AUTO_EXTERN_C void __attribute((__noreturn__)) Bun__panic(const char* message, size_t length);
#define BUN_PANIC(message) Bun__panic(message, sizeof(message) - 1)

typedef struct ZigStackFramePosition {
    int32_t line_zero_based;
    int32_t column_zero_based;
    int32_t byte_position;

#ifdef __cplusplus
    ALWAYS_INLINE WTF::OrdinalNumber column()
    {
        return OrdinalNumber::fromZeroBasedInt(this->column_zero_based);
    }
    ALWAYS_INLINE WTF::OrdinalNumber line()
    {
        return OrdinalNumber::fromZeroBasedInt(this->line_zero_based);
    }
#endif
} ZigStackFramePosition;

typedef struct ZigStackFrame {
    BunString function_name;
    BunString source_url;
    ZigStackFramePosition position;
    ZigStackFrameCode code_type;
    bool remapped;
} ZigStackFrame;

typedef struct ZigStackTrace {
    BunString* source_lines_ptr;
    WTF__OrdinalNumber* source_lines_numbers;
    uint8_t source_lines_len;
    uint8_t source_lines_to_collect;
    ZigStackFrame* frames_ptr;
    uint8_t frames_len;
    JSC__SourceProvider* referenced_source_provider;
} ZigStackTrace;

typedef struct ZigException {
    unsigned char type;
    uint16_t runtime_type;
    int errno_;
    BunString syscall;
    BunString system_code;
    BunString path;
    BunString name;
    BunString message;
    ZigStackTrace stack;
    void* exception;
    bool remapped;
    int fd;
} ZigException;

typedef uint8_t JSErrorCode;
const JSErrorCode JSErrorCodeError = 0;
const JSErrorCode JSErrorCodeEvalError = 1;
const JSErrorCode JSErrorCodeRangeError = 2;
const JSErrorCode JSErrorCodeReferenceError = 3;
const JSErrorCode JSErrorCodeSyntaxError = 4;
const JSErrorCode JSErrorCodeTypeError = 5;
const JSErrorCode JSErrorCodeURIError = 6;
const JSErrorCode JSErrorCodeAggregateError = 7;
const JSErrorCode JSErrorCodeOutOfMemoryError = 8;
const JSErrorCode JSErrorCodeStackOverflow = 253;
const JSErrorCode JSErrorCodeUserErrorCode = 254;

typedef uint8_t BunLoaderType;
const BunLoaderType BunLoaderTypeNone = 254;
const BunLoaderType BunLoaderTypeJSX = 0;
const BunLoaderType BunLoaderTypeJS = 1;
const BunLoaderType BunLoaderTypeTS = 2;
const BunLoaderType BunLoaderTypeTSX = 3;
const BunLoaderType BunLoaderTypeCSS = 4;
const BunLoaderType BunLoaderTypeFILE = 5;
const BunLoaderType BunLoaderTypeJSON = 6;
const BunLoaderType BunLoaderTypeTOML = 7;
const BunLoaderType BunLoaderTypeWASM = 8;
const BunLoaderType BunLoaderTypeNAPI = 9;

#pragma mark - Stream

typedef uint8_t Encoding;
const Encoding Encoding__utf8 = 0;
const Encoding Encoding__ucs2 = 1;
const Encoding Encoding__utf16le = 2;
const Encoding Encoding__latin1 = 3;
const Encoding Encoding__ascii = 4;
const Encoding Encoding__base64 = 5;
const Encoding Encoding__base64url = 6;
const Encoding Encoding__hex = 7;
const Encoding Encoding__buffer = 8;

typedef uint8_t WritableEvent;
const WritableEvent WritableEvent__Close = 0;
const WritableEvent WritableEvent__Drain = 1;
const WritableEvent WritableEvent__Error = 2;
const WritableEvent WritableEvent__Finish = 3;
const WritableEvent WritableEvent__Pipe = 4;
const WritableEvent WritableEvent__Unpipe = 5;
const WritableEvent WritableEvent__Open = 6;
const WritableEvent WritableEventUser = 254;

typedef uint8_t ReadableEvent;

const ReadableEvent ReadableEvent__Close = 0;
const ReadableEvent ReadableEvent__Data = 1;
const ReadableEvent ReadableEvent__End = 2;
const ReadableEvent ReadableEvent__Error = 3;
const ReadableEvent ReadableEvent__Pause = 4;
const ReadableEvent ReadableEvent__Readable = 5;
const ReadableEvent ReadableEvent__Resume = 6;
const ReadableEvent ReadableEvent__Open = 7;
const ReadableEvent ReadableEventUser = 254;

#ifndef STRING_POINTER
#define STRING_POINTER
typedef struct StringPointer {
    uint32_t off;
    uint32_t len;
} StringPointer;
#endif

typedef void WebSocketHTTPClient;
typedef void WebSocketHTTPSClient;
typedef void WebSocketClient;
typedef void WebSocketClientTLS;

#ifndef __cplusplus
typedef struct Bun__ArrayBuffer Bun__ArrayBuffer;
#endif

#ifdef __cplusplus

AUTO_EXTERN_C void Bun__WTFStringImpl__deref(WTF::StringImpl* impl);
AUTO_EXTERN_C void Bun__WTFStringImpl__ref(WTF::StringImpl* impl);
AUTO_EXTERN_C bool BunString__fromJS(JSC::JSGlobalObject*, JSC::EncodedJSValue, BunString*);
AUTO_EXTERN_C JSC::EncodedJSValue BunString__toJS(JSC::JSGlobalObject*, const BunString*);
AUTO_EXTERN_C void BunString__toWTFString(BunString*);

namespace Bun {
JSC::JSString* toJS(JSC::JSGlobalObject*, BunString);
BunString toString(JSC::JSGlobalObject* globalObject, JSC::JSValue value);
BunString toString(const char* bytes, size_t length);
BunString toString(WTF::String& wtfString);
BunString toString(const WTF::String& wtfString);
BunString toString(WTF::StringImpl* wtfString);

BunString toStringRef(JSC::JSGlobalObject* globalObject, JSC::JSValue value);
BunString toStringRef(WTF::String& wtfString);
BunString toStringRef(const WTF::String& wtfString);
BunString toStringRef(WTF::StringImpl* wtfString);

// This creates a detached string view, which cannot be ref/unref.
// Be very careful using this, and ensure the memory owner does not get destroyed.
BunString toStringView(WTF::StringView view);
}

typedef struct {
    char* ptr;
    size_t offset;
    size_t len;
    size_t byte_len;
    uint8_t cell_type;
    int64_t _value;
    bool shared;
} Bun__ArrayBuffer;

#include "SyntheticModuleType.h"

AUTO_EXTERN_C const char* Bun__userAgent;

AUTO_EXTERN_C ZigErrorCode Zig_ErrorCodeParserError;

AUTO_EXTERN_C void ZigString__free(const unsigned char* ptr, size_t len, void* allocator);

AUTO_EXTERN_C bool Bun__transpileVirtualModule(
    JSC::JSGlobalObject* global,
    const BunString* specifier,
    const BunString* referrer,
    ZigString* sourceCode,
    BunLoaderType loader,
    ErrorableResolvedSource* result);

AUTO_EXTERN_C JSC::EncodedJSValue Bun__runVirtualModule(
    JSC::JSGlobalObject* global,
    const BunString* specifier);

AUTO_EXTERN_C JSC::JSInternalPromise* Bun__transpileFile(
    void* bunVM,
    JSC::JSGlobalObject* global,
    BunString* specifier,
    BunString* referrer,
    const BunString* typeAttribute,
    ErrorableResolvedSource* result,
    bool allowPromise,
    bool isCommonJSRequire,
    BunLoaderType forceLoaderType);

AUTO_EXTERN_C bool Bun__fetchBuiltinModule(
    void* bunVM,
    JSC::JSGlobalObject* global,
    const BunString* specifier,
    const BunString* referrer,
    ErrorableResolvedSource* result);
AUTO_EXTERN_C bool Bun__resolveAndFetchBuiltinModule(
    void* bunVM,
    const BunString* specifier,
    ErrorableResolvedSource* result);

// Used in process.version
AUTO_EXTERN_C const char* Bun__version;
AUTO_EXTERN_C const char* Bun__version_with_sha;

// Used in process.versions
AUTO_EXTERN_C const char* Bun__versions_boringssl;
AUTO_EXTERN_C const char* Bun__versions_libarchive;
AUTO_EXTERN_C const char* Bun__versions_mimalloc;
AUTO_EXTERN_C const char* Bun__versions_picohttpparser;
AUTO_EXTERN_C const char* Bun__versions_uws;
AUTO_EXTERN_C const char* Bun__versions_webkit;
AUTO_EXTERN_C const char* Bun__versions_libdeflate;
AUTO_EXTERN_C const char* Bun__versions_zig;
AUTO_EXTERN_C const char* Bun__versions_zlib;
AUTO_EXTERN_C const char* Bun__versions_tinycc;
AUTO_EXTERN_C const char* Bun__versions_lolhtml;
AUTO_EXTERN_C const char* Bun__versions_c_ares;
AUTO_EXTERN_C const char* Bun__versions_lshpack;
AUTO_EXTERN_C const char* Bun__versions_zstd;
AUTO_EXTERN_C const char* Bun__versions_usockets;

AUTO_EXTERN_C const char* Bun__version_sha;

AUTO_EXTERN_C void ZigString__freeGlobal(const unsigned char* ptr, size_t len);

AUTO_EXTERN_C size_t Bun__encoding__writeLatin1(const unsigned char* ptr, size_t len, unsigned char* to, size_t other_len, Encoding encoding);
AUTO_EXTERN_C size_t Bun__encoding__writeUTF16(const UChar* ptr, size_t len, unsigned char* to, size_t other_len, Encoding encoding);

AUTO_EXTERN_C size_t Bun__encoding__byteLengthLatin1AsUTF8(const unsigned char* ptr, size_t len);
AUTO_EXTERN_C size_t Bun__encoding__byteLengthUTF16AsUTF8(const UChar* ptr, size_t len);

AUTO_EXTERN_C int64_t Bun__encoding__constructFromLatin1(void*, const unsigned char* ptr, size_t len, Encoding encoding);
AUTO_EXTERN_C int64_t Bun__encoding__constructFromUTF16(void*, const UChar* ptr, size_t len, Encoding encoding);

AUTO_EXTERN_C void Bun__EventLoop__runCallback1(JSC::JSGlobalObject* global, JSC::EncodedJSValue callback, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue arg1);
AUTO_EXTERN_C void Bun__EventLoop__runCallback2(JSC::JSGlobalObject* global, JSC::EncodedJSValue callback, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue arg1, JSC::EncodedJSValue arg2);
AUTO_EXTERN_C void Bun__EventLoop__runCallback3(JSC::JSGlobalObject* global, JSC::EncodedJSValue callback, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue arg1, JSC::EncodedJSValue arg2, JSC::EncodedJSValue arg3);

/// @note throws a JS exception and returns false if a stack overflow occurs
template<bool isStrict, bool enableAsymmetricMatchers>
bool Bun__deepEquals(JSC::JSGlobalObject* globalObject, JSC::JSValue v1, JSC::JSValue v2, JSC::MarkedArgumentBuffer&, Vector<std::pair<JSC::JSValue, JSC::JSValue>, 16>& stack, JSC::ThrowScope* scope, bool addToStack);

/**
 * @brief `Bun.deepMatch(a, b)`
 *
 * `object` and `subset` must be objects. In the future we should change the
 * signature of this function to only take `JSC::JSCell`. For now, panics
 * if either `object` or `subset` are not `JSCCell`.
 *
 * @note
 * The sets recording already visited properties (`seenObjProperties` and
 * `seenSubsetProperties`) aren not needed when both `enableAsymmetricMatchers`
 * and `isMatchingObjectContaining` are true. In this case, it is safe to pass a
 * `nullptr`.
 *
 * `gcBuffer` ensures JSC's stack scan does not come up empty-handed and free
 * properties currently within those stacks. Likely unnecessary, but better to
 * be safe tnan sorry
 *
 *
 * @tparam enableAsymmetricMatchers
 * @param objValue
 * @param seenObjProperties already visited properties of `objValue`.
 * @param subsetValue
 * @param seenSubsetProperties already visited properties of `subsetValue`.
 * @param globalObject
 * @param Scope
 * @param gcBuffer
 * @param replacePropsWithAsymmetricMatchers
 * @param isMatchingObjectContaining
 *
 * @return true
 * @return false
 */
template<bool enableAsymmetricMatchers>
bool Bun__deepMatch(
    JSC::JSValue object,
    std::set<JSC::EncodedJSValue>* seenObjProperties,
    JSC::JSValue subset,
    std::set<JSC::EncodedJSValue>* seenSubsetProperties,
    JSC::JSGlobalObject* globalObject,
    JSC::ThrowScope* throwScope,
    JSC::MarkedArgumentBuffer* gcBuffer,
    bool replacePropsWithAsymmetricMatchers,
    bool isMatchingObjectContaining);

AUTO_EXTERN_C void Bun__remapStackFramePositions(void*, ZigStackFrame*, size_t);

namespace Inspector {
class ScriptArguments;
}

using ScriptArguments = Inspector::ScriptArguments;

ALWAYS_INLINE void BunString::ref()
{
    if (this->tag == BunStringTag::WTFStringImpl) {
        this->impl.wtf->ref();
    }
}
ALWAYS_INLINE void BunString::deref()
{
    if (this->tag == BunStringTag::WTFStringImpl) {
        this->impl.wtf->deref();
    }
}

#endif // __cplusplus
#endif // HEADERS_HANDWRITTEN
