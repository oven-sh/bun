#pragma once

typedef uint16_t ZigErrorCode;

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
} SystemError;

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

typedef struct {
    uint32_t highwater_mark;
    Encoding encoding;
    int32_t start;
    int32_t end;
    bool readable;
    bool aborted;
    bool did_read;
    bool ended;
    uint8_t flowing;
    bool emit_close;
    bool emit_end;
} Bun__Readable;

typedef struct {
    uint32_t highwater_mark;
    Encoding encoding;
    uint32_t start;
    bool destroyed;
    bool ended;
    bool corked;
    bool finished;
    bool emit_close;
} Bun__Writable;

typedef struct {
    char* ptr;
    uint32_t offset;
    uint32_t len;
    uint32_t byte_len;
    uint8_t cell_type;
    uint64_t _value;
} Bun__ArrayBuffer;

#ifndef STRING_POINTER
#define STRING_POINTER
typedef struct StringPointer {
    uint32_t off;
    uint32_t len;
} StringPointer;
#endif

#ifdef __cplusplus

extern "C" ZigErrorCode Zig_ErrorCodeParserError;

extern "C" void ZigString__free(const unsigned char* ptr, size_t len, void* allocator);
extern "C" void Microtask__run(void* ptr, void* global);

// Used in process.version
extern "C" const char* Bun__version;

// Used in process.versions
extern "C" const char* Bun__versions_webkit;
extern "C" const char* Bun__versions_mimalloc;
extern "C" const char* Bun__versions_libarchive;
extern "C" const char* Bun__versions_picohttpparser;
extern "C" const char* Bun__versions_boringssl;
extern "C" const char* Bun__versions_zlib;
extern "C" const char* Bun__versions_zig;

extern "C" void ZigString__free_global(const unsigned char* ptr, size_t len);

extern "C" int64_t Bun__encoding__writeLatin1AsHex(const unsigned char* ptr, size_t len, unsigned char* to, size_t other_len);
extern "C" int64_t Bun__encoding__writeUTF16AsHex(const UChar* ptr, size_t len, unsigned char* to, size_t other_len);
extern "C" int64_t Bun__encoding__writeLatin1AsURLSafeBase64(const unsigned char* ptr, size_t len, unsigned char* to, size_t other_len);
extern "C" int64_t Bun__encoding__writeUTF16AsURLSafeBase64(const UChar* ptr, size_t len, unsigned char* to, size_t other_len);
extern "C" int64_t Bun__encoding__writeLatin1AsBase64(const unsigned char* ptr, size_t len, unsigned char* to, size_t other_len);
extern "C" int64_t Bun__encoding__writeUTF16AsBase64(const UChar* ptr, size_t len, unsigned char* to, size_t other_len);
extern "C" int64_t Bun__encoding__writeLatin1AsUTF16(const unsigned char* ptr, size_t len, unsigned char* to, size_t other_len);
extern "C" int64_t Bun__encoding__writeUTF16AsUTF16(const UChar* ptr, size_t len, unsigned char* to, size_t other_len);
extern "C" int64_t Bun__encoding__writeLatin1AsUTF8(const unsigned char* ptr, size_t len, unsigned char* to, size_t other_len);
extern "C" int64_t Bun__encoding__writeUTF16AsUTF8(const UChar* ptr, size_t len, unsigned char* to, size_t other_len);
extern "C" int64_t Bun__encoding__writeLatin1AsASCII(const unsigned char* ptr, size_t len, unsigned char* to, size_t other_len);
extern "C" int64_t Bun__encoding__writeUTF16AsASCII(const UChar* ptr, size_t len, unsigned char* to, size_t other_len);

#endif
