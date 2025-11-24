// This file is part of Bun!
// You can find the original source:
// https://github.com/oven-sh/bun/blob/main/src/bun.js/api/FFI.h
//
// clang-format off
// This file is only compatible with 64 bit CPUs
// It must be kept in sync with JSCJSValue.h
// https://github.com/oven-sh/WebKit/blob/main/Source/JavaScriptCore/runtime/JSCJSValue.h
#ifdef IS_CALLBACK
#define INJECT_BEFORE int c = 500; // This is a callback, so we need to inject code before the call
#endif
#define IS_BIG_ENDIAN 0
#define USE_JSVALUE64 1
#define USE_JSVALUE32_64 0

#define ZIG_REPR_TYPE int64_t

#ifdef _WIN32
#define BUN_FFI_IMPORT __declspec(dllimport)
#else
#define BUN_FFI_IMPORT
#endif

// /* 7.18.1.1  Exact-width integer types */
typedef unsigned char uint8_t;
typedef signed char int8_t;
typedef short int16_t;
typedef unsigned short uint16_t;
typedef int int32_t;
typedef unsigned int uint32_t;
typedef long long int64_t;
typedef unsigned long long uint64_t;
typedef unsigned long long size_t;
typedef long intptr_t;
typedef uint64_t uintptr_t;
typedef _Bool bool;

#define true 1
#define false 0

#ifndef SRC_JS_NATIVE_API_TYPES_H_
typedef struct NapiEnv *napi_env;
typedef int64_t napi_value;
typedef enum {
  napi_ok,
  napi_invalid_arg,
  napi_object_expected,
  napi_string_expected,
  napi_name_expected,
  napi_function_expected,
  napi_number_expected,
  napi_boolean_expected,
  napi_array_expected,
  napi_generic_failure,
  napi_pending_exception,
  napi_cancelled,
  napi_escape_called_twice,
  napi_handle_scope_mismatch,
  napi_callback_scope_mismatch,
  napi_queue_full,
  napi_closing,
  napi_bigint_expected,
  napi_date_expected,
  napi_arraybuffer_expected,
  napi_detachable_arraybuffer_expected,
  napi_would_deadlock // unused
} napi_status;
BUN_FFI_IMPORT void* NapiHandleScope__open(void* napi_env, bool detached);
BUN_FFI_IMPORT void NapiHandleScope__close(void* napi_env, void* handleScope);
BUN_FFI_IMPORT extern struct NapiEnv Bun__thisFFIModuleNapiEnv;
#endif


#ifdef INJECT_BEFORE
// #include <stdint.h>
#endif
// #include <tcclib.h>

// This value is 2^49, used to encode doubles such that the encoded value will
// begin with a 15-bit pattern within the range 0x0002..0xFFFC.
#define DoubleEncodeOffsetBit 49
#define DoubleEncodeOffset    (1ll << DoubleEncodeOffsetBit)
#define OtherTag              0x2ll
#define BoolTag               0x4ll
#define UndefinedTag          0x8ll
#define TagValueFalse            (OtherTag | BoolTag | false)
#define TagValueTrue             (OtherTag | BoolTag | true)
#define TagValueUndefined        (OtherTag | UndefinedTag)
#define TagValueNull             (OtherTag)
#define NotCellMask  (int64_t)(NumberTag | OtherTag)

#define MAX_INT32 2147483648
#define MAX_INT52 9007199254740991

// If all bits in the mask are set, this indicates an integer number,
// if any but not all are set this value is a double precision number.
#define NumberTag 0xfffe000000000000ll

typedef  void* JSCell;

typedef union EncodedJSValue {
  int64_t asInt64;

#if USE_JSVALUE64
  JSCell *ptr;
#endif

napi_value asNapiValue;

#if IS_BIG_ENDIAN
  struct {
    int32_t tag;
    int32_t payload;
  } asBits;
#else
  struct {
    int32_t payload;
    int32_t tag;
  } asBits;
#endif

  void* asPtr;
  double asDouble;

  ZIG_REPR_TYPE asZigRepr;
} EncodedJSValue;

EncodedJSValue ValueUndefined = { TagValueUndefined };
EncodedJSValue ValueTrue = { TagValueTrue };

typedef void* JSContext;

// Bun_FFI_PointerOffsetToArgumentsList is injected into the build 
// The value is generated in `make sizegen`
// The value is 6.
// On ARM64_32, the value is something else but it really doesn't matter for our case
// However, I don't want this to subtly break amidst future upgrades to JavaScriptCore
#define LOAD_ARGUMENTS_FROM_CALL_FRAME \
  int64_t *argsPtr = (int64_t*)((size_t*)callFrame + Bun_FFI_PointerOffsetToArgumentsList)


