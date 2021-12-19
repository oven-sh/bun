#pragma once

typedef uint16_t ZigErrorCode;

typedef struct ZigString {
  const unsigned char *ptr;
  size_t len;
} ZigString;
typedef struct ZigErrorType {
  ZigErrorCode code;
  void *ptr;
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
  void *allocator;
  uint64_t bytecodecache_fd;
} ResolvedSource;
typedef union ErrorableResolvedSourceResult {
  ResolvedSource value;
  ZigErrorType err;
} ErrorableResolvedSourceResult;
typedef struct ErrorableResolvedSource {
  ErrorableResolvedSourceResult result;
  bool success;
} ErrorableResolvedSource;

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
} ZigStackFrame;

typedef struct ZigStackTrace {
  ZigString *source_lines_ptr;
  int32_t *source_lines_numbers;
  uint8_t source_lines_len;
  uint8_t source_lines_to_collect;
  ZigStackFrame *frames_ptr;
  uint8_t frames_len;
} ZigStackTrace;

typedef struct ZigException {
  unsigned char code;
  uint16_t runtime_type;
  ZigString name;
  ZigString message;
  ZigStackTrace stack;
  void *exception;
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

#ifdef __cplusplus
extern "C" ZigErrorCode Zig_ErrorCodeParserError;

extern "C" void ZigString__free(const unsigned char *ptr, size_t len, void *allocator);
extern "C" void Microtask__run(void *ptr, void *global);
#endif
