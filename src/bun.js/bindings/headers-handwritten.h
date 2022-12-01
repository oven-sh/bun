#pragma once

typedef uint16_t ZigErrorCode;
typedef struct VirtualMachine VirtualMachine;

typedef struct ZigString {
    const unsigned char* ptr;
    size_t len;
} ZigString;
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
typedef struct ResolvedSource {
    ZigString specifier;
    ZigString source_code;
    ZigString source_url;
    uint32_t hash;
    void* allocator;
    uint64_t tag;
} ResolvedSource;
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
    ZigString code;
    ZigString message;
    ZigString path;
    ZigString syscall;
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
    ZigString function_name;
    ZigString source_url;
    ZigStackFramePosition position;
    ZigStackFrameCode code_type;
    bool remapped;
} ZigStackFrame;

typedef struct ZigStackTrace {
    ZigString* source_lines_ptr;
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
    ZigString syscall;
    ZigString code_;
    ZigString path;
    ZigString name;
    ZigString message;
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
const BunLoaderType BunLoaderTypeNone = 0;
const BunLoaderType BunLoaderTypeJSX = 1;
const BunLoaderType BunLoaderTypeJS = 2;
const BunLoaderType BunLoaderTypeTS = 3;
const BunLoaderType BunLoaderTypeTSX = 4;
const BunLoaderType BunLoaderTypeCSS = 5;
const BunLoaderType BunLoaderTypeFILE = 6;
const BunLoaderType BunLoaderTypeJSON = 7;
const BunLoaderType BunLoaderTypeTOML = 8;
const BunLoaderType BunLoaderTypeWASM = 9;
const BunLoaderType BunLoaderTypeNAPI = 10;

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
};

extern "C" const char* Bun__userAgent;

extern "C" ZigErrorCode Zig_ErrorCodeParserError;

extern "C" void ZigString__free(const unsigned char* ptr, size_t len, void* allocator);
extern "C" void Microtask__run(void* ptr, void* global);
extern "C" void Microtask__run_default(void* ptr, void* global);

extern "C" bool Bun__transpileVirtualModule(
    JSC::JSGlobalObject* global,
    ZigString* specifier,
    ZigString* referrer,
    ZigString* sourceCode,
    BunLoaderType loader,
    ErrorableResolvedSource* result);

extern "C" JSC::EncodedJSValue Bun__runVirtualModule(
    JSC::JSGlobalObject* global,
    ZigString* specifier);

extern "C" void* Bun__transpileFile(
    void* bunVM,
    JSC::JSGlobalObject* global,
    ZigString* specifier,
    ZigString* referrer,
    ErrorableResolvedSource* result, bool allowPromise);

extern "C" JSC::EncodedJSValue CallbackJob__onResolve(JSC::JSGlobalObject*, JSC::CallFrame*);
extern "C" JSC::EncodedJSValue CallbackJob__onReject(JSC::JSGlobalObject*, JSC::CallFrame*);

extern "C" bool Bun__fetchBuiltinModule(
    void* bunVM,
    JSC::JSGlobalObject* global,
    ZigString* specifier,
    ZigString* referrer,
    ErrorableResolvedSource* result);

// Used in process.version
extern "C" const char* Bun__version;

// Used in process.versions
extern "C" const char* Bun__versions_webkit;
extern "C" const char* Bun__versions_mimalloc;
extern "C" const char* Bun__versions_libarchive;
extern "C" const char* Bun__versions_picohttpparser;
extern "C" const char* Bun__versions_boringssl;
extern "C" const char* Bun__versions_zlib;
extern "C" const char* Bun__version_sha;

extern "C" const char* Bun__versions_zig;

extern "C" void ZigString__free_global(const unsigned char* ptr, size_t len);

extern "C" int64_t Bun__encoding__writeLatin1(const unsigned char* ptr, size_t len, unsigned char* to, size_t other_len, Encoding encoding);
extern "C" int64_t Bun__encoding__writeUTF16(const UChar* ptr, size_t len, unsigned char* to, size_t other_len, Encoding encoding);

extern "C" size_t Bun__encoding__byteLengthLatin1(const unsigned char* ptr, size_t len, Encoding encoding);
extern "C" size_t Bun__encoding__byteLengthUTF16(const UChar* ptr, size_t len, Encoding encoding);

extern "C" int64_t Bun__encoding__constructFromLatin1(void*, const unsigned char* ptr, size_t len, Encoding encoding);
extern "C" int64_t Bun__encoding__constructFromUTF16(void*, const UChar* ptr, size_t len, Encoding encoding);

template<bool isStrict>
bool Bun__deepEquals(JSC::JSGlobalObject* globalObject, JSC::JSValue v1, JSC::JSValue v2, Vector<std::pair<JSC::JSValue, JSC::JSValue>, 16>& stack, JSC::ThrowScope* scope, bool addToStack);

namespace Inspector {
class ScriptArguments;
}

using ScriptArguments = Inspector::ScriptArguments;

#endif