#ifdef IS_CALLBACK
void* callback_ctx;
BUN_FFI_IMPORT ZIG_REPR_TYPE FFI_Callback_call(void* ctx, size_t argCount, ZIG_REPR_TYPE* args);
// We wrap 
static EncodedJSValue _FFI_Callback_call(void* ctx, size_t argCount, ZIG_REPR_TYPE* args)  __attribute__((__always_inline__));
static EncodedJSValue _FFI_Callback_call(void* ctx, size_t argCount, ZIG_REPR_TYPE* args) {
  EncodedJSValue return_value;
  return_value.asZigRepr = FFI_Callback_call(ctx, argCount, args);
  return return_value;
}
#endif

static bool JSVALUE_IS_CELL(EncodedJSValue val) __attribute__((__always_inline__));
static bool JSVALUE_IS_INT32(EncodedJSValue val) __attribute__((__always_inline__)); 
static bool JSVALUE_IS_NUMBER(EncodedJSValue val) __attribute__((__always_inline__));

static uint64_t JSVALUE_TO_UINT64(EncodedJSValue value) __attribute__((__always_inline__));
static int64_t  JSVALUE_TO_INT64(EncodedJSValue value) __attribute__((__always_inline__));
uint64_t JSVALUE_TO_UINT64_SLOW(EncodedJSValue value);
int64_t  JSVALUE_TO_INT64_SLOW(EncodedJSValue value);

EncodedJSValue UINT64_TO_JSVALUE_SLOW(void* jsGlobalObject, uint64_t val);
EncodedJSValue INT64_TO_JSVALUE_SLOW(void* jsGlobalObject, int64_t val);
static EncodedJSValue UINT64_TO_JSVALUE(void* jsGlobalObject, uint64_t val) __attribute__((__always_inline__));
static EncodedJSValue INT64_TO_JSVALUE(void* jsGlobalObject, int64_t val) __attribute__((__always_inline__));


static EncodedJSValue INT32_TO_JSVALUE(int32_t val) __attribute__((__always_inline__));
static EncodedJSValue DOUBLE_TO_JSVALUE(double val) __attribute__((__always_inline__));
static EncodedJSValue FLOAT_TO_JSVALUE(float val) __attribute__((__always_inline__));
static EncodedJSValue BOOLEAN_TO_JSVALUE(bool val) __attribute__((__always_inline__));
static EncodedJSValue PTR_TO_JSVALUE(void* ptr) __attribute__((__always_inline__));

static void* JSVALUE_TO_PTR(EncodedJSValue val) __attribute__((__always_inline__));
static int32_t JSVALUE_TO_INT32(EncodedJSValue val) __attribute__((__always_inline__));
static float JSVALUE_TO_FLOAT(EncodedJSValue val) __attribute__((__always_inline__));
static double JSVALUE_TO_DOUBLE(EncodedJSValue val) __attribute__((__always_inline__));
static bool JSVALUE_TO_BOOL(EncodedJSValue val) __attribute__((__always_inline__));
static uint8_t GET_JSTYPE(EncodedJSValue val) __attribute__((__always_inline__));
static bool JSTYPE_IS_TYPED_ARRAY(uint8_t type) __attribute__((__always_inline__));
static bool JSCELL_IS_TYPED_ARRAY(EncodedJSValue val) __attribute__((__always_inline__));
static void* JSVALUE_TO_TYPED_ARRAY_VECTOR(EncodedJSValue val) __attribute__((__always_inline__));
static uint64_t JSVALUE_TO_TYPED_ARRAY_LENGTH(EncodedJSValue val) __attribute__((__always_inline__));

static bool JSVALUE_IS_CELL(EncodedJSValue val) {
  return !(val.asInt64 & NotCellMask);
}

static bool JSVALUE_IS_INT32(EncodedJSValue val) {
  return (val.asInt64 & NumberTag) == NumberTag;
}

static bool JSVALUE_IS_NUMBER(EncodedJSValue val) {
  return val.asInt64 & NumberTag;
}

static uint8_t GET_JSTYPE(EncodedJSValue val) {
  return *(uint8_t*)((uint8_t*)val.asPtr + JSCell__offsetOfType);
}

static bool JSTYPE_IS_TYPED_ARRAY(uint8_t type) {
  return type >= JSTypeArrayBufferViewMin && type <= JSTypeArrayBufferViewMax;
}

static bool JSCELL_IS_TYPED_ARRAY(EncodedJSValue val) {
  return JSVALUE_IS_CELL(val) && JSTYPE_IS_TYPED_ARRAY(GET_JSTYPE(val));
}

static void* JSVALUE_TO_TYPED_ARRAY_VECTOR(EncodedJSValue val) {
  return *(void**)((char*)val.asPtr + JSArrayBufferView__offsetOfVector);
}

static uint64_t JSVALUE_TO_TYPED_ARRAY_LENGTH(EncodedJSValue val) {
  return *(uint64_t*)((char*)val.asPtr + JSArrayBufferView__offsetOfLength);
}

