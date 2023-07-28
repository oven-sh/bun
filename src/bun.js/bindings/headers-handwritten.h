#pragma once

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
typedef union BunStringImpl {
    ZigString zig;
    void* wtf;
} BunStringImpl;

typedef struct BunString {
    BunStringTag tag;
    BunStringImpl impl;
} BunString;
#else
typedef union BunStringImpl {
    ZigString zig;
    WTF::StringImpl* wtf;
} BunStringImpl;

enum class BunStringTag : uint8_t {
    Dead = 0,
    WTFStringImpl = 1,
    ZigString = 2,
    StaticZigString = 3,
    Empty = 4,
};

typedef struct BunString {
    BunStringTag tag;
    BunStringImpl impl;
} BunString;

#endif

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
    ZigString source_url;
    ZigString* commonJSExports;
    uint32_t commonJSExportsLen;
    uint32_t hash;
    void* allocator;
    uint64_t tag;
} ResolvedSource;
static const uint64_t ResolvedSourceTagPackageJSONTypeModule = 1;
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
    int fd;
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

typedef struct ZigStackFramePosition {
    int32_t source_offset;
    int32_t line;
    int32_t line_start;
    int32_t line_stop;
    int32_t column_start;
    int32_t column_stop;
    int32_t expression_start;
    int32_t expression_stop;
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
    int32_t* source_lines_numbers;
    uint8_t source_lines_len;
    uint8_t source_lines_to_collect;
    ZigStackFrame* frames_ptr;
    uint8_t frames_len;
} ZigStackTrace;

typedef struct ZigException {
    unsigned char code;
    uint16_t runtime_type;
    int errno_;
    BunString syscall;
    BunString code_;
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
typedef struct Uint8Array_alias Uint8Array_alias;
#endif

#ifdef __cplusplus

extern "C" void Bun__WTFStringImpl__deref(WTF::StringImpl* impl);
extern "C" void Bun__WTFStringImpl__ref(WTF::StringImpl* impl);
extern "C" bool BunString__fromJS(JSC::JSGlobalObject*, JSC::EncodedJSValue, BunString*);
extern "C" JSC::EncodedJSValue BunString__toJS(JSC::JSGlobalObject*, BunString*);
extern "C" void BunString__toWTFString(BunString*);

namespace Bun {
JSC::JSValue toJS(JSC::JSGlobalObject*, BunString);
BunString toString(JSC::JSGlobalObject* globalObject, JSC::JSValue value);
WTF::String toWTFString(const BunString& bunString);
BunString toString(WTF::String& wtfString);
BunString toString(const WTF::String& wtfString);
BunString toString(WTF::StringImpl* wtfString);

BunString toStringRef(JSC::JSGlobalObject* globalObject, JSC::JSValue value);
BunString toStringRef(WTF::String& wtfString);
BunString toStringRef(const WTF::String& wtfString);
BunString toStringRef(WTF::StringImpl* wtfString);
}

using Uint8Array_alias = JSC::JSUint8Array;

typedef struct {
    char* ptr;
    uint32_t offset;
    uint32_t len;
    uint32_t byte_len;
    uint8_t cell_type;
    int64_t _value;
    bool shared;
} Bun__ArrayBuffer;

enum SyntheticModuleType : uint64_t {
    ObjectModule = 2,

    Buffer = 1024,
    Process = 1025,
    Events = 1026,
    StringDecoder = 1027,
    Module = 1028,
    TTY = 1029,
    NodeUtilTypes = 1030,
    Constants = 1031,
};

extern "C" const char* Bun__userAgent;

extern "C" ZigErrorCode Zig_ErrorCodeParserError;

extern "C" void ZigString__free(const unsigned char* ptr, size_t len, void* allocator);
extern "C" void Microtask__run(void* ptr, void* global);
extern "C" void Microtask__run_default(void* ptr, void* global);

extern "C" bool Bun__transpileVirtualModule(
    JSC::JSGlobalObject* global,
    const BunString* specifier,
    const BunString* referrer,
    ZigString* sourceCode,
    BunLoaderType loader,
    ErrorableResolvedSource* result);

extern "C" JSC::EncodedJSValue Bun__runVirtualModule(
    JSC::JSGlobalObject* global,
    const BunString* specifier);

extern "C" void* Bun__transpileFile(
    void* bunVM,
    JSC::JSGlobalObject* global,
    const BunString* specifier,
    const BunString* referrer,
    ErrorableResolvedSource* result, bool allowPromise);

extern "C" JSC::EncodedJSValue CallbackJob__onResolve(JSC::JSGlobalObject*, JSC::CallFrame*);
extern "C" JSC::EncodedJSValue CallbackJob__onReject(JSC::JSGlobalObject*, JSC::CallFrame*);

extern "C" bool Bun__fetchBuiltinModule(
    void* bunVM,
    JSC::JSGlobalObject* global,
    const BunString* specifier,
    const BunString* referrer,
    ErrorableResolvedSource* result);

// Used in process.version
extern "C" const char* Bun__version;

// Used in process.versions
extern "C" const char* Bun__versions_boringssl;
extern "C" const char* Bun__versions_libarchive;
extern "C" const char* Bun__versions_mimalloc;
extern "C" const char* Bun__versions_picohttpparser;
extern "C" const char* Bun__versions_uws;
extern "C" const char* Bun__versions_webkit;
extern "C" const char* Bun__versions_zig;
extern "C" const char* Bun__versions_zlib;
extern "C" const char* Bun__versions_tinycc;
extern "C" const char* Bun__versions_lolhtml;
extern "C" const char* Bun__versions_c_ares;
extern "C" const char* Bun__versions_usockets;

extern "C" const char* Bun__version_sha;

extern "C" void ZigString__free_global(const unsigned char* ptr, size_t len);

extern "C" size_t Bun__encoding__writeLatin1(const unsigned char* ptr, size_t len, unsigned char* to, size_t other_len, Encoding encoding);
extern "C" size_t Bun__encoding__writeUTF16(const UChar* ptr, size_t len, unsigned char* to, size_t other_len, Encoding encoding);

extern "C" size_t Bun__encoding__byteLengthLatin1(const unsigned char* ptr, size_t len, Encoding encoding);
extern "C" size_t Bun__encoding__byteLengthUTF16(const UChar* ptr, size_t len, Encoding encoding);

extern "C" int64_t Bun__encoding__constructFromLatin1(void*, const unsigned char* ptr, size_t len, Encoding encoding);
extern "C" int64_t Bun__encoding__constructFromUTF16(void*, const UChar* ptr, size_t len, Encoding encoding);

template<bool isStrict, bool enableAsymmetricMatchers>
bool Bun__deepEquals(JSC::JSGlobalObject* globalObject, JSC::JSValue v1, JSC::JSValue v2, Vector<std::pair<JSC::JSValue, JSC::JSValue>, 16>& stack, JSC::ThrowScope* scope, bool addToStack);

template<bool enableAsymmetricMatchers>
bool Bun__deepMatch(JSC::JSValue object, JSC::JSValue subset, JSC::JSGlobalObject* globalObject, JSC::ThrowScope* throwScope, bool replacePropsWithAsymmetricMatchers);

extern "C" void Bun__remapStackFramePositions(JSC::JSGlobalObject*, ZigStackFrame*, size_t);

namespace Inspector {
class ScriptArguments;
}

using ScriptArguments = Inspector::ScriptArguments;

#endif