// JSValue numbers-as-pointers are represented as a 52-bit integer
// Previously, the pointer was stored at the end of the 64-bit value
// Now, they're stored at the beginning of the 64-bit value
// This behavior change enables the JIT to handle it better
// It also is better readability when console.log(myPtr)
static void* JSVALUE_TO_PTR(EncodedJSValue val) {
  if (val.asInt64 == TagValueNull)
    return 0;

  if (JSCELL_IS_TYPED_ARRAY(val)) {
    return JSVALUE_TO_TYPED_ARRAY_VECTOR(val);
  }

  if (JSVALUE_IS_INT32(val)) {
    return (void*)(uintptr_t)JSVALUE_TO_INT32(val);
  }

  // Assume the JSValue is a double
  val.asInt64 -= DoubleEncodeOffset;
  return (void*)(uintptr_t)val.asDouble;
}

static EncodedJSValue PTR_TO_JSVALUE(void* ptr) {
  EncodedJSValue val;
  if (ptr == 0) {
    val.asInt64 = TagValueNull;
    return val;
  }

  val.asDouble = (double)(uintptr_t)ptr;
  val.asInt64 += DoubleEncodeOffset;
  return val;
}

static EncodedJSValue DOUBLE_TO_JSVALUE(double val) {
   EncodedJSValue res;
   res.asDouble = val;
   res.asInt64 += DoubleEncodeOffset;
   return res;
}

static int32_t JSVALUE_TO_INT32(EncodedJSValue val) {
  return val.asInt64;
}

static EncodedJSValue INT32_TO_JSVALUE(int32_t val) {
   EncodedJSValue res;
   res.asInt64 = NumberTag | (uint32_t)val;
   return res;
}

static EncodedJSValue UINT32_TO_JSVALUE(uint32_t val) {
  EncodedJSValue res;
  if(val <= MAX_INT32) {
    res.asInt64 = NumberTag | val;
    return res;
  } else {
    EncodedJSValue res;
    res.asDouble = val;
    res.asInt64 += DoubleEncodeOffset;
    return res;
  }
}

static EncodedJSValue FLOAT_TO_JSVALUE(float val) {
  return DOUBLE_TO_JSVALUE((double)val);
}

static EncodedJSValue BOOLEAN_TO_JSVALUE(bool val) {
  EncodedJSValue res;
  res.asInt64 = val ? TagValueTrue : TagValueFalse;
  return res;
}


static double JSVALUE_TO_DOUBLE(EncodedJSValue val) {
  val.asInt64 -= DoubleEncodeOffset;
  return val.asDouble;
}

static float JSVALUE_TO_FLOAT(EncodedJSValue val) {
  return (float)JSVALUE_TO_DOUBLE(val);
}

static bool JSVALUE_TO_BOOL(EncodedJSValue val) {
  return val.asInt64 == TagValueTrue;
}


static uint64_t JSVALUE_TO_UINT64(EncodedJSValue value) {
  if (JSVALUE_IS_INT32(value)) {
    return (uint64_t)JSVALUE_TO_INT32(value);
  }

  if (JSVALUE_IS_NUMBER(value)) {
    return (uint64_t)JSVALUE_TO_DOUBLE(value);
  }

  if (JSCELL_IS_TYPED_ARRAY(value)) {
    return (uint64_t)JSVALUE_TO_TYPED_ARRAY_LENGTH(value);
  }

  return JSVALUE_TO_UINT64_SLOW(value);
}
static int64_t JSVALUE_TO_INT64(EncodedJSValue value) {
  if (JSVALUE_IS_INT32(value)) {
    return (int64_t)JSVALUE_TO_INT32(value);
  }

  if (JSVALUE_IS_NUMBER(value)) {
    return (int64_t)JSVALUE_TO_DOUBLE(value);
  }

  return JSVALUE_TO_INT64_SLOW(value);
}

static EncodedJSValue UINT64_TO_JSVALUE(void* jsGlobalObject, uint64_t val) {
  if (val < MAX_INT32) {
    return INT32_TO_JSVALUE((int32_t)val);
  }

  if (val < MAX_INT52) {
    return DOUBLE_TO_JSVALUE((double)val);
  }

  return UINT64_TO_JSVALUE_SLOW(jsGlobalObject, val);
}

static EncodedJSValue INT64_TO_JSVALUE(void* jsGlobalObject, int64_t val) {
  if (val >= -MAX_INT32 && val <= MAX_INT32) {
    return INT32_TO_JSVALUE((int32_t)val);
  }

  if (val >= -MAX_INT52 && val <= MAX_INT52) {
    return DOUBLE_TO_JSVALUE((double)val);
  }

  return INT64_TO_JSVALUE_SLOW(jsGlobalObject, val);
}

#ifndef IS_CALLBACK
BUN_FFI_IMPORT ZIG_REPR_TYPE JSFunctionCall(void* jsGlobalObject, void* callFrame);

#endif


// --- Generated Code ---
